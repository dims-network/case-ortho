"""
export_timeseries.py — export per-track ball kinematics from ortho.db to the
DIMS timeseries CSVs for ALL tracks of the 3 recorded dyads (the db spine).

Writes assets/timeseries/{videoID}_{metric}.csv for metric in speed,vx,vy,x,y:
  header: {value_col},Time      (speed->ball_speed, others->vx/vy/x/y)
  rows:   {value},{time_s}      time_s = timestamp_ms/1000 (3dp), in play order
Source: kinematics(point_x->x, point_y->y, vx, vy, speed) per (session_id, track_key).
"""

import os
import ortho_common as oc

OUT = os.path.join(oc.BASE, "assets", "timeseries")


def fmt(v):
    """Match existing style: integral values as int, else plain float repr."""
    if v is None:
        return ""
    f = float(v)
    return str(int(f)) if f == int(f) else str(f)


def main():
    os.makedirs(OUT, exist_ok=True)
    conn = oc.db()
    n_files = n_tracks = 0
    try:
        for dyad, sid, idir, eaf in oc.DYADS:
            tracks = oc.ball_tracks(oc.db_tracks(conn, sid, dyad))
            for t in tracks:
                rows = conn.execute(
                    "SELECT timestamp_ms, point_x, point_y, vx, vy, speed "
                    "FROM kinematics WHERE session_id=? AND track_key=? "
                    "ORDER BY timestamp_ms", (sid, t["track_key"])
                ).fetchall()
                if not rows:
                    print(f"  [WARN] no kinematics for {t['videoID']} "
                          f"(track_key={t['track_key']})")
                    continue
                cols = {"x": 1, "y": 2, "vx": 3, "vy": 4, "speed": 5}
                for metric in oc.METRICS:
                    path = os.path.join(OUT, f"{t['videoID']}_{metric}.csv")
                    ci = cols[metric]
                    with open(path, "w") as fh:
                        fh.write(f"{oc.CSV_COL[metric]},Time\n")
                        for r in rows:
                            time_s = round(r[0] / 1000.0, 3)
                            fh.write(f"{fmt(r[ci])},{time_s}\n")
                    n_files += 1
                n_tracks += 1
                print(f"  ✓ {t['videoID']:14} {len(rows):5d} samples  → 5 CSVs")
    finally:
        conn.close()
    print(f"\nDone: {n_tracks} tracks, {n_files} CSV files written to {OUT}")


if __name__ == "__main__":
    main()
