# -*- coding: utf-8 -*-
r"""Slide specs for films 2-4, generated from the Figma node dumps in _build/fig/*.json.

Film 1 was specified by hand from design contexts. For the next films the plugin API dump
(tools/inspector, see reference/ae-quirks.md #100) is the source: every visible node with its
box, type, fills, strokes and text style. This module turns those nodes into deck.py elements:

  TEXT   kicker / hero / lead / block / statement / cardTitle / text / cardBody / note by role;
         soft breaks (U+2028) become explicit lines; a text whose paragraphs differ in size or
         carry paragraph spacing is split into one element per paragraph, each measured in the
         Figma render; a line mixing sizes ("20 000 " + a small rouble) is split by columns;
         mixed colours become per-range fill animators (el["ranges"]); "61 ->82" KPIs count up.
  VECT/RECT with a stroke and no fill  -> frame (rrect), stroke alignment kept
  VECT/RECT with the radial glow fill  -> glow panel (artkit)
  white rounded FRAME + one dark label -> pill; the wide white bar of h02 -> filled frame
  white rounded RECT (QR plate)        -> filled frame + the QR bitmap at exact geometry
  RECT with an image fill               -> png (icons fitted by ink box, logos keyed white)
  LINE / 1-px RECT / thin VECT          -> hairline (colour, width, vertical or horizontal)
  "image 22" / "Vector" (huge)         -> art kit background (planet / rays), ART[sid]

Films: 2 = p01..p07 (Slide 87 88 84 85 86 89 90), 3 = h01..h06 (93 94 96 95 97 98),
       4 = b01..b05 (99 100 102 101 103); order = left to right on the Figma canvas.
Names are prefixed with the slide id so only deliberate persistence links (fTask/fSol/glowR by
role, texts by signature) survive deck.match().
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

import inkmeasure

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "_build" / "fig"
ASSETS = ROOT / "assets"

FILMS = {"2": ["p01", "p02", "p03", "p04", "p05", "p06", "p07"],
         "3": ["h01", "h02", "h03", "h04", "h05", "h06"],
         "4": ["b01", "b02", "b03", "b04", "b05"]}
SEMI, MED, REG = "SBSansDisplay-Semibold", "SBSansDisplay-Medium", "SBSansDisplay-Regular"
STYLE = {"Semibold": SEMI, "Medium": MED, "Regular": REG}
WHITE = (255, 255, 255)
PURPLE = (116, 89, 249)
INK = (10, 6, 0)
HEADS = ("kicker", "hero", "lead", "block", "statement", "note")
# paragraph indices (by \n) that Figma lays out as unordered list items (read with getRangeListOptions)
LIST_NODES = {"4188:200": {1, 2, 3}, "4188:203": {1, 2, 3}, "4188:218": {1, 2, 3}, "4188:219": {1, 2, 3, 4}}
BULLET = "\u2022"
# content timing for these films: card texts fan left-to-right inside a row
INTRA_FILMS = {"cardTitle": (300, 700, 120), "cardBody": (440, 560, 120), "text": (300, 700, 120),
               "icon": (400, 500, 120), "pill": (150, 500, 120), "line": (60, 600, 60), "arrow": (420, 520, 0)}


# ---------------------------------------------------------------- node dumps
def _load(fn):
    return json.loads(open(FIG / fn, encoding="utf-8").read(), strict=False)


def load_nodes():
    """Merge every page dump into {sid: [nodes]} in document order."""
    out = {}
    for sid, d in _load("done.json").items():
        out[sid] = list(d["nodes"])
    pages = {}
    for fn in ("pages1.json", "pages2.json", "pages3.json", "extra.json"):
        for key, nodes in _load(fn).items():
            sid, off = (key.split("@") + ["0"])[:2]
            pages.setdefault(sid, {})[int(off)] = nodes
    for sid, pg in pages.items():
        seq = []
        for off in sorted(pg):
            seq.extend(pg[off])
        if sid in out:
            seen = {n["i"] for n in out[sid]}
            out[sid].extend(n for n in seq if n["i"] not in seen)
        else:
            out[sid] = seq
    details = _load("details.json")
    for sid, nodes in out.items():
        for n in nodes:
            d = details["texts"].get(n["i"])
            if d:
                n["s"] = d["s"]; n["segd"] = d["seg"]; n["ps"] = d.get("ps", n.get("ps", 0))
    return out, details["geo"]


def clean(s):
    """Soft breaks (U+2028 and friends, as <hex> markers or raw) become AE line breaks (\\r);
    paragraph breaks stay \\n so paragraphs can be split, and are turned into \\r at the end."""
    s = re.sub(r"<(b)>", "\x0b", s)                       # a vertical tab renders as nothing in Figma (p07 hero)
    s = re.sub(r"<(2028|2029|c|85|1c|1d|1e)>", "\r", s)
    for ch in ("\u2028", "\u2029", "\x0c", "\x85", "\x1c", "\x1d", "\x1e"):
        s = s.replace(ch, "\r")
    s = s.replace("ⓒ", "©")            # the circled c has no glyph in SB Sans Display (AE falls back to MS-Gothic)
    return s.replace("\r\n", "\n")


def pct(v, size):
    if isinstance(v, str) and v.endswith("%"):
        return size * float(v[:-1]) / 100
    if v in (None, "auto", "mix"):
        return size
    return float(v)


def track(ls):
    if isinstance(ls, str) and ls.endswith("%"):
        return int(round(float(ls[:-1]) * 10))       # -2% -> -20 (AE tracking = 1/1000 em)
    return 0


def c3(rgb):
    return [round(v / 255, 4) for v in rgb]


# ---------------------------------------------------------------- render helpers
_cache = {}


def render(sid):
    if sid not in _cache:
        _cache[sid] = np.asarray(Image.open(ASSETS / f"{sid}_full.png").convert("RGB")).astype(int)
    return _cache[sid]


EXCL = {}          # sid -> rects (white plates, pills, bitmaps) that never count as text ink
PLATES = {}        # sid -> white plate rects (dark texts are measured inside the plate that holds them)


def on_plate(sid, rect):
    """The white plate holding the centre of rect, inset by 2 px, or None."""
    cx, cy = rect[0] + rect[2] / 2, rect[1] + rect[3] / 2
    for px, py, pw, ph in PLATES.get(sid, ()):
        if px <= cx <= px + pw and py <= cy <= py + ph:
            return (px + 2, py + 2, pw - 4, ph - 4)
    return None


def clip_rect(r, c):
    x0, y0 = max(r[0], c[0]), max(r[1], c[1])
    x1, y1 = min(r[0] + r[2], c[0] + c[2]), min(r[1] + r[3], c[1] + c[3])
    return (x0, y0, max(1, x1 - x0), max(1, y1 - y0))


def mask(sid, rect, key=None, thr=100, tol=40):
    """Ink mask inside rect: pixels within tol of any of the key colours (or above thr luminance)."""
    a = render(sid)
    x, y, w, h = [int(round(v)) for v in rect]
    x, y = max(0, x), max(0, y)
    sub = a[y:y + h, x:x + w]
    if key is not None:
        cols = key if isinstance(key[0], (list, tuple)) else [key]
        m = np.zeros(sub.shape[:2], bool)
        for c in cols:
            m |= np.abs(sub - np.array(c)).max(axis=2) < tol
    else:
        m = sub.max(axis=2) > thr
    cx, cy = x + w / 2, y + h / 2
    for ex, ey, ew, eh in EXCL.get(sid, ()):
        ex, ey, ew, eh = int(ex), int(ey), int(round(ew)), int(round(eh))
        if ex <= cx <= ex + ew and ey <= cy <= ey + eh:
            continue                                   # the text lives on this plate (h02's bar)
        x0, y0, x1, y1 = max(ex, x), max(ey, y), min(ex + ew, x + w), min(ey + eh, y + h)
        if x1 > x0 and y1 > y0:
            m[y0 - y:y1 - y, x0 - x:x1 - x] = False
    return m, x, y


def bands(sid, rect, key=None, thr=100, min_h=8, tol=40):
    """Inked line bands inside rect as (top, bottom) in frame px (tools/inkmeasure.bands_of)."""
    m, x, y = mask(sid, rect, key, thr, tol)
    return [(y + a, y + b) for a, b in inkmeasure.bands_of(m, min_h)]


def tight(sid, rect, size, key=None, thr=100, tol=40, min_h=None):
    """(measurement rect, core) of a text: the core is its dense rectangle (line bands x dense
    columns), the rect the core with room for ascenders, descenders and marks around it."""
    m, x, y = mask(sid, rect, key, thr, tol)
    core = inkmeasure.dense_rect(m, min_h if min_h else max(3, int(0.35 * size)))
    if core is None:
        return rect, None
    cx, cy, cw, ch = core[0] + x, core[1] + y, core[2], core[3]
    pv, ph = max(6, int(0.45 * size)), 8
    rx0, ry0 = max(0, cx - ph), max(0, cy - pv)
    rx1, ry1 = min(1920, cx + cw + ph), min(1080, cy + ch + pv)
    return (rx0, ry0, rx1 - rx0, ry1 - ry0), (cx, cy, cw, ch)


def paragraph_rects(sid, rect, n_par, size, key=None, thr=100):
    """Split a node box into n_par paragraph boxes at the n_par-1 widest gaps between lines."""
    bs = bands(sid, rect, key, thr, min_h=max(6, int(0.35 * size)))
    if len(bs) < n_par:
        return [rect] * n_par
    gaps = [(bs[i + 1][0] - bs[i][1], i) for i in range(len(bs) - 1)]
    cuts = sorted(i for _, i in sorted(gaps, reverse=True)[:n_par - 1])
    x, y, w, h = rect
    rects, start = [], 0
    for ci in cuts + [len(bs) - 1]:
        top, bot = bs[start][0], bs[ci][1]
        rects.append((x, top - 6, w, bot - top + 13))
        start = ci + 1
    return rects


def glyph_groups(sid, rect, key, tol=60, gap=3, thr=100):
    """Runs of inked columns inside rect -> [(x0, x1, y0, y1)] in frame px (gaps under `gap` px bridge)."""
    m, x, y = mask(sid, rect, key, thr, tol)
    cols = m.any(axis=0)
    groups, start = [], None
    for i, v in enumerate(list(cols) + [False]):
        if v and start is None:
            start = i
        if not v and start is not None:
            if groups and start - groups[-1][1] <= gap:
                groups[-1][1] = i - 1
            else:
                groups.append([start, i - 1])
            start = None
    out = []
    for g0, g1 in groups:
        rows = np.where(m[:, g0:g1 + 1].any(axis=1))[0]
        out.append((x + g0, x + g1, y + int(rows.min()), y + int(rows.max())))
    return out, m, x, y


def kpi_elements(sid, n, text, seg, segs, rect, nm, color, lh, ls, key, size, style, just):
    """'61 ->82' as number + arrow shape + counting number, each placed from the render."""
    m_ = re.match(r"^(\d+)(\s*)\u2192(\s*)(\d+)$", text)
    a, _, _, b = m_.groups()
    groups, m, x, y = glyph_groups(sid, rect, None, thr=60)      # luminance, like the shape verifier
    arrows = [g for g in groups if (g[3] - g[2] + 1) < 0.5 * size]
    if len(arrows) != 1:
        raise SystemExit("%s: KPI arrow not found in %s: %s" % (sid, rect, groups))
    ax0, ax1, ay0, ay1 = arrows[0]
    left = [g for g in groups if g[1] < ax0]
    right = [g for g in groups if g[0] > ax1]
    r_left = (left[0][0] - 4, rect[1], left[-1][1] - left[0][0] + 9, rect[3])
    r_right = (right[0][0] - 4, rect[1], right[-1][1] - right[0][0] + 9, rect[3])
    # arrow geometry: shaft thickness at the middle column, head = columns taller than the shaft
    sub = m[ay0 - y:ay1 - y + 1, ax0 - x:ax1 - x + 1]
    shaft = int(sub[:, sub.shape[1] // 2].sum())
    heights = sub.sum(axis=0)
    head = np.where(heights > shaft + 2)[0]
    hx = int((ax1 - ax0) - head.min()) if len(head) else int(0.3 * (ax1 - ax0))     # tip to where the barbs start
    cy = (ay0 + ay1 + 1) / 2
    r_left, c_left = tight(sid, r_left, size, key=color)
    r_right, c_right = tight(sid, r_right, size, key=color)
    el_a = T(nm("t"), "text", a, STYLE.get(style, REG), size, color, r_left, leading=round(lh, 2), justify=just, key=None, track_=track(ls), core=c_left)
    el_a["key"] = c3(color)
    el_arrow = dict(name=nm("arrow"), kind="arrow", x1=ax0 + shaft / 2, y=cy, x2=ax1 - shaft / 2, hx=hx - shaft,
                    hy=(ay1 - ay0 + 1) / 2 - shaft / 2, sw=shaft, color=c3(color), g=None, k=0, thr=60,
                    rect=(ax0 - 4, ay0 - 4, ax1 - ax0 + 9, ay1 - ay0 + 9))
    expr = ('var a=%s,b=%s; var t0=inPoint+0.35, d=1.5; var p=Math.min(Math.max((time-t0)/d,0),1); p=1-Math.pow(1-p,3); '
            'String(Math.round(a+(b-a)*p))' % (a, b))
    el_b = T(nm("t"), "text", b, STYLE.get(style, REG), size, color, r_right, leading=round(lh, 2), justify=just, key=None,
             track_=track(ls), expr=expr, core=c_right)
    el_b["key"] = c3(color)
    return [el_a, el_arrow, el_b]


def list_paragraph_rects(sid, rect, n_par, size, node_x, key=None):
    """Paragraph boxes of a list node: a paragraph's first line starts within one font size of the
    node's left edge (the label at the edge, bullets a little in), continuation lines at the indent."""
    m, x, y = mask(sid, rect, key, 100, 40)
    bs = inkmeasure.bands_of(m, max(3, int(0.35 * size)))
    starts = []
    for i, (t, b) in enumerate(bs):
        cols = np.where(m[t:b + 1].any(axis=0))[0]
        if len(cols) and x + cols.min() < node_x + size:
            starts.append(i)
    if len(starts) != n_par:
        return None
    rects = []
    for k, si in enumerate(starts):
        ei = (starts[k + 1] - 1) if k + 1 < len(starts) else len(bs) - 1
        top, bot = bs[si][0] + y, bs[ei][1] + y
        rects.append((rect[0], top - 6, rect[2], bot - top + 13))
    return rects


