"""figma_changes.py — after a designer's edit round: crop every storyboard frame out of fresh section renders
and report which frames changed against the previous crops (a round of edits is usually partial — some frames
get the fix, some keep the old state; see reference/html-figma-1to1.md, «Review rounds»).

    python figma_changes.py sections.json
    sections.json: {
      "render_dir": "figma/v2",          # fresh get_screenshot renders of each section, 1:1 with a 40 px margin
      "old_dir": "figma/frames",         # previous crops (sN_fNN.png); missing ones are reported as new
      "out_dir": "figma/frames_v2",      # new crops go here
      "frame": [791, 1406],              # frame size in the render (Figma units at 1:1)
      "pad": 40,
      "sections": { "1": { "png": "sec1.png", "xs": [1400, 2360, ...], "y": 820 }, ... }
    }
xs / y: each frame's top-left in the section's own coordinates (from get_metadata or a use_figma dump), in
storyboard order. A change is > 30 pixels whose max channel difference exceeds 24 (column 0 ignored: frames
with a body at x 0.53 blend the section colour there, quirk #195). A whole-frame change with no layout change
usually means the section was dimmed (parked) — ask before rebuilding it.
"""
import json, os, sys
import numpy as np
from PIL import Image

cfg_path = sys.argv[1]
cfg = json.load(open(cfg_path, encoding="utf-8"))
base = os.path.dirname(os.path.abspath(cfg_path))
rd = lambda k: os.path.join(base, cfg[k])
W, H = cfg.get("frame", [791, 1406])
PAD = cfg.get("pad", 40)
os.makedirs(rd("out_dir"), exist_ok=True)
for s, sec in cfg["sections"].items():
    im = Image.open(os.path.join(rd("render_dir"), sec["png"])).convert("RGB")
    for i, x in enumerate(sec["xs"]):
        c = im.crop((x + PAD, sec["y"] + PAD, x + PAD + W, sec["y"] + PAD + H))
        name = "s%s_f%02d.png" % (s, i + 1)
        c.save(os.path.join(rd("out_dir"), name))
        old = os.path.join(rd("old_dir"), name)
        if not os.path.exists(old):
            print("%-14s new" % name)
            continue
        a = np.asarray(Image.open(old).convert("RGB")).astype(int)
        b = np.asarray(c).astype(int)
        d = np.abs(a - b).max(axis=2) > 24
        d[:, 0] = False
        if d.sum() < 30:
            print("%-14s same (%d px)" % (name, d.sum()))
        else:
            ys, xs = np.where(d)
            share = 100.0 * d.mean()
            hint = "  (whole frame — dimmed/parked section?)" if share > 60 else ""
            print("%-14s CHANGED %7d px %5.1f %%  bbox x %d..%d y %d..%d%s" % (name, d.sum(), share, xs.min(), xs.max(), ys.min(), ys.max(), hint))
