"""diffexport.py — compare a Figma export at the delivery scale (download_assets defaultScale = outW / FW,
RGBA) with an HTML still rendered at that size (film.js --outw). The export is composited over the stage
colour first (frames without a fill are transparent where the body does not reach).
    python diffexport.py figma.png html.png [out_diff.png] [--bg 26d07c]
"""
import sys
import numpy as np
from PIL import Image
args = [a for a in sys.argv[1:] if not a.startswith("--")]
bg_hex = sys.argv[sys.argv.index("--bg") + 1] if "--bg" in sys.argv else "26d07c"
if "--bg" in sys.argv:
    args.remove(bg_hex)
fa, fb = args[0], args[1]
a = Image.open(fa).convert("RGBA")
bg = Image.new("RGBA", a.size, tuple(int(bg_hex[i:i + 2], 16) for i in (0, 2, 4)) + (255,))
a = np.asarray(Image.alpha_composite(bg, a).convert("RGB")).astype(np.int16)
b = np.asarray(Image.open(fb).convert("RGB")).astype(np.int16)
H, W = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
d = np.abs(a[:H, :W] - b[:H, :W]).max(axis=2)
print("%s  %dx%d  mean %.3f  >24 %.3f%%  >64 %.3f%%" % (fb, W, H, d.mean(), 100 * (d > 24).mean(), 100 * (d > 64).mean()))
if len(args) > 2:
    Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).save(args[2])
