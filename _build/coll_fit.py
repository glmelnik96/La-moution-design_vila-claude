# -*- coding: utf-8 -*-
"""Asked: what is the largest scale at which the collapsed word figure sits
wholly INSIDE the mark's knock-out? Answered: there isn't one, at any size.

It was worth asking. COLL_S fits bounding box to bounding box, which is only
right if the knock-out were a rectangle, and on the f1062 render KOLLEKTIV came
back both legible and sliced by the letter's shoulder - which does not read as
"the words are behind the mark", it reads as a clipping bug. The obvious fix is
to shrink until nothing overhangs.

The answer is that the knock-out is not the solid slab it looks like at a glance.
It carries the mark's own internal blue strokes - the doubled line down the leg -
so it is a thin, branching shape, and the centre of its own bounding box is ON
blue, not in the hole (LETTER[lf_cx, lf_cy] == 0). Bisecting from 0.60 down to
0.02 never finds a scale where all 112 ink boxes clear it, because the figure is
a rectangle of rectangles and there is no useful rectangle inside a Ya.

So cropping is not avoidable and the beat has to dress it instead: retire the
words in size order, biggest first, so that whatever is still inside the letter
when the mark goes opaque is too small to read as a word at all. gen_cloud's OPA
loop carries that. Keep this script - it is the evidence that the cheaper fix was
tried and is not available.
"""
import io
import json
import os
import sys

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))

G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
sys.argv = [sys.argv[0], "--v6"]
_b, sys.stdout = sys.stdout, io.StringIO()
exec(compile(open(G["__file__"], encoding="utf-8").read(), G["__file__"], "exec"), G)
sys.stdout = _b

CX, CY, MARK_D = G["CX"], G["CY"], G["MARK_D"]
BOXES = G["_bx"]                      # pre-shift ink boxes (x0, x1, y0, y1)
FORM_DX, FORM_DY = G["FORM_DX"], G["FORM_DY"]
mf = json.load(open(os.path.join(HERE, "mark_fit.json"), encoding="utf-8"))
LET_CX = CX + (mf["lf_cx"] - 0.5) * MARK_D
LET_CY = CY + (mf["lf_cy"] - 0.5) * MARK_D

REF = 1024                            # 1 px = MARK_D/REF = 1.12 comp px
a = Image.open(os.path.join(HERE, "mark_ya.png")).convert("RGBA").split()[3]
a = a.resize((REF, REF), Image.LANCZOS)
r = int(REF * 0.75 / 2)
disc = Image.new("L", (REF, REF), 0)
ImageDraw.Draw(disc).ellipse((REF // 2 - r, REF // 2 - r,
                              REF // 2 + r, REF // 2 + r), fill=255)
inv = a.point(lambda v: 255 if v < 60 else 0)
LETTER = Image.composite(inv, Image.new("L", (REF, REF), 0), disc)
PIX = LETTER.load()

# the figure's own centre, which is where FORM_DX/DY put it
shift = [(b[0] + FORM_DX, b[1] + FORM_DX, b[2] + FORM_DY, b[3] + FORM_DY)
         for b in BOXES]


def to_mask(qx, qy):
    return ((qx - CX) / MARK_D + 0.5) * REF, ((qy - CY) / MARK_D + 0.5) * REF


def off_fraction(s):
    """Worst per-box fraction of ink box area lying off the knock-out."""
    worst = 0.0
    for (x0, x1, y0, y1) in shift:
        wx0 = (x0 - CX) * s + LET_CX
        wx1 = (x1 - CX) * s + LET_CX
        wy0 = (y0 - CY) * s + LET_CY
        wy1 = (y1 - CY) * s + LET_CY
        mx0, my0 = to_mask(wx0, wy0)
        mx1, my1 = to_mask(wx1, wy1)
        c0, r0 = int(mx0), int(my0)
        c1, r1 = int(mx1) + 1, int(my1) + 1
        if c0 < 0 or r0 < 0 or c1 > REF or r1 > REF:
            return 1.0
        sub = LETTER.crop((c0, r0, c1, r1))
        n = sub.size[0] * sub.size[1]
        if not n:
            continue
        # histogram is far faster than per-pixel python
        h = sub.histogram()
        on = sum(h[201:])
        worst = max(worst, 1.0 - on / float(n))
    return worst


def solve(tol):
    lo, hi = 0.02, 0.60
    for _ in range(34):
        mid = (lo + hi) / 2.0
        if off_fraction(mid) <= tol:
            lo = mid
        else:
            hi = mid
    return lo


INK_W = max(b[1] for b in BOXES) - min(b[0] for b in BOXES)
INK_H = max(b[3] for b in BOXES) - min(b[2] for b in BOXES)
lw = (mf["lf_x1"] - mf["lf_x0"]) * MARK_D
lh = (mf["lf_y1"] - mf["lf_y0"]) * MARK_D
bbox_fit = min(lw / INK_W, lh / INK_H)

print("ink %0.0f x %0.0f    letter %0.0f x %0.0f    mark %0.0f" % (INK_W, INK_H, lw, lh, MARK_D))
print("bbox fit      %.5f   (worst box %.1f%% off mask)" % (bbox_fit, 100 * off_fraction(bbox_fit)))
for tol in (0.0, 0.02, 0.05, 0.10):
    s = solve(tol)
    print("tol %4.0f%%      %.5f   -> figure %4.0f px wide, hero cap ~%3.0f pt"
          % (100 * tol, s, INK_W * s, 370 * s))
