# -*- coding: utf-8 -*-
"""Whole-frame fidelity of the rest frames outside the verified element rects (backgrounds, glow
fields, planets, QR bitmaps): python tools/bgdiff.py <film>"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
film = sys.argv[1]
d = json.load(open(ROOT / "_build" / ("deck_verify_%s.json" % film), encoding="utf-8"))
pts = d["points"]
ts = sorted(set(p["t_master"] for p in pts))
vf = Path("C:/dev/gct-pres/vf" + film)
for i, t in enumerate(ts):
    sids = sorted({p["sid"] for p in pts if p["t_master"] == t})
    sid = sids[-1] if len(sids) == 1 else max(sids)      # persisting layers carry earlier sids
    ae = np.asarray(Image.open(vf / ("vf_%02d.png" % i)).convert("RGB")).astype(int)
    fg = np.asarray(Image.open(ROOT / "assets" / ("%s_full.png" % sid)).convert("RGB")).astype(int)
    diff = np.abs(ae - fg).max(axis=2)
    m = np.ones(diff.shape, bool)
    for p in pts:
        if p["t_master"] == t:
            x, y, w, h = [int(v) for v in p["rect"]]
            m[max(0, y - 2):y + h + 2, max(0, x - 2):x + w + 2] = False
    rest = diff[m]
    bad = (rest > 40).mean() * 100
    ys, xs = np.where((diff > 40) & m)
    hot = ""
    if len(xs):
        hot = " hot bbox x %d-%d y %d-%d" % (xs.min(), xs.max(), ys.min(), ys.max())
    print("%s (frame %02d, t %.2f): outside elements mean %.2f/255, p99 %d, >40: %.3f%%%s" % (sid, i, t, rest.mean(), np.percentile(rest, 99), bad, hot))
    Image.fromarray(np.clip(diff * 3, 0, 255).astype("uint8")).save("C:/dev/gct-pres/pv/_bgdiff_%s_%s.png" % (film, sid))
