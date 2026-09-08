#!/usr/bin/env python3
"""
step_categorical_rqa.py - Categorical Recurrence Quantification Analysis for the
DIMS Dashboard, for the gaze (area-of-interest) tiers of parent and child.

Unlike step_RQA.py (Euclidean threshold on a continuous signal), recurrence here
is an EXACT categorical match: R[i,j] = 1 iff both samples fixate the same AOI
code, with the "none" state (code 0, gaps/transitions) treated as non-recurrent.

Reads the coded gaze series  assets/timeseries/{videoID}_gaze_{parent,child}.csv
(value column = integer AOI code, see assets/gaze/aoi_legend.json) and writes the
same JSON shape as step_RQA.py so the dashboard RQA tab can render it:
  assets/rqa/{videoID}_rqa_data.json

Usage:
    python step_categorical_rqa.py --config config.json

Requires dims-analysis (`pip install -e /path/to/dims`) for the shared helpers:
path resolution, the series reader, the reduction and the merging writer.
"""

import os
import json
import argparse
import numpy as np

# The shared helpers, not private copies of them: see the step contract in
# dims-network/dims, docs/contracts/step.md. `assets` is what makes this run on
# a study whose data lives outside the repository; `results` is what stops it
# erasing the continuous RQA that writes into the same file.
from dims_analysis.common import arrays as _arrays
from dims_analysis.common import assets as _assets
from dims_analysis.common import payload as _payload
from dims_analysis.common import reduce as _reduce
from dims_analysis.common import results as _results
from dims_analysis.common import series as _series

GAZE_TYPES = ["gaze_parent", "gaze_child"]
MAX_POINTS = 500
LEGEND_PATH = "assets/gaze/aoi_legend.json"


def load_legend():
    """code(int) -> AOI label, from the gaze legend written by build_datasets."""
    try:
        with open(_assets.resolve(LEGEND_PATH)) as f:
            return {int(k): v for k, v in json.load(f).items()}
    except Exception:
        return {}


def categorical_recurrence(codes):
    """R[i,j]=1 iff codes equal and != 0 (0 = none/transition, not recurrent)."""
    c = np.asarray(codes)
    R = (c[:, None] == c[None, :]).astype(np.uint8)
    none = (c == 0)
    R[none[:, None] | none[None, :]] = 0
    n = len(c)
    diag = int(np.count_nonzero(c != 0))           # R[i,i]=1 only where c!=0
    rr = (int(R.sum()) - diag) / (n * n - n) if n > 1 else 0.0
    return R, rr


def process(video_id, data_type, legend):
    csv = _assets.resolve(f"assets/timeseries/{video_id}_{data_type}.csv")
    loaded = _series.load_or_none(csv, min_points=10)
    if loaded is None:
        return None                       # load_or_none has already said why
    time, values = loaded
    codes = np.nan_to_num(values, nan=0).astype(int)
    distinct = set(int(x) for x in codes) - {0}
    if len(distinct) < 2:
        print(f"  [skip] {video_id} {data_type}: degenerate "
              f"({len(codes)} pts, {len(distinct)} AOIs)")
        return None

    # Recurrence first, reduction second. Reducing the *series* and then
    # matching on what survives is striding by another name: a recurrence one
    # cell off the main diagonal is only kept when its lag happens to be a
    # multiple of the factor, and an off-diagonal line is precisely what a
    # lagged parent/child coupling looks like. The full matrix is 2610 points
    # at the longest here -- under 7 MB -- so there is nothing to gain by it.
    R_full, rr_full = categorical_recurrence(codes)
    factor = _reduce.factor_for(len(codes), MAX_POINTS)
    R = _reduce.block_binary(R_full, factor)
    t_ds = _reduce.block_mean(time, factor)
    c_ds = _reduce.block_mode(codes, factor)
    rr = _reduce.rate_of(R) if factor > 1 else rr_full

    print(f"  {video_id} {data_type}: {len(codes)}->{len(c_ds)} pts, "
          f"{len(distinct)} AOIs, RR={rr_full*100:.1f}%")
    return {
        "data_type": data_type,
        "categorical": True,
        "threshold": 0.0,                       # n/a for categorical
        "recurrence_rate": float(rr_full),
        "time_range": [float(time[0]), float(time[-1])],
        "visualization": {
            "time": t_ds.tolist(),
            "data": [int(x) for x in c_ds],
            "labels": [legend.get(int(x), str(int(x))) for x in c_ds],
            "matrix_size": len(t_ds),
            # One bit per cell, the same encoding the shared RQA step writes
            # since core 2.0.0. Gaze recurrence runs 63-89 % dense here, where
            # the index pairs this replaced cost about ten bytes per recurrent
            # cell: one matrix was 7,300,452 bytes as pairs and 133,803 as a
            # bitmap.
            "matrix": _arrays.pack_bitmap(R),
            # Inside `visualization`, beside the picture it describes -- the
            # same place the shared RQA step writes it and the place the
            # assets contract tells a tab to look. It was one level up, which
            # meant a reader following the contract found nothing.
            "reduction": {
                "factor": int(factor),
                "series": "block mode (categorical)",
                "matrix": "density-preserving block selection",
                "n_points_full": int(len(codes)),
                "rate_full": float(rr_full),
                "rate_drawn": float(rr),
            },
        },
        # The analysis at full resolution, in the same file as the picture,
        # as the analysis-output contract requires. Codes rather than a
        # continuous signal, so the matrix is rebuilt by equality rather than
        # by distance.
        "full_data": {"n_points": int(len(codes)),
                      "time_range": [float(time[0]), float(time[-1])],
                      "time": _arrays.pack_f32(time),
                      "codes": [int(x) for x in codes]},
    }


def main():
    ap = argparse.ArgumentParser(description="Categorical (gaze) RQA for DIMS")
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--output-dir", default="assets/rqa")
    args = ap.parse_args()

    with open(args.config) as f:
        config = json.load(f)
    out_dir = _assets.resolve(args.output_dir)
    os.makedirs(out_dir, exist_ok=True)
    note = _assets.describe()
    if note:
        print(note)
    legend = load_legend()

    n = 0
    for video_id in config["videoIDs"]:
        results = {}
        for dt in GAZE_TYPES:
            r = process(video_id, dt, legend)
            if r:
                results[dt] = r
        if results:
            out = os.path.join(out_dir, f"{video_id}_rqa_data.json")
            # One merge implementation, shared with the continuous RQA step
            # that writes into this same file. Two copies of a merge is how one
            # of them ends up clobbering the other.
            # Rounded like every other payload. This step called
            # `round_payload` zero times while its own `precision` block
            # claimed six significant figures -- a file whose stated precision
            # was not its actual precision.
            report = _results.write_payload(out, _payload.round_payload({
                "video_id": video_id,
                "payload_version": _arrays.PAYLOAD_VERSION,
                "rqa_data": results,
                "precision": _payload.precision_note(),
            }), compact=False)
            n += 1
            # Say both halves out loud: what was already in the file and
            # survived, and what this run overwrote. A silent replacement is
            # how the gaze RQA disappeared from this study once already.
            kept = report["kept"].get("rqa_data") or []
            over = report["replaced"].get("rqa_data") or []
            detail = f", kept {', '.join(kept)}" if kept else ""
            detail += f", replaced {', '.join(over)}" if over else ""
            print(f"  -> {out} ({', '.join(results)}{detail})")
    print(f"\nCategorical gaze RQA complete: {n} datasets.")


if __name__ == "__main__":
    main()
