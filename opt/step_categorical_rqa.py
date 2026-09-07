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
    python step_categorical_rqa.py --config config.json --output-dir assets/rqa
"""

import os
import json
import argparse
import numpy as np
import pandas as pd

GAZE_TYPES = ["gaze_parent", "gaze_child"]
MAX_POINTS = 500
LEGEND_PATH = "assets/gaze/aoi_legend.json"


def load_legend():
    """code(int) -> AOI label, from the gaze legend written by build_datasets."""
    try:
        with open(LEGEND_PATH) as f:
            return {int(k): v for k, v in json.load(f).items()}
    except Exception:
        return {}


def downsample(time, codes, max_points=MAX_POINTS):
    n = len(codes)
    if n <= max_points:
        return time, codes
    f = n // max_points
    return time[::f], codes[::f]


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
    csv = f"assets/timeseries/{video_id}_{data_type}.csv"
    if not os.path.exists(csv):
        print(f"  [skip] {video_id} {data_type}: no file")
        return None
    df = pd.read_csv(csv)
    cols = [c for c in df.columns if c != "Time"]
    if "Time" not in df.columns or not cols:
        print(f"  [skip] {video_id} {data_type}: bad columns")
        return None
    codes = df[cols[0]].fillna(0).astype(int).values
    time = df["Time"].values
    distinct = set(int(x) for x in codes) - {0}
    if len(codes) < 10 or len(distinct) < 2:
        print(f"  [skip] {video_id} {data_type}: degenerate "
              f"({len(codes)} pts, {len(distinct)} AOIs)")
        return None

    t_ds, c_ds = downsample(time, codes)
    R, rr = categorical_recurrence(c_ds)
    rows, colsi = np.where(R == 1)
    sparse = [[int(r), int(c)] for r, c in zip(rows, colsi)]
    print(f"  {video_id} {data_type}: {len(codes)}->{len(c_ds)} pts, "
          f"{len(distinct)} AOIs, RR={rr*100:.1f}%")
    return {
        "data_type": data_type,
        "categorical": True,
        "threshold": 0.0,                       # n/a for categorical
        "recurrence_rate": float(rr),
        "time_range": [float(time[0]), float(time[-1])],
        "visualization": {
            "time": t_ds.tolist(),
            "data": [int(x) for x in c_ds],
            "labels": [legend.get(int(x), str(int(x))) for x in c_ds],
            "matrix_size": len(t_ds),
            "sparse_matrix": sparse,
        },
        "full_data": {"n_points": int(len(codes)),
                      "time_range": [float(time[0]), float(time[-1])]},
    }


def main():
    ap = argparse.ArgumentParser(description="Categorical (gaze) RQA for DIMS")
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--output-dir", default="assets/rqa")
    args = ap.parse_args()

    with open(args.config) as f:
        config = json.load(f)
    os.makedirs(args.output_dir, exist_ok=True)
    legend = load_legend()

    n = 0
    for video_id in config["videoIDs"]:
        results = {}
        for dt in GAZE_TYPES:
            r = process(video_id, dt, legend)
            if r:
                results[dt] = r
        if results:
            out = os.path.join(args.output_dir, f"{video_id}_rqa_data.json")
            # Merge with any existing entries (e.g. continuous vx/vy RQA).
            merged = {}
            if os.path.exists(out):
                with open(out) as f:
                    merged = json.load(f).get("rqa_data", {})
            merged.update(results)
            with open(out, "w") as f:
                json.dump({"video_id": video_id, "rqa_data": merged}, f, indent=2)
            n += 1
            print(f"  -> {out} ({list(merged)})")
    print(f"\nCategorical gaze RQA complete: {n} datasets.")


if __name__ == "__main__":
    main()