def split_bullet(sid, rect, size, key=None):
    """(bullet rect, text rect) of a list paragraph: the first ink run is the bullet, then a gap."""
    m, x, y = mask(sid, rect, key, 100, 40)
    cols = np.where(m.any(axis=0))[0]
    c0 = int(cols.min())
    c1 = c0
    while c1 + 1 < m.shape[1] and m[:, c1 + 1].any():
        c1 += 1
    nxt = int(cols[cols > c1 + 3].min())
    return (x + c0 - 4, rect[1], c1 - c0 + 9, rect[3]), (x + nxt - 8, rect[1], rect[2] - (nxt - 8), rect[3])


def split_tail(sid, rect, key=None, thr=100):
    """Rect of the big glyphs and rect of the short tail glyph(s) on one line ("20 000" | rouble):
    glyph groups = runs of inked columns; the trailing groups under 60 % of the tallest are the tail."""
    m, x, y = mask(sid, rect, key, thr)
    cols = m.any(axis=0)
    groups, start = [], None
    for i, v in enumerate(list(cols) + [False]):
        if v and start is None:
            start = i
        if not v and start is not None:
            if groups and i - 1 - groups[-1][1] < 3 and start - groups[-1][1] < 3:
                groups[-1][1] = i - 1
            else:
                groups.append([start, i - 1])
            start = None
    for g in groups:
        rows = np.where(m[:, g[0]:g[1] + 1].any(axis=1))[0]
        g.append(int(rows.max() - rows.min() + 1))
    hmax = max(g[2] for g in groups)
    k = len(groups)
    while k > 1 and groups[k - 1][2] < 0.6 * hmax:
        k -= 1
    if k == len(groups):
        raise SystemExit("%s: no short tail glyph in %s" % (sid, rect))
    cut = (groups[k - 1][1] + groups[k][0]) // 2
    w, h = rect[2], rect[3]
    return (x, y, cut + 1, h), (x + cut, y, w - cut, h)


