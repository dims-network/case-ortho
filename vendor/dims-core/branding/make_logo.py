#!/usr/bin/env python3
"""
Generate the DIMS Dashboard logo lockup (transparent PNG, light + dark variants)
plus a square mark for the favicon. Re-run after editing the COLORS / TEXT below —
the logo is meant to be easy to regenerate.

    python3 assets/branding/make_logo.py

Requires Pillow (already installed). No SVG tooling needed.
"""
from PIL import Image, ImageDraw, ImageFont

# Wordmark lockup: a bold name + a lighter qualifier.
NAME = "DIMS"
QUALIFIER = "Dashboard"

SS = 4                      # supersampling factor for crisp edges
H = 256                     # logical wordmark height (px); output is H tall

# Variant -> (name color, qualifier color, ring A color, ring B color)
VARIANTS = {
    "light": ("#1f2328", "#59636e", "#0d9488", "#7c3aed"),   # Aurora
    "dark":  ("#eceff4", "#9aa6b8", "#22d3ee", "#a78bfa"),   # Midnight
}

# Bold face (the NAME) and a regular face (the QUALIFIER); first that loads wins.
FONT_BOLD = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "DejaVuSans-Bold.ttf",  # bundled with matplotlib/Pillow, always available
]
FONT_REG = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "DejaVuSans.ttf",
]


def load_font(size, candidates):
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def hex2rgba(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def draw_mark(draw, cx, cy, r, stroke, color_a, color_b):
    """Two overlapping rings — two signals in synchrony."""
    off = r * 0.55
    # back ring (B), then front ring (A) overlapping it
    for (dx, color) in ((off, color_b), (-off, color_a)):
        bbox = [cx + dx - r, cy - r, cx + dx + r, cy + r]
        draw.ellipse(bbox, outline=color, width=stroke)


def seg_width(font, text, tracking):
    return sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)


def draw_segment(draw, x, baseline, font, text, color, tracking):
    """Draw text letter-by-letter on a shared baseline with even tracking."""
    for ch in text:
        draw.text((x, baseline), ch, font=font, fill=color, anchor="ls")
        x += font.getlength(ch) + tracking
    return x


def make_wordmark(name_hex, qual_hex, ring_a_hex, ring_b_hex):
    h = H * SS
    ring_r = int(h * 0.34)
    stroke = max(2, int(h * 0.055))
    gap = int(h * 0.18)         # mark -> text gap
    seg_gap = int(h * 0.13)     # NAME -> QUALIFIER gap
    pad = int(h * 0.08)

    bold = load_font(int(h * 0.58), FONT_BOLD)
    reg = load_font(int(h * 0.58), FONT_REG)
    t_name = int(h * 0.03)
    t_qual = int(h * 0.006)

    name_w = seg_width(bold, NAME, t_name)
    qual_w = seg_width(reg, QUALIFIER, t_qual)
    text_w = name_w + seg_gap + qual_w

    off = ring_r * 0.55                       # ring overlap offset (matches draw_mark)
    mark_w = int(2 * ring_r + 2 * off)        # full horizontal span of the two rings
    total_w = int(pad + mark_w + gap + text_w + pad)
    total_h = h

    img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # mark — center so the leftmost ring edge sits exactly at `pad`
    mark_cx = int(pad + off + ring_r)
    draw_mark(draw, mark_cx, total_h // 2, ring_r, stroke,
              hex2rgba(ring_a_hex), hex2rgba(ring_b_hex))

    # wordmark on a shared baseline (caps vertically centered)
    baseline = total_h // 2 + int(h * 0.21)
    x = pad + mark_w + gap
    x = draw_segment(draw, x, baseline, bold, NAME, hex2rgba(name_hex), t_name)
    x += seg_gap
    draw_segment(draw, x, baseline, reg, QUALIFIER, hex2rgba(qual_hex), t_qual)

    return img.resize((total_w // SS, total_h // SS), Image.LANCZOS)


def make_mark(ring_a_hex, ring_b_hex):
    """Square mark for favicon / app icon."""
    side = 256 * SS
    ring_r = int(side * 0.30)
    stroke = max(2, int(side * 0.05))
    img = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw_mark(draw, side // 2, side // 2, ring_r, stroke,
              hex2rgba(ring_a_hex), hex2rgba(ring_b_hex))
    return img.resize((256, 256), Image.LANCZOS)


def main():
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    for variant, (name, qual, ra, rb) in VARIANTS.items():
        out = os.path.join(here, f"dims-logo-{variant}.png")
        make_wordmark(name, qual, ra, rb).save(out)
        print("wrote", out)
    # favicon uses the light (teal/violet) mark
    mark_out = os.path.join(here, "dims-mark.png")
    make_mark(VARIANTS["light"][2], VARIANTS["light"][3]).save(mark_out)
    print("wrote", mark_out)


if __name__ == "__main__":
    main()
