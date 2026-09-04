# -*- coding: utf-8 -*-
"""Draw the FROZEN Ya layout the way the finished comp will show it.

form_ya.py's own preview coloured the type by size, which is a packing diagnostic
- it says "here is a big word" - not a picture of the frame. The comp gives each
word the brand colour it has carried for the previous 28 seconds, and the logo
lockup is still sitting bottom-right. Both change the judgement, so both are
here: this is the composition review, form_ya's preview was the geometry review.

Reads ya_layout.json and takes WORDS/BOX from the generator, so nothing is
re-derived and the picture cannot drift from what will be built.
"""
import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
TTF = "C:/Windows/Fonts/arialbd.ttf"
OUT = "C:/dev/temp/ya_comp.jpg"

G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
sys.argv = [sys.argv[0], "--v6"]
_b, sys.stdout = sys.stdout, io.StringIO()
exec(compile(open(G["__file__"], encoding="utf-8").read(), G["__file__"], "exec"), G)
sys.stdout = _b
WORDS, BOX, W, H = G["WORDS"], G["BOX"], G["W"], G["H"]
DX, DY, rep_colour = G["FORM_DX"], G["FORM_DY"], G["rep_colour"]

L = json.load(open(os.path.join(HERE, "ya_layout.json"), encoding="utf-8"))
im = Image.new("RGB", (W, H), (2, 16, 30))
d = ImageDraw.Draw(im)

x0 = y0 = 10 ** 9
x1 = y1 = -10 ** 9
seen = set()
for s in L["slots"]:
    i = s["i"]
    s["x"] += DX
    s["y"] += DY
    r = s["pt"] / float(WORDS[i][2])
    want = BOX[i]["wd"] * r
    probe = ImageFont.truetype(TTF, 100)
    w100 = d.textbbox((0, 0), WORDS[i][0], font=probe)[2]
    fnt = ImageFont.truetype(TTF, max(8, int(100.0 * want / max(w100, 1))))
    bb = d.textbbox((0, 0), WORDS[i][0], font=fnt)
    # base words keep their cloud colour, repeats are coloured by size
    src = WORDS[i][3] if i not in seen else rep_colour(s["pt"])
    seen.add(i)
    col = tuple(int(round(c * 255)) for c in src)
    d.text((s["x"] - (bb[2] - bb[0]) / 2.0 - bb[0],
            s["y"] - (bb[3] - bb[1]) / 2.0 - bb[1]),
           WORDS[i][0], font=fnt, fill=col)
    hw, hh = BOX[i]["wd"] * r / 2.0, BOX[i]["ht"] * r / 2.0
    x0 = min(x0, s["x"] - hw); x1 = max(x1, s["x"] + hw)
    y0 = min(y0, s["y"] - hh); y1 = max(y1, s["y"] + hh)

# where the lockup sits - same arithmetic as the JSX, so a collision shows up
# here rather than in a 4K render twenty minutes later
LT, LW = 620, 2029
lh = 516 * LT / float(LW)
lx, ly = W - 120 - LT / 2.0, H - 118 - lh / 2.0
d.rectangle((lx - LT / 2, ly - lh / 2, lx + LT / 2, ly + lh / 2),
            outline=(243, 20, 21), width=6)

im.resize((1600, 844), Image.LANCZOS).save(OUT, quality=93)
print("ink   x %.0f..%.0f   y %.0f..%.0f" % (x0, x1, y0, y1))
print("margins  L%.0f R%.0f T%.0f B%.0f" % (x0, W - x1, y0, H - y1))
print("optical centre x %.0f (frame %d)   y %.0f (frame %d)"
      % ((x0 + x1) / 2, W // 2, (y0 + y1) / 2, H // 2))
print("logo box x %.0f..%.0f  y %.0f..%.0f   -> %s"
      % (lx - LT / 2, lx + LT / 2, ly - lh / 2, ly + lh / 2,
         "CLEAR" if x1 < lx - LT / 2 else "OVERLAPS the figure bbox"))
print("preview -> %s" % OUT)
