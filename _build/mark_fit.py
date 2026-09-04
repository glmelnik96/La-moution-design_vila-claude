# -*- coding: utf-8 -*-
"""Emit the Я mark as a PNG After Effects can import, plus where its letterform
sits inside the artwork.

WHAT WAS TRIED FIRST, AND WHY IT WAS DROPPED
--------------------------------------------
The word figure was packed against a mask built from this very mark, so the
closing beat looked like it could be a true match cut: fade the real mark in
over the words, its knock-out landing exactly on the letter they form.

It cannot, and the reason is worth keeping. form_ya's Field.legal() tests a
candidate with win(), which CLIPS the window to the grid and then computes
`need` from the clipped indices - so a box hanging off the letter is only tested
on the part still on the grid, and passes. mark_probe.py measures the damage:
32 of 112 boxes are not fully on the glyph, the worst 68% off. Those are not
edge overhangs; some sit across the letter's internal counters. So no uniform
scale of the knock-out contains the figure - searched to 2.2x, none exists -
because scaling the letter scales its holes too.

The figure the client approved is therefore a Я-ish shape that reads (verified
by squint test), not a copy of the glyph. Forcing the knock-out onto it would
either eat a third of the words under the flooding disc or demand a re-pack of
an approved layout. So the closing beat is a collapse-and-resolve instead, and
what it needs from here is not a match scale but one number: where the letter
sits inside the mark, so the words can compact onto that point rather than onto
the disc's centre.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))

MARK = ("C:\\Users\\\u0413\u043b\u0435\u0431\\Downloads\\"
        "\u043e\u0431\u043b\u0430\u043a\u043e \u0442\u0435\u0433\u043e\u0432\\"
        "\u041b\u043e\u0433\u043e\\IMG_1492.WEBP")
REF = 2000                     # resolution the fractions are measured at

im = Image.open(MARK).convert("RGBA")
alpha = im.split()[3]
bb = alpha.getbbox()
im.crop(bb).save(os.path.join(HERE, "mark_ya.png"))
SRC_W, SRC_H = bb[2] - bb[0], bb[3] - bb[1]

a = alpha.crop(bb).resize((REF, REF), Image.LANCZOS)
r = int(REF * 0.75 / 2)
disc = Image.new("L", (REF, REF), 0)
ImageDraw.Draw(disc).ellipse((REF // 2 - r, REF // 2 - r,
                              REF // 2 + r, REF // 2 + r), fill=255)
inv = a.point(lambda v: 255 if v < 60 else 0)
letter = Image.composite(inv, Image.new("L", (REF, REF), 0), disc)
lx0, ly0, lx1, ly1 = letter.getbbox()

out = {
    "src_w": SRC_W, "src_h": SRC_H,
    # letter bbox as a fraction of the artwork, so any end size works
    "lf_x0": round(lx0 / float(REF), 5), "lf_x1": round(lx1 / float(REF), 5),
    "lf_y0": round(ly0 / float(REF), 5), "lf_y1": round(ly1 / float(REF), 5),
    "lf_cx": round((lx0 + lx1) / 2.0 / REF, 5),
    "lf_cy": round((ly0 + ly1) / 2.0 / REF, 5),
}
json.dump(out, open(os.path.join(HERE, "mark_fit.json"), "w"), indent=1)

print("mark_ya.png  %dx%d" % (SRC_W, SRC_H))
print("letter bbox  %.4f..%.4f x   %.4f..%.4f y   of the artwork"
      % (out["lf_x0"], out["lf_x1"], out["lf_y0"], out["lf_y1"]))
print("letter centre offset from artwork centre:  %+.4f, %+.4f"
      % (out["lf_cx"] - 0.5, out["lf_cy"] - 0.5))
