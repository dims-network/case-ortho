"""
ortho_common.py — shared definitions for building DIMS ORTHO datasets.

Two decoupled sources per level:
  - ortho.db  : ball kinematics for EVERY game track  (the spine)
  - EAF "Game events" tier : on-video time span for SOME levels (for cutting clips)

videoID = {dyad}_L{difficulty}_A{nn}
  difficulty = game_tracks.difficulty_level (0..3)
  A{nn}      = nth occurrence of that difficulty, walking game_tracks by level_seq
EAF label -> difficulty:  Level 1->0, Level 2->1, Level 3->2, Level Bonus->3
"""

import os
import re
import glob
import sqlite3
import xml.etree.ElementTree as ET

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INTERACTIONS = os.path.join(BASE, "interactions")
DB_PATH = "/Users/m11/Documents/codes/DIMS_ORTHO_VIEWER/ortho.db"
TRAJ_CONFIG = "/Users/m11/Documents/codes/DIMS_ORTHO_VIEWER/trajectory_config.json"
VIEWER_IMAGES = "/Users/m11/Documents/codes/DIMS_ORTHO_VIEWER/assets/images"

# dyad -> (db session_id, interaction subfolder, eaf filename)
DYADS = [
    ("CUF00", "20250615-0000", "Interaction_1_CUF00", "analiza.eaf"),
    ("CUF06", "20250615-0006", "Interaction_2_CUF06", "analiza2.eaf"),
    ("CUG22", "20250616-0022", "Interaction_3_CUG22", "analysis.eaf"),
]

# EAF "Game events" annotation value -> difficulty_level
LABEL_TO_DIFF = {
    "Level 1": 0,
    "Level 2": 1,
    "Level 3": 2,
    "Level Bonus": 3,
}

# Match the EAF span to a db track of the same difficulty if durations agree
# within this tolerance (seconds). Generous because manual EAF marking drifts.
DURATION_TOL_S = 8.0

# Only difficulty 0 & 3 levels are continuous ball-rolling tracks; difficulty 1 & 2
# are menu/puzzle levels whose kinematics are a handful of status-0/4 points (no
# movement). A real ball dataset must have at least this many kinematics samples.
# Threshold is data-driven: L0/L3 tracks have >700 samples, L1/L2 have <20.
MIN_BALL_SAMPLES = 100

METRICS = ["speed", "vx", "vy", "x", "y"]
# CSV value-column name per metric (matches existing assets) and db source column
CSV_COL = {"speed": "ball_speed", "vx": "vx", "vy": "vy", "x": "x", "y": "y"}
DB_COL = {"speed": "speed", "vx": "vx", "vy": "vy", "x": "point_x", "y": "point_y"}


def db():
    """Read-only sqlite connection."""
    return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)


# ── db tracks ──────────────────────────────────────────────────────────────────

def db_tracks(conn, session_id, dyad):
    """
    Canonical track list for a session, ordered by level_seq.
    Each row: videoID, dyad, difficulty(L), track_key, track_id, level_seq,
              track_time_ms, start_time, closing_time, completed, mistake.
    Assigns A{nn} = nth occurrence of the difficulty.
    """
    rows = conn.execute(
        "SELECT g.track_key, g.level_seq, g.track_id, g.difficulty_level, "
        "       g.track_time_ms, g.start_time, g.closing_time, g.completed, g.mistake, "
        "       (SELECT count(*) FROM kinematics k "
        "        WHERE k.session_id=g.session_id AND k.track_key=g.track_key) AS n_samples "
        "FROM game_tracks g WHERE g.session_id=? ORDER BY g.level_seq", (session_id,)
    ).fetchall()
    counters = {}
    out = []
    for (tk, lseq, tid, diff, tms, st, ct, comp, mis, nsamp) in rows:
        counters[diff] = counters.get(diff, 0) + 1
        vid = f"{dyad}_L{diff}_A{counters[diff]:02d}"
        out.append({
            "videoID": vid, "dyad": dyad, "session_id": session_id,
            "difficulty": diff, "track_key": tk, "track_id": tid,
            "level_seq": lseq, "track_time_ms": tms or 0,
            "start_time": st, "closing_time": ct,
            "completed": comp, "mistake": mis,
            "n_samples": nsamp or 0,
            "is_ball": (nsamp or 0) >= MIN_BALL_SAMPLES,
        })
    return out