# ---------------------------------------------------------------- element builders (deck.py shapes)
def T(name, kind, text, font, size, color, rect, leading, justify="left", boxw=0, key=None, track_=0, ranges=None, expr=None, core=None):
    return dict(name=name, kind=kind, text=text, font=font, size=size, color=c3(color), rect=tuple(int(round(v)) for v in rect),
                leading=leading, justify=justify, boxw=boxw, thr=None, key=c3(key) if key else None, g=None, k=0,
                persist=None, track=track_, ranges=ranges or [], expr=expr, core=core)


def FR(name, x, y, w, h, r, color, sw=1, align="I", fill=None):
    return dict(name=name, kind="frame", x=x, y=y, w=w, h=h, r=r, color=c3(color), sw=sw, align=align,
                fill=c3(fill) if fill else None, g=None, k=0, persist=None,
                rect=(int(x) - 3, int(y) - 3, int(w) + 7, int(h) + 7))


def LN(name, x1, y1, x2, y2, color, sw=1, key=None):
    horiz = abs(x2 - x1) >= abs(y2 - y1)
    return dict(name=name, kind="line", x=x1, y=y1, x2=x2, y2=y2, w=abs(x2 - x1) if horiz else abs(y2 - y1),
                color=c3(color), sw=sw, g=None, k=0, thr=30, key=c3(key) if key else None,
                rect=(int(min(x1, x2)) - 2, int(min(y1, y2)) - 2, int(abs(x2 - x1)) + 5, int(abs(y2 - y1)) + 5))


