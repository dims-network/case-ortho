"""
build_config.py — rewrite config.json for the 10 datalogs datasets.

videoIDs are the verbatim datalogs keys. Each gets ball + gaze dataTypes, a
trajectory image slot left BLANK for the user to pick (with a _suggested hint),
and a path_images catalog (image -> game-coord calibration) the dashboard uses
to render whichever image the user fills in.
"""

import os
import json
import ortho_common as oc

CONFIG = os.path.join(oc.BASE, "config.json")
VIDEOS = os.path.join(oc.BASE, "assets", "videos")


def available_perspectives(key):
    return [p for p in ("wide", "parent", "child")
            if os.path.exists(os.path.join(VIDEOS, f"{key}_{p}.mp4"))]


def path_images_catalog():
    """image -> {x0,y0,x1,y1}; dedup track_ids by image, prefer estimated:false."""
    with open(oc.TRAJ_CONFIG) as f:
        tracks = json.load(f)["tracks"]
    out = {}
    for tid, c in tracks.items():
        img = c["image"]
        cal = {"x0": c["img_game_x0"], "y0": c["img_game_y0"],
               "x1": c["img_game_x1"], "y1": c["img_game_y1"]}
        if img not in out or (not c.get("estimated", True)):
            out[img] = cal
    return out


def main():
    with open(oc.TRAJ_CONFIG) as f:
        traj = json.load(f)["tracks"]

    conn = oc.db()
    keys = []          # (dyad_index, key, suggested_image)
    try:
        for di, (dyad, sid, idir, eaf) in enumerate(oc.DYADS):
            eaf_path = os.path.join(oc.INTERACTIONS, idir, eaf)
            tracks = oc.ball_tracks(oc.db_tracks(conn, sid, dyad))
            for seg in oc.datalogs_segments(eaf_path):
                _, diff, aidx = oc.parse_key(seg["key"])
                t = oc.key_to_track(tracks, diff, aidx)
                sugg = traj.get(str(t["track_id"]), {}).get("image", "") if t else ""
                keys.append((di, seg["key"], sugg))
    finally:
        conn.close()

    video_ids = [k for _, k, _ in keys]
    # Gaze is intentionally NOT a plotted timeseries (categorical). It feeds the
    # categorical RQA only (include_RQA below); the coded CSVs live in timeseries
    # for the RQA script to read but are not listed as plottable dataTypes.
    data_types = {k: ["speed", "vy", "vx"] for k in video_ids}
    video_persp = {k: available_perspectives(k) for k in video_ids}
    # Use the db-suggested path image (bare filename, matches path_images keys).
    # User can still edit to any other path_images key.
    traj_tracks = {k: {"image": sugg} for _, k, sugg in keys}

    with open(CONFIG) as f:
        cfg = json.load(f)
    cfg["videoIDs"] = video_ids
    cfg["dataTypes"] = data_types
    cfg["include_RQA"] = ["gaze_parent", "gaze_child"]   # categorical gaze RQA
    cfg["videoPerspectives"] = video_persp
    cfg["path_images"] = path_images_catalog()
    cfg["trajectory_tracks"] = traj_tracks
    with open(CONFIG, "w") as f:
        json.dump(cfg, f, indent=4)
        f.write("\n")

    print(f"config.json: {len(video_ids)} videoIDs")
    for _, k, sugg in keys:
        print(f"  {k:16} persp={video_persp[k]}  suggested_img={sugg}")
    print(f"  path_images: {sorted(cfg['path_images'])}")


if __name__ == "__main__":
    main()
