# -*- coding: utf-8 -*-
"""Ground-truth check: is the packed word figure actually inside the letter
mask, and at what scale does the real mark's knock-out cover it?

mark_fit solved the mark's placement from form_ya's chain and got a letter
1827 px wide, but the packed words measure 2188 px across. Both cannot be true -
the packer only accepts a slot when the whole ink box is on mask - so one of the
two derivations is wrong, and guessing which would be how a 200 px error gets
built into the shot. This measures the mask and the slots in one place.
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))

G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
sys.argv = [sys.argv[0], "--v6"]
_b, sys.stdout = sys.stdout, io.StringIO()
exec(compile(open(G["__file__"], encoding="utf-8").read(), G["__file__"], "exec"), G)
sys.stdout = _b
WORDS, BOX = G["WORDS"], G["BOX"]
FORM_DX, FORM_DY = G["FORM_DX"], G["FORM_DY"]

lay = json.load(open(os.path.join(HERE, "ya_layout.json"), encoding="utf-8"))
DIAM = int(lay["diam"])
print("layout diam %d   gen shift %.1f, %.1f" % (DIAM, FORM_DX, FORM_DY))

MARK = ("C:\\Users\\\u0413\u043b\u0435\u0431\\Downloads\\"
        "\u043e\u0431\u043b\u0430\u043a\u043e \u0442\u0435\u0433\u043e\u0432\\"
        "\u041b\u043e\u0433\u043e\\IMG_1492.WEBP")


def letter_mask(diam):
    a = Image.open(MARK).convert("RGBA").split()[3]
    a = a.crop(a.getbbox()).resize((diam, diam), Image.LANCZOS)
    r = int(diam * 0.75 / 2)
    disc = Image.new("L", (diam, diam), 0)
    ImageDraw.Draw(disc).ellipse((diam // 2 - r, diam // 2 - r,
                                  diam // 2 + r, diam // 2 + r), fill=255)
    inv = a.point(lambda v: 255 if v < 60 else 0)
    return Image.composite(inv, Image.new("L", (diam, diam), 0), disc)


# --- the slots, exactly as gen_cloud reads them (pre-shift, as stored) --------
boxes = []
for s in lay["slots"]:
    i = s["i"]
    k = s["pt"] / float(WORDS[i][2])
    w, h = BOX[i]["wd"] * k, BOX[i]["ht"] * k
    boxes.append((s["x"] - w / 2.0, s["y"] - h / 2.0,
                  s["x"] + w / 2.0, s["y"] + h / 2.0))
ux0 = min(b[0] for b in boxes); ux1 = max(b[2] for b in boxes)
uy0 = min(b[1] for b in boxes); uy1 = max(b[3] for b in boxes)
print("slot ink bbox (as stored)  x %.0f..%.0f  y %.0f..%.0f   %.0f x %.0f"
      % (ux0, ux1, uy0, uy1, ux1 - ux0, uy1 - uy0))

lm = letter_mask(DIAM)
bx = lm.getbbox()
print("letter bbox in mask space  %s   %d x %d"
      % (bx, bx[2] - bx[0], bx[3] - bx[1]))

# Where must the mask sit so the letter covers the slots? Solve from the slot
# bbox, not from form_ya's centring rule - the slots are the thing that exists.
sx = (ux1 - ux0) / float(bx[2] - bx[0])
sy = (uy1 - uy0) / float(bx[3] - bx[1])
print("slot bbox / letter bbox    x %.4f   y %.4f" % (sx, sy))

# containment test at form_ya's own placement
ox = 2048 - (bx[0] + bx[2]) // 2
oy = 1080 - (bx[1] + bx[3]) // 2
m = np.asarray(lm) > 200
bad = 0
worst = 0.0
for (x0, y0, x1, y1) in boxes:
    c0, r0 = int(round(x0 - ox)), int(round(y0 - oy))
    c1, r1 = int(round(x1 - ox)), int(round(y1 - oy))
    if c0 < 0 or r0 < 0 or c1 >= DIAM or r1 >= DIAM:
        bad += 1; worst = max(worst, 1.0); continue
    sub = m[r0:r1 + 1, c0:c1 + 1]
    off = 1.0 - sub.mean() if sub.size else 1.0
    if off > 0.001:
        bad += 1; worst = max(worst, off)
print("boxes not fully on mask at form_ya placement: %d of %d (worst %.1f%% off)"
      % (bad, len(boxes), 100 * worst))
