"""
build_datasets.py — clear and rebuild the DIMS ORTHO datasets from the EAF
`datalogs` tier (10 hand-curated segments). Per segment (key = annotation value):
  - ball timeseries from ortho.db   -> assets/timeseries/{key}_{speed,vx,vy,x,y}.csv
  - video clips per perspective     -> assets/videos/{key}_{persp}.mp4  (TIME_ORIGIN shift)
  - trimmed, re-zeroed EAF          -> assets/elan/{key}.eaf
  - gaze intervals (parent/child)   -> assets/gaze/{key}_{parent,child}.csv
  - gaze sampled coded series       -> assets/timeseries/{key}_gaze_{parent,child}.csv
Plus assets/gaze/aoi_legend.json (code -> label).
"""

import os
import glob
import json
import xml.etree.ElementTree as ET

import ortho_common as oc
import cut_clips
from export_timeseries import fmt

TS = os.path.join(oc.BASE, "assets", "timeseries")
VID = os.path.join(oc.BASE, "assets", "videos")
ELAN = os.path.join(oc.BASE, "assets", "elan")
GAZE = os.path.join(oc.BASE, "assets", "gaze")
PERSP_ORDER = ("wide", "parent", "child")
GAZE_DT = 0.1


def clear_assets():
    pats = [f"{VID}/CU*_L[03]_A*.mp4", f"{ELAN}/CU*_L[03]_A*.eaf",
            f"{TS}/CU*_L[03]_A*_*.csv", f"{GAZE}/*"]
    n = 0
    for p in pats:
        for f in glob.glob(p):
            os.remove(f); n += 1
    print(f"cleared {n} regenerable asset files")


def write_timeseries(conn, key, track):
    rows = conn.execute(
        "SELECT timestamp_ms, point_x, point_y, vx, vy, speed FROM kinematics "
        "WHERE session_id=? AND track_key=? ORDER BY timestamp_ms",
        (track["session_id"], track["track_key"])).fetchall()
    col = {"x": 1, "y": 2, "vx": 3, "vy": 4, "speed": 5}
    for metric in oc.METRICS:
        with open(os.path.join(TS, f"{key}_{metric}.csv"), "w") as fh:
            fh.write(f"{oc.CSV_COL[metric]},Time\n")
            for r in rows:
                fh.write(f"{fmt(r[col[metric]])},{round(r[0]/1000.0,3)}\n")
    return len(rows)


def main():
    os.makedirs(GAZE, exist_ok=True)
    for d in (TS, VID, ELAN):
        os.makedirs(d, exist_ok=True)
    clear_assets()

    # legend
    legend = {str(v): k for k, v in oc.AOI_CODES.items()}
    legend["0"] = "(none)"
    with open(os.path.join(GAZE, "aoi_legend.json"), "w") as f:
        json.dump(legend, f, indent=2)

    conn = oc.db()
    n_keys = n_clips = 0
    try:
        for dyad, sid, idir, eaf in oc.DYADS:
            eaf_path = os.path.join(oc.INTERACTIONS, idir, eaf)
            root = ET.parse(eaf_path).getroot()
            ts = oc._ts_map(root)
            tracks = oc.ball_tracks(oc.db_tracks(conn, sid, dyad))
            media = oc.eaf_media(eaf_path, idir)
            durs = {p: cut_clips.duration_s(media[p]["file"])
                    if os.path.exists(media[p]["file"]) else None for p in media}
            segs = oc.datalogs_segments(eaf_path)
            print(f"\n=== {dyad}: {len(segs)} datalogs segments ===")
            for seg in segs:
                key, s_ms, e_ms, dur = seg["key"], seg["start_ms"], seg["end_ms"], seg["dur_s"]
                _, diff, aidx = oc.parse_key(key)
                track = oc.key_to_track(tracks, diff, aidx, dur)
                if not track:
                    print(f"  [SKIP] {key}: no matching db track"); continue
                print(f"  [{key}] {s_ms/1000:.1f}-{e_ms/1000:.1f}s (db {track['videoID']})")

                nrow = write_timeseries(conn, key, track)
                print(f"    ts: {nrow} samples -> 5 CSVs")

                # video clips per perspective (apply per-video TIME_ORIGIN shift)
                cut_rel = []
                for p in PERSP_ORDER:
                    if p not in media or durs[p] is None:
                        continue
                    org = media[p]["origin_ms"]
                    vs = max(0.0, (s_ms - org) / 1000.0)
                    ve = (e_ms - org) / 1000.0
                    if ve <= 0 or vs >= durs[p]:
                        continue
                    ve = min(ve, durs[p])
                    if ve <= vs:
                        continue
                    name = f"{key}_{p}.mp4"
                    if cut_clips.cut_video(media[p]["file"], os.path.join(VID, name), vs, ve):
                        cut_rel.append((p, name)); n_clips += 1
                        print(f"    video {p}: [{vs:.1f}-{ve:.1f}s] -> {name}")
                if cut_rel:
                    cut_clips.trim_eaf(eaf_path, s_ms, e_ms, cut_rel,
                                       os.path.join(ELAN, f"{key}.eaf"))
                    print(f"    eaf: {len(cut_rel)} persp -> {key}.eaf")

                # gaze: intervals (assets/gaze) + sampled coded (assets/timeseries)
                for who in ("parent", "child"):
                    tier = oc.gaze_tier_name(root, who)
                    if not tier:
                        print(f"    [WARN] {key}: no {who} gaze tier"); continue
                    ivals = oc.gaze_intervals(root, ts, tier, s_ms, e_ms)
                    with open(os.path.join(GAZE, f"{key}_{who}.csv"), "w") as fh:
                        fh.write("start,end,label\n")
                        for (cs, ce, lab) in ivals:
                            fh.write(f"{cs},{ce},{lab}\n")
                    coded = oc.sample_gaze(ivals, dur, GAZE_DT)
                    with open(os.path.join(TS, f"{key}_gaze_{who}.csv"), "w") as fh:
                        fh.write(f"gaze_{who},Time\n")
                        for (t, code) in coded:
                            fh.write(f"{code},{t}\n")
                    print(f"    gaze {who}: {len(ivals)} intervals, {len(coded)} samples")
                n_keys += 1
    finally:
        conn.close()
    print(f"\nDone: {n_keys} datasets, {n_clips} clips.")


if __name__ == "__main__":
    main()