def IMG(name, file, x, y, w, h, scale, thr=60, fit=True, key=None):
    return dict(name=name, kind="icon", file=file, x=x, y=y, scale=scale, g=None, k=0, thr=thr, fit=fit,
                key=c3(key) if key else None, rect=(int(x) - 3, int(y) - 3, int(w) + 7, int(h) + 7))


def GLOW(name, x, y, w, h, r, sw=1, scol=PURPLE, thr=60):
    return dict(name=name, kind="glow", x=x, y=y, w=w, h=h, r=r, g=None, k=0, dark=False, sw=sw,
                scol=c3(scol), sop=100, thr=thr, center=False,
                rect=(int(x) - 3, int(y) - 3, int(w) + 7, int(h) + 7))


def PILL(name, text, x, y, w, h, size, font=SEMI):
    return dict(name=name, kind="pill", x=x, y=y, w=w, h=h, r=h / 2, color=[1, 1, 1], g=None, k=0,
                rect=(int(x) - 3, int(y) - 3, int(w) + 7, int(h) + 7), text=text, font=font, size=size,
                tcolor=c3(INK), trect=(int(x) + 8, int(y) + 4, int(w) - 16, int(h) - 8), key=c3(INK))


# ---------------------------------------------------------------- classification
def is_glow(n):
    return any(f.get("t") == "GR" for f in n.get("fl", []))