def ball_tracks(tracks):
    """Filter to real ball-rolling tracks (excludes menu/puzzle L1/L2 levels)."""
    return [t for t in tracks if t["is_ball"]]


# ── EAF parsing ────────────────────────────────────────────────────────────────

def _ts_map(root):
    return {t.get("TIME_SLOT_ID"): int(t.get("TIME_VALUE")) for t in root.iter("TIME_SLOT")}


def eaf_game_segments(eaf_path):
    """
    Ordered list of playable-level segments from the 'Game events' tier:
      {label, difficulty, start_ms, end_ms, dur_s}
    Only labels in LABEL_TO_DIFF are kept (Preparation/Level choice/Failure/... dropped).
    """
    root = ET.parse(eaf_path).getroot()
    ts = _ts_map(root)
    segs = []
    for tier in root.iter("TIER"):
        if tier.get("TIER_ID") != "Game events":
            continue
        for a in tier.iter("ALIGNABLE_ANNOTATION"):
            label = (a.findtext("ANNOTATION_VALUE") or "").strip()
            if label not in LABEL_TO_DIFF:
                continue
            s, e = ts[a.get("TIME_SLOT_REF1")], ts[a.get("TIME_SLOT_REF2")]
            segs.append({
                "label": label, "difficulty": LABEL_TO_DIFF[label],
                "start_ms": s, "end_ms": e, "dur_s": (e - s) / 1000.0,
            })
    segs.sort(key=lambda x: x["start_ms"])
    return segs


def datalogs_segments(eaf_path):
    """
    Hand-curated cut segments from the 'datalogs' tier. The annotation VALUE is
    the dataset key (verbatim, e.g. 'CUF00_L3_A1'). Returns ordered:
      [{key, start_ms, end_ms, dur_s}]
    """
    root = ET.parse(eaf_path).getroot()
    ts = _ts_map(root)
    segs = []
    for tier in root.iter("TIER"):
        if (tier.get("TIER_ID") or "").lower().replace(" ", "") != "datalogs":
            continue
        for a in tier.iter("ALIGNABLE_ANNOTATION"):
            key = (a.findtext("ANNOTATION_VALUE") or "").strip()
            if not key:
                continue
            s, e = ts[a.get("TIME_SLOT_REF1")], ts[a.get("TIME_SLOT_REF2")]
            segs.append({"key": key, "start_ms": s, "end_ms": e,
                         "dur_s": (e - s) / 1000.0})
    segs.sort(key=lambda x: x["start_ms"])
    return segs


def parse_key(key):
    """'CUF00_L3_A1' -> ('CUF00', 3, 1).  Returns (dyad, difficulty, a_index)."""
    m = re.match(r"^(.+)_L(\d+)_A0*(\d+)$", key)
    if not m:
        raise ValueError(f"unrecognized dataset key: {key}")
    return m.group(1), int(m.group(2)), int(m.group(3))


def key_to_track(tracks, difficulty, a_index, dur_s=None):
    """
    Nth (a_index, 1-based) ball track of the given difficulty, in level_seq order.
    If dur_s given, sanity-check the db track_time_ms is within DURATION_TOL_S.
    """
    same = [t for t in tracks if t["difficulty"] == difficulty]
    if a_index < 1 or a_index > len(same):
        return None
    t = same[a_index - 1]
    if dur_s is not None and abs(t["track_time_ms"] / 1000.0 - dur_s) > DURATION_TOL_S:
        print(f"  [WARN] {t['videoID']} db dur {t['track_time_ms']/1000:.1f}s vs "
              f"datalogs {dur_s:.1f}s exceeds tolerance")
    return t


# ── gaze (areas of interest) ────────────────────────────────────────────────────

