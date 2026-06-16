"""
cut_clips.py — cut per-level video clips + trimmed EAFs for the ball tracks that
the EAF 'Game events' tier encodes (the 14 with-video datasets).

For each ball track with a matched EAF segment:
  - cut every available perspective from its raw video using the EAF span minus
    that perspective's TIME_ORIGIN  ->  assets/videos/{videoID}_{persp}.mp4
  - write a trimmed, re-zeroed EAF (all tiers within the window) ->
    assets/elan/{videoID}.eaf  with MEDIA_DESCRIPTORs pointing at the cut clips.

Alignment comes from ortho_common (db<->EAF), NOT from the old LEVEL_MAP. Videos
stay gitignored. Re-encodes (libx264 crf18) for frame-accurate cuts.
"""

import os
import copy
import subprocess
import xml.etree.ElementTree as ET
import ortho_common as oc

OUT_VIDEOS = os.path.join(oc.BASE, "assets", "videos")
OUT_ELAN = os.path.join(oc.BASE, "assets", "elan")
PERSP_ORDER = ("wide", "parent", "child")


def duration_s(path):
    try:
        r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries",
                            "format=duration", "-of",
                            "default=noprint_wrappers=1:nokey=1", path],
                           capture_output=True, text=True, timeout=60)
        return float(r.stdout.strip())
    except Exception:
        return None


def cut_video(src, dst, start_s, end_s):
    cmd = ["ffmpeg", "-y", "-ss", f"{start_s:.3f}", "-to", f"{end_s:.3f}",
           "-i", src, "-c:v", "libx264", "-crf", "18", "-preset", "fast",
           "-c:a", "aac", "-b:a", "128k", dst]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"    [ERROR] ffmpeg: {r.stderr[-200:]}")
        return False
    return True


def trim_eaf(eaf_path, start_ms, end_ms, cut_persp_rel, out_path):
    """Trimmed copy of the full EAF: keep annotations fully inside [start,end],
    re-zero TIME_SLOTs to the window, rebuild MEDIA_DESCRIPTORs to the cut clips."""
    root = copy.deepcopy(ET.parse(eaf_path).getroot())
    ts_map = {t.get("TIME_SLOT_ID"): int(t.get("TIME_VALUE"))
              for t in root.iter("TIME_SLOT")}

    used = set()
    for tier in root.iter("TIER"):
        drop = []
        for ann in tier.findall(".//ANNOTATION"):
            al = ann.find("ALIGNABLE_ANNOTATION")
            if al is None:
                drop.append(ann); continue
            t1 = ts_map.get(al.get("TIME_SLOT_REF1"), -1)
            t2 = ts_map.get(al.get("TIME_SLOT_REF2"), -1)
            if t1 >= start_ms and t2 <= end_ms and t1 >= 0:
                used.add(al.get("TIME_SLOT_REF1")); used.add(al.get("TIME_SLOT_REF2"))
            else:
                drop.append(ann)
        for ann in drop:
            tier.remove(ann)

    order = root.find("TIME_ORDER")
    remap, keep = {}, []
    n = 1
    for ts in list(order):
        oid = ts.get("TIME_SLOT_ID")
        if oid in used:
            nid = f"ts{n}"; n += 1
            remap[oid] = nid
            ts.set("TIME_SLOT_ID", nid)
            ts.set("TIME_VALUE", str(int(ts.get("TIME_VALUE")) - start_ms))
        else:
            keep.append(ts)
    for ts in keep:
        order.remove(ts)
    for al in root.iter("ALIGNABLE_ANNOTATION"):
        for ref in ("TIME_SLOT_REF1", "TIME_SLOT_REF2"):
            if al.get(ref) in remap:
                al.set(ref, remap[al.get(ref)])

    header = root.find("HEADER")
    for md in list(header.findall("MEDIA_DESCRIPTOR")):
        header.remove(md)
    for i, (persp, name) in enumerate(cut_persp_rel):
        md = ET.Element("MEDIA_DESCRIPTOR")
        md.set("MEDIA_URL", f"../videos/{name}")
        md.set("MIME_TYPE", "video/mp4")
        md.set("RELATIVE_MEDIA_URL", f"../videos/{name}")
        md.set("TIME_ORIGIN", "0")
        header.insert(i, md)

    ET.indent(root, space="    ")
    ET.ElementTree(root).write(out_path, encoding="UTF-8", xml_declaration=True)


def main():
    os.makedirs(OUT_VIDEOS, exist_ok=True)
    os.makedirs(OUT_ELAN, exist_ok=True)
    n_clips = n_eaf = 0
    for dyad, tracks, segments, media, unmatched, eaf_path in oc.all_dyads():
        # probe perspective durations once
        durs = {p: duration_s(media[p]["file"]) if os.path.exists(media[p]["file"])
                else None for p in media}
        print(f"\n=== {dyad} ===")
        for p in PERSP_ORDER:
            if p in media:
                d = durs[p]
                print(f"  {p:7} {os.path.basename(media[p]['file']):40} "
                      f"{'%.1fs' % d if d else 'MISSING'}  origin={media[p]['origin_ms']}ms")
        for t in tracks:
            if not t["has_video"]:
                continue
            seg = t["eaf"]
            vid = t["videoID"]
            print(f"  [{vid}] EAF {seg['start_ms']/1000:.1f}-{seg['end_ms']/1000:.1f}s")
            cut_rel = []
            for p in PERSP_ORDER:
                if p not in media or durs[p] is None:
                    continue
                org = media[p]["origin_ms"]
                vs = max(0.0, (seg["start_ms"] - org) / 1000.0)
                ve = (seg["end_ms"] - org) / 1000.0
                if ve <= 0 or vs >= durs[p]:
                    print(f"    [skip] {p}: outside video span")
                    continue
                ve = min(ve, durs[p])
                if ve <= vs:
                    continue
                name = f"{vid}_{p}.mp4"
                if cut_video(media[p]["file"], os.path.join(OUT_VIDEOS, name), vs, ve):
                    cut_rel.append((p, name))
                    n_clips += 1
                    print(f"    ✓ {p:7} [{vs:.1f}-{ve:.1f}s] -> {name}")
            if cut_rel:
                trim_eaf(eaf_path, seg["start_ms"], seg["end_ms"], cut_rel,
                         os.path.join(OUT_ELAN, f"{vid}.eaf"))
                n_eaf += 1
                print(f"    ✓ EAF ({len(cut_rel)} persp) -> {vid}.eaf")
    print(f"\nDone: {n_clips} clips, {n_eaf} trimmed EAFs.")


if __name__ == "__main__":
    main()