def solid(n):
    fl = n.get("fl") or []
    return tuple(fl[0]["c"]) if fl and fl[0].get("t") == "S" else None


def text_kind(size, style, y, title_slide, divider, in_panel=False):
    if divider:
        return "statement"
    if size <= 14:
        return "note"
    if style == "Semibold" and size == 32 and y < 100 and not in_panel:
        return "kicker"
    if title_slide and size >= 100:
        return "block"
    if style == "Semibold" and size >= 60 and y < 270 and not in_panel:
        return "hero"
    if size >= 100:
        return "text"
    if style in ("Semibold", "Medium") or size >= 40:
        return "cardTitle"
    return "cardBody"


def build(film):
    nodes, geo = load_nodes()
    return {sid: build_slide(sid, nodes[sid], geo) for sid in FILMS[film]}


def build_slide(sid, nodes, geo):
    import artkit
    title_slide = sid in ("p01", "h01", "b01")
    divider = sid in ("p06", "h04", "b04")
    raw_dims = {f.name: Image.open(f).size for f in sorted(ASSETS.glob(f"f/{sid}_raw*.png"))}
    glow_rects = [tuple(n["b"]) for n in nodes if is_glow(n)]
    counters = {}

    def nm(prefix):
        counters[prefix] = counters.get(prefix, 0) + 1
        return "%s_%s%d" % (sid, prefix, counters[prefix])

    def inside(b, box, m=2):
        return b[0] >= box[0] - m and b[1] >= box[1] - m and b[0] + b[2] <= box[0] + box[2] + m and b[1] + b[3] <= box[1] + box[3] + m

    def overlaps_glow(b):
        return any(b[0] < gx + gw and b[0] + b[2] > gx and b[1] < gy + gh and b[1] + b[3] > gy for gx, gy, gw, gh in glow_rects)

    def clip_below(b):
        """Top of the nearest text node below b that shares its columns (a growth limit)."""
        tops = [t["b"][1] for t in nodes if t["t"] == "TEXT" and t["b"] is not b and t["b"][1] >= b[1] + b[3] - 2
                and t["b"][0] < b[0] + b[2] and t["b"][0] + t["b"][2] > b[0]]
        return min(tops) if tops else 1080

    # --- background art (planet / rays) into the art kit
    art = None
    for n in nodes:
        if n["n"].startswith("image 22") and n["i"] in geo:
            g = geo[n["i"]]
            art = dict(planet=dict(x=g["x"], y=g["y"], w=g["w"], h=g["h"], rot=g["rot"], tr=g["fill"]["tr"]), orbit=None,
                       w_planet=0.8 if sid[0] != "h" else -0.8, w_orbit=0)
        if n["t"] == "VECT" and n["n"] == "Vector" and n["b"][2] > 5000 and n["i"] in geo:
            g = geo[n["i"]]
            art = dict(planet=None, orbit=dict(x=g["x"], y=g["y"], w=g["w"], h=g["h"], rot=g["rot"], svg="s09_vec.svg", sw=1.1395),
                       w_planet=0, w_orbit=0.5 if sid[0] != "h" else -0.5)
    if art:
        artkit.ART[sid] = art

    white_plates = [n for n in nodes if n["t"] in ("FRAM", "RECT") and solid(n) == WHITE and n.get("cr", 0) >= 24]
    pills = [n for n in white_plates if n["b"][3] <= 60 and n["b"][2] < 600]
    PLATES[sid] = [tuple(n["b"]) for n in white_plates]
    EXCL[sid] = [tuple(n["b"]) for n in white_plates] + \
                [tuple(n["b"]) for n in nodes if n["b"][2] < 1000 and ((n.get("fl") and n["fl"][0].get("t") == "I") or (n["t"] == "VECT" and n["n"].startswith("Logo")))]
    used = set()
    content = []           # (y, x, element)

    def add(el):
        content.append((el["rect"][1], el["rect"][0], el))

    for pn in pills:
        label = next((t for t in nodes if t["t"] == "TEXT" and inside(t["b"], pn["b"]) and t.get("c") == list(INK)), None)
        x, y, w, h = pn["b"]
        used.add(pn["i"])
        if label:
            used.add(label["i"])
            add(PILL(nm("pill"), clean(label["s"]).strip(), x, y, w, h, label["f"][0]))
        else:
            add(FR(nm("bar"), x, y, w, h, min(pn.get("cr", 0), h / 2), WHITE, sw=0, fill=WHITE))

    for n in nodes:
        if n.get("off") or n["t"] == "GROU" or n["i"] in used:
            continue
        b = n["b"]; x, y, w, h = b
        if n["n"].startswith("image 22") or (n["t"] == "VECT" and n["n"] == "Vector" and w > 5000):
            continue
        fills = n.get("fl") or []
        sk = n.get("sk")
        if n["t"] == "TEXT":
            if not n["s"].strip() or n["s"].strip() == "QR":            # the QR placeholder sits under the bitmap
                continue
            for el in text_elements(sid, n, title_slide, divider, overlaps_glow, nm, art is not None, clip_below):
                add(el)
            continue
        if n["t"] == "LINE" or (n["t"] in ("RECT", "VECT") and (h <= 2 or w <= 2) and not fills and sk):
            col = tuple(sk["c"]) if sk else (89, 89, 89)
            if sk and sk.get("a") is not None and sk["a"] < 1:
                col = tuple(int(round(c * sk["a"])) for c in col)
            sw = sk.get("w", 1) if sk else 1
            on_white = any(inside(b, p["b"]) for p in white_plates)
            key = col if on_white else None
            if w >= h:
                add(LN(nm("h"), x, y + h / 2, x + w, y + h / 2, col, sw=sw, key=key))
            else:
                add(LN(nm("v"), x + w / 2, y, x + w / 2, y + h, col, sw=sw, key=key))
            continue
        if n["t"] == "RECT" and solid(n) and h <= 2:
            col = tuple(int(round(c * n.get("o", 1))) for c in solid(n))
            add(LN(nm("h"), x, y + h / 2, x + w, y + h / 2, col, sw=max(1, h)))
            continue
        if fills and fills[0].get("t") == "I":
            raw = match_raw(n, raw_dims)
            if w >= 200:                                   # QR bitmap: exact geometry, nothing to fit
                add(IMG(nm("qr"), "f/" + raw, x, y, w, h, 100 * w / raw_dims[raw][0], fit=False))
            else:
                add(IMG(nm("ic"), "f/" + raw, x, y, w, h, 50))
            continue
        if n["t"] == "VECT" and n["n"].startswith("Logo"):
            add(IMG(nm("logo"), "f/%s_logo.png" % sid, x, y, w, h, 50, thr=100, key=WHITE))
            continue
        if is_glow(n):
            name = "%s_glow%d" % (sid, len([1 for e in content if e[2]["kind"] == "glow"]) + 1)
            if x > 900 and w > 800:
                name = "glowR"
            elif w > 1700:
                name = "glowW"
            add(GLOW(name, x, y, w, h, min(n.get("cr", 50), h / 2), sw=sk.get("w", 1) if sk else 0))
            continue
        if sk and n["t"] in ("VECT", "RECT", "FRAM"):
            col = tuple(sk["c"]) if isinstance(sk.get("c"), list) else PURPLE
            name = nm("f")
            if x < 70 and 870 <= w <= 890 and y < 320:
                name = "fTask"
            elif x < 70 and 870 <= w <= 890 and y > 540:
                name = "fSol"
            add(FR(name, x, y, w, h, min(n.get("cr", 0), h / 2), col, sw=sk.get("w", 1), align=sk.get("al", "I"), fill=solid(n)))
            continue
        if solid(n) and n["t"] in ("RECT", "FRAM"):
            add(FR(nm("plate"), x, y, w, h, min(n.get("cr", 0), h / 2), solid(n), sw=0, fill=solid(n)))
            continue

    # role names only when unique on the slide (three stacked glowW panels on b03 stay separate)
    for role in ("glowW", "glowR"):
        same = [e for _, _, e in content if e["name"] == role]
        if len(same) > 1:
            for i, e in enumerate(same):
                e["name"] = "%s_%s%d" % (sid, role, i + 1)
    # --- reading order: heads by beat, content in rows of 50 px, columns by x
    content.sort(key=lambda t: (round(t[0] / 50), t[1]))
    heads = [el for _, _, el in content if el["kind"] in HEADS]
    rows, cur_y = [], None
    for y, x, el in content:
        if el["kind"] in HEADS:
            continue
        if cur_y is None or y - cur_y > 50:
            rows.append([]); cur_y = y
        rows[-1].append(el)
    for gi, row in enumerate(rows):
        row.sort(key=lambda e: (e["rect"][0] // 150, e["rect"][1]))
        for ki, el in enumerate(row):
            el["g"] = gi; el["k"] = ki
    els = heads + [el for row in rows for el in row]
    n_content = sum(len(r) for r in rows)
    secs = 6.0 if title_slide else (4.5 if divider else min(9.0, 6.3 + 0.13 * n_content))
    spec = dict(secs=round(secs, 2), els=els)
    if art:
        spec["art"] = sid; spec["keytol"] = 40
    return spec


def match_raw(n, raw_dims):
    """The raw export whose aspect matches the node (icons at 2x, QR bitmaps ~2.5x)."""
    w, h = n["b"][2], n["b"][3]
    best = None
    for name, (rw, rh) in raw_dims.items():
        if rw > 3000:
            continue
        score = abs(rw / rh - w / h) + (0 if (w >= 200) == (rw >= 800) else 10)
        if best is None or score < best[0]:
            best = (score, name)
    return best[1]


def segments_of(n, raw):
    segs = n.get("segd")
    if not segs:
        segs = [[s[0], s[1], s[2], s[3], s[4], n.get("lh"), n.get("ls")] for s in n.get("seg", [])]
    if not segs:
        segs = [[0, len(raw), n.get("c"), n["f"][0], n["f"][1], n.get("lh"), n.get("ls")]]
    return segs


def text_elements(sid, n, title_slide, divider, overlaps_glow, nm, art, clip_below=lambda b: 1080):
    """One or more elements for a TEXT node (paragraph / column split when styles differ)."""
    raw = clean(n["s"]).rstrip("\r\n")
    segs = segments_of(n, raw)
    x, y, w, h = n["b"]
    line_box = max(s[3] for s in segs) * 1.15
    # Figma boxes are often smaller than their content (a 51 px box holding two 44 px lines): look up to
    # three line boxes down, stopping above the next text node, and let the ink decide
    if h < line_box:
        y, h = y - (line_box - h) / 2, line_box
    h = max(h, min(3 * line_box, clip_below(n["b"]) - 6 - y))
    box = (x - 4, y - 6, w + 12, h + 12)
    styles = {(s[3], s[4]) for s in segs}
    paras = raw.split("\n")
    key = [list(c) for c in {tuple(s[2] or n.get("c") or WHITE) for s in segs}]
    lists = LIST_NODES.get(n["i"], set())
    if (n.get("ps", 0) > 0 or len(styles) > 1 or lists) and len(paras) > 1:
        rects = None
        if lists:
            rects = list_paragraph_rects(sid, box, len(paras), min(s[3] for s in segs), n["b"][0], key=key)
        if rects is None:
            rects = paragraph_rects(sid, box, len(paras), min(s[3] for s in segs), key=key, thr=100)
        els, pos = [], 0
        for pi, ptxt in enumerate(paras):
            seg = next((s for s in segs if s[0] <= pos < s[1]), segs[0])
            start = pos
            pos += len(ptxt) + 1
            if not ptxt.strip():
                continue
            prect = rects[pi]
            if pi in lists:                                   # bullet layer + the item's text layer
                brect, prect = split_bullet(sid, prect, seg[3], key=key)
                bel = _one(sid, n, BULLET, seg, [[0, 1, seg[2], seg[3], seg[4], seg[5], seg[6]]], 0, brect,
                           title_slide, divider, overlaps_glow, nm, art)[0]
                bel["kind"] = "cardBody"
                els.append(bel)
            for el in _one(sid, n, ptxt, seg, segs, start, prect, title_slide, divider, overlaps_glow, nm, art):
                if els and els[0]["kind"] in ("hero", "block") and el["kind"] not in ("hero", "block"):
                    el["kind"] = "lead"
                els.append(el)
        return els
    if len(styles) > 1 and len(paras) == 1:                  # "20 000" + rouble on one line
        segs2 = []
        for s in segs:
            if segs2 and (segs2[-1][3], segs2[-1][4]) == (s[3], s[4]):
                segs2[-1][1] = s[1]
            else:
                segs2.append(list(s))
        if len(segs2) == 2:
            r_big, r_small = split_tail(sid, box, key=key)
            a = _one(sid, n, raw[segs2[0][0]:segs2[0][1]].rstrip(), segs2[0], segs, 0, r_big, title_slide, divider, overlaps_glow, nm, art)[0]
            b = _one(sid, n, raw[segs2[1][0]:segs2[1][1]], segs2[1], segs, segs2[1][0], r_small, title_slide, divider, overlaps_glow, nm, art)[0]
            b["kind"] = a["kind"]
            return [a, b]
    r = one_text(sid, n, raw.replace("\n", "\r"), segs[0], segs, 0, box, title_slide, divider, overlaps_glow, nm, art)
    return r if isinstance(r, list) else [r]


def one_text(sid, n, text, seg, segs, offset, rect, title_slide, divider, overlaps_glow, nm, art):
    size, style = seg[3], seg[4]
    # leading of the paragraph's dominant run (a label with its own line height only moves its own line)
    runs = [(min(s[1], offset + len(text)) - max(s[0], offset), s) for s in segs]
    dom = max(runs, key=lambda r: r[0])[1]
    lh = pct(dom[5] if dom[5] not in (None, "mix") else n.get("lh"), size)
    ls = dom[6] if dom[6] is not None else n.get("ls")
    o = n.get("o") if n.get("o") not in (None, 1) else 1          # layer opacity baked into the colour (black ground)
    color = tuple(int(round(v * o)) for v in (seg[2] or n.get("c") or WHITE))
    just = {"L": "left", "C": "center", "R": "right"}.get(n.get("al", "L"), "left")
    ranges = []
    for s in segs:
        c = tuple(int(round(v * o)) for v in (s[2] or color))
        if c == color:
            continue
        a, b = max(s[0], offset) - offset, min(s[1], offset + len(text)) - offset
        if b > a:
            ranges.append([a, b, c3(c)])
    colours = [color] + [tuple(int(round(v * 255)) for v in r[2]) for r in ranges]
    colours = list(dict.fromkeys(colours))
    key = colours[0] if len(colours) == 1 else colours          # the verifier keys on the same colours
    plate = on_plate(sid, n["b"]) if color == INK else None      # by the node box: the grown rect may leave the plate
    if plate:
        rect = clip_rect(rect, plate)
    rect, core = tight(sid, rect, size, key=key, tol=40, min_h=3 if text == BULLET else None)   # a bullet is one short band
    if plate and core is not None:
        rect = clip_rect(rect, plate)
    if core is None:
        raise SystemExit("%s: no ink for %r in %s" % (sid, text[:30], rect))
    kind = text_kind(size, style, n["b"][1], title_slide, divider, overlaps_glow(core))
    boxw = n["b"][2] if core[3] > lh * 1.4 else 0
    vt = [i for i, ch in enumerate(text) if ch == "\x0b"]        # a vertical tab renders as nothing in Figma
    if vt:
        text = text.replace("\x0b", "")
        ranges = [[ra - sum(1 for i in vt if i < ra), rb - sum(1 for i in vt if i < rb), rc] for ra, rb, rc in ranges]
        vt = []
    expr = None
    if re.match(r"^(\d+)(\s*\u2192\s*)(\d+)$", text) and size >= 100:
        return kpi_elements(sid, n, text, seg, segs, rect, nm, color, lh, ls, key, size, style, just)
    el = T(nm("t"), kind, text, STYLE.get(style, REG), size, color, rect, leading=round(lh, 2), justify=just, boxw=boxw,
           key=None, track_=track(ls), ranges=ranges, expr=expr, core=core)
    el["key"] = c3(key) if len(colours) == 1 else [c3(c) for c in key]
    el["vt"] = vt
    return el


def _one(*args, **kw):
    r = one_text(*args, **kw)
    return r if isinstance(r, list) else [r]


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    film = sys.argv[1] if len(sys.argv) > 1 else "2"
    for sid, sp in build(film).items():
        print("== %s  %.1fs  art=%s" % (sid, sp["secs"], sp.get("art")))
        for el in sp["els"]:
            desc = el.get("text", "")[:44].replace("\r", " / ") if "text" in el else ""
            extra = ""
            if el.get("ranges"):
                extra += " ranges=%s" % [(a, b) for a, b, _ in el["ranges"]]
            if el.get("expr"):
                extra += " COUNT-UP"
            if el.get("key"):
                extra += " key"
            print("  %-12s %-9s g=%-4s k=%-2s %-22s %s%s" % (el["name"], el["kind"], el.get("g"), el.get("k"),
                                                             tuple(int(v) for v in el["rect"]), desc, extra))