# Canonical AOI label -> stable integer code (0 = none/gap).
AOI_CODES = {
    "Ball": 1, "Further": 2, "My controller": 3, "Partner's controller": 4,
    "Intersection": 5, "Counter": 6, "Go": 7, "My axis": 8, "Partner's axis": 9,
    "Ball's trajectory": 10, "Ball's possible trajectory": 11,
    "Parent": 12, "Child": 13,
}

# typo / variant -> canonical (after apostrophe normalization)
_AOI_FIX = {
    "parter's axis": "Partner's axis",
    "parnter's controller": "Partner's controller",
    "parthner's controller": "Partner's controller",
}


def normalize_aoi(value):
    """Canonicalize a raw gaze label; '' for empty. Unknown labels pass through."""
    v = (value or "").strip().replace("’", "'")  # curly -> straight apostrophe
    if not v:
        return ""
    fixed = _AOI_FIX.get(v.lower())
    if fixed:
        return fixed
    # case-insensitive match to a canonical label
    for canon in AOI_CODES:
        if v.lower() == canon.lower():
            return canon
    return v


def gaze_tier_name(eaf_root, who):
    """Find the tier id for 'parent'/'child' gaze (case-insensitive)."""
    for tier in eaf_root.iter("TIER"):
        tid = (tier.get("TIER_ID") or "").lower()
        if "gaze" in tid and who in tid:
            return tier.get("TIER_ID")
    return None


def gaze_intervals(eaf_root, ts, tier_id, start_ms, end_ms):
    """
    Annotations of `tier_id` overlapping [start_ms, end_ms], clipped to the window
    and re-zeroed to start_ms. Returns [(start_s, end_s, canon_label)] sorted.
    """
    out = []
    for tier in eaf_root.iter("TIER"):
        if tier.get("TIER_ID") != tier_id:
            continue
        for a in tier.iter("ALIGNABLE_ANNOTATION"):
            s = ts.get(a.get("TIME_SLOT_REF1")); e = ts.get(a.get("TIME_SLOT_REF2"))
            if s is None or e is None or e <= start_ms or s >= end_ms:
                continue
            label = normalize_aoi(a.findtext("ANNOTATION_VALUE"))
            cs = max(s, start_ms) - start_ms
            ce = min(e, end_ms) - start_ms
            out.append((cs / 1000.0, ce / 1000.0, label))
    out.sort()
    return out


def sample_gaze(intervals, dur_s, dt=0.1):
    """Step-sample intervals to a fixed grid -> [(time_s, code)], 0 where no gaze."""
    rows = []
    n = int(round(dur_s / dt)) + 1
    j = 0
    for i in range(n):
        t = round(i * dt, 3)
        code = 0
        # advance/scan intervals containing t (intervals are sorted, few overlaps)
        for (s, e, label) in intervals:
            if s <= t < e:
                code = AOI_CODES.get(label, 0)
                break
        rows.append((t, code))
    return rows


def _persp_of(filename):
    f = filename.lower()
    if "dziecko" in f:
        return "child"
    if "mama" in f or "tata" in f or "rodzic" in f:
        return "parent"
    if "pair" in f or "gopro" in f:
        return "wide"
    return None


def eaf_media(eaf_path, interaction_dir):
    """
    Per-perspective media from EAF MEDIA_DESCRIPTORs:
      {persp: {"file": abs_path_on_disk, "origin_ms": int}}
    Resolves the on-disk file (eaf may reference a renamed file, e.g. Tata_2.mp4
    -> Tata_2_broken.mp4) by keyword glob within the interaction dir.
    """
    root = ET.parse(eaf_path).getroot()
    out = {}
    idir = os.path.join(INTERACTIONS, interaction_dir)
    for md in root.iter("MEDIA_DESCRIPTOR"):
        url = md.get("RELATIVE_MEDIA_URL") or md.get("MEDIA_URL") or ""
        base = os.path.basename(url)
        persp = _persp_of(base)
        if not persp:
            continue
        origin = int(md.get("TIME_ORIGIN", "0") or "0")
        path = os.path.join(idir, base)
        if not os.path.exists(path):
            # resolve by keyword: child=Dziecko, parent=Mama/Tata/Rodzic, wide=Pair/gopro
            kw = {"child": "Dziecko", "parent": ("Mama", "Tata", "Rodzic"),
                  "wide": ("Pair", "PAIR", "gopro")}[persp]
            kws = (kw,) if isinstance(kw, str) else kw
            cands = []
            for k in kws:
                cands += glob.glob(os.path.join(idir, f"*{k}*"))
            cands = [c for c in cands if re.search(r"\.(mp4|mov)$", c, re.I)
                     and "part" not in os.path.basename(c).lower()]
            path = cands[0] if cands else path
        out[persp] = {"file": path, "origin_ms": origin}
    return out


