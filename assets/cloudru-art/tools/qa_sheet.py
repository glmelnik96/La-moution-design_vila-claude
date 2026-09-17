# -*- coding: utf-8 -*-
"""Per-slide review sheets: Figma render | AE rest frame | difference heat, three slides per image.
python tools/qa_sheet.py <film>  -> C:/dev/gct-pres/pv/_qa<film>_<k>.png"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
film = sys.argv[1]
d = json.load(open(ROOT / "_build" / ("deck_verify_%s.json" % film), encoding="utf-8"))
pts = d["points"]
ts = sorted(set(p["t_master"] for p in pts))
vf = Path("C:/dev/gct-pres/vf%s" % film)
rows = []
for i, t in enumerate(ts):
    sid = max(p["sid"] for p in pts if p["t_master"] == t)
    ae = Image.open(vf / ("vf_%02d.png" % i)).convert("RGB")
    fg = Image.open(ROOT / "assets" / ("%s_full.png" % sid)).convert("RGB")
    a, b = np.asarray(ae).astype(int), np.asarray(fg).astype(int)
    diff = np.abs(a - b).max(axis=2)
    heat = np.zeros((1080, 1920, 3), np.uint8)
    heat[..., 0] = np.clip(diff * 3, 0, 255)
    heat[..., 1] = np.clip(diff * 1, 0, 255)
    heat[..., 2] = (b.mean(axis=2) * 0.25).astype(np.uint8)
    pct = 100 * (diff > 40).mean()
    rows.append((sid, fg, ae, Image.fromarray(heat), pct))
tw, th = 620, 349
per = 3
for k in range(0, len(rows), per):
    chunk = rows[k:k + per]
    sheet = Image.new("RGB", (tw * 3 + 20, (th + 26) * len(chunk)), (28, 28, 28))
    dr = ImageDraw.Draw(sheet)
    for j, (sid, fg, ae, heat, pct) in enumerate(chunk):
        y = j * (th + 26)
        dr.text((6, y + 4), "%s   Figma | AE | diff  (%.2f%% px > 40)" % (sid, pct), fill=(255, 220, 0))
        for c, im in enumerate((fg, ae, heat)):
            sheet.paste(im.resize((tw, th)), (c * (tw + 10), y + 22))
    sheet.save("C:/dev/gct-pres/pv/_qa%s_%d.png" % (film, k // per))
print("film %s: %d slides, %d sheets" % (film, len(rows), (len(rows) + per - 1) // per))
for sid, _, _, _, pct in rows:
    print("  %s: %.2f%% px differ by >40" % (sid, pct))
