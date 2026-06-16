"""
build_report.py — read-only EAF<->db coverage report for the 3 recorded dyads.

For each dyad prints the canonical db track list (the spine: timeseries for ALL
of these) annotated with whether the EAF 'Game events' tier encodes a video span
for it (-> a clip can be cut). Surfaces the "unencoded" levels and any EAF
segments that don't align to a db track.
"""

import ortho_common as oc


def hms_to_s(t):
    # "HH:MM:SS:mmm" -> seconds (for display only)
    try:
        h, m, s, ms = t.split(":")
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0
    except Exception:
        return None


def main():
    grand = {"tracks": 0, "with_video": 0}
    for dyad, tracks, segments, media, unmatched, eaf_path in oc.all_dyads():
        persp_list = ", ".join(f"{p}(org{media[p]['origin_ms']})" for p in
                               ("wide", "parent", "child") if p in media)
        print(f"\n{'='*78}\n  {dyad}   session={tracks[0]['session_id']}   "
              f"db_tracks={len(tracks)}   eaf_segments={len(segments)}")
        print(f"  perspectives: {persp_list}")
        print(f"{'='*78}")
        print(f"  {'videoID':16} {'L':2} {'trk_id':6} {'db_dur':>7} "
              f"{'eaf_dur':>7} {'Δ':>5}  video")
        print(f"  {'-'*16} {'-'*2} {'-'*6} {'-'*7} {'-'*7} {'-'*5}  {'-'*5}")
        for t in tracks:
            db_dur = t["track_time_ms"] / 1000.0
            if t["eaf"]:
                ed = t["eaf"]["dur_s"]
                delta = f"{db_dur - ed:+.1f}"
                ed_s = f"{ed:.1f}"
                vid = "YES"
            else:
                ed_s, delta, vid = "—", "—", "no"
            print(f"  {t['videoID']:16} L{t['difficulty']} {t['track_id']:>6} "
                  f"{db_dur:7.1f} {ed_s:>7} {delta:>5}  {vid}")
        nvid = sum(1 for t in tracks if t["has_video"])
        grand["tracks"] += len(tracks)
        grand["with_video"] += nvid
        print(f"  → {len(tracks)} timeseries datasets, {nvid} with video, "
              f"{len(tracks) - nvid} timeseries-only")
        if unmatched:
            print(f"  ⚠ {len(unmatched)} EAF segment(s) with NO db track "
                  f"(encoded but unplayed/missing):")
            for s in unmatched:
                print(f"      {s['label']:12} {s['start_ms']/1000:.1f}-"
                      f"{s['end_ms']/1000:.1f}s ({s['dur_s']:.1f}s, L{s['difficulty']})")

    print(f"\n{'='*78}")
    print(f"  TOTAL: {grand['tracks']} datasets  |  {grand['with_video']} with video  |  "
          f"{grand['tracks'] - grand['with_video']} timeseries-only")
    print(f"{'='*78}")


if __name__ == "__main__":
    main()