# ── alignment: db tracks  <->  EAF segments ─────────────────────────────────────

def align(tracks, segments):
    """
    Order-preserving (Needleman-Wunsch) match between db tracks and EAF segments,
    done PER difficulty. Both sequences are in play order, so matches must be
    monotonic (no crossing); EAF is a noisy sub/superset of db plays. A diag match
    costs |db_dur - eaf_dur| (capped at MATCH_CAP_S, else forbidden); skipping a
    track or a segment costs GAP_S. The uniform ~+6s EAF lead-in stays well under
    the cap, while genuine extras/missing plays get gapped.
    Mutates tracks: track['eaf'] = matched segment or None, track['has_video'].
    Returns list of EAF segments with no db track (encoded but unplayed/missing).
    """
    GAP_S, MATCH_CAP_S, INF = 12.0, 15.0, float("inf")
    for t in tracks:
        t["eaf"] = None
    for i, s in enumerate(segments):
        s["_id"] = i
    matched = set()
    diffs = sorted({t["difficulty"] for t in tracks} | {s["difficulty"] for s in segments})
    for d in diffs:
        dtr = [t for t in tracks if t["difficulty"] == d]
        seg = [s for s in segments if s["difficulty"] == d]
        n, m = len(dtr), len(seg)
        dp = [[0.0] * (m + 1) for _ in range(n + 1)]
        bk = [[None] * (m + 1) for _ in range(n + 1)]
        for i in range(1, n + 1):
            dp[i][0] = i * GAP_S; bk[i][0] = "up"
        for j in range(1, m + 1):
            dp[0][j] = j * GAP_S; bk[0][j] = "left"
        for i in range(1, n + 1):
            for j in range(1, m + 1):
                c = abs(dtr[i - 1]["track_time_ms"] / 1000.0 - seg[j - 1]["dur_s"])
                mc = dp[i - 1][j - 1] + (c if c <= MATCH_CAP_S else INF)
                up = dp[i - 1][j] + GAP_S
                lf = dp[i][j - 1] + GAP_S
                best = min(mc, up, lf)
                dp[i][j] = best
                bk[i][j] = "diag" if best == mc else ("up" if best == up else "left")
        i, j = n, m
        while i > 0 or j > 0:
            mv = bk[i][j]
            if mv == "diag":
                dtr[i - 1]["eaf"] = seg[j - 1]; matched.add(seg[j - 1]["_id"]); i -= 1; j -= 1
            elif mv == "up":
                i -= 1
            else:
                j -= 1
    for t in tracks:
        t["has_video"] = t["eaf"] is not None
    return [s for s in segments if s["_id"] not in matched]


def all_dyads():
    """
    Yield (dyad, tracks, segments, media, unmatched, eaf_path) for the 3 dyads.
    `tracks` is the BALL tracks only (L0/L3); menu/puzzle L1/L2 tracks are dropped.
    `segments` and alignment are likewise restricted to ball-level difficulties,
    so EAF Level 2/Level 3 (menu) annotations are ignored.
    """
    conn = db()
    try:
        for dyad, sid, idir, eaf in DYADS:
            eaf_path = os.path.join(INTERACTIONS, idir, eaf)
            tracks = ball_tracks(db_tracks(conn, sid, dyad))
            ball_diffs = {t["difficulty"] for t in tracks}
            segments = [s for s in eaf_game_segments(eaf_path)
                        if s["difficulty"] in ball_diffs]
            media = eaf_media(eaf_path, idir)
            unmatched = align(tracks, segments)
            yield dyad, tracks, segments, media, unmatched, eaf_path
    finally:
        conn.close()
