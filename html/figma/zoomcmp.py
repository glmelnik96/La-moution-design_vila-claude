"""zoomcmp.py — magnified Figma / HTML / diff crops of one region, stacked vertically.
    python tools/zoomcmp.py figma.png html.png x0 y0 x1 y1 [k=4] out.png
"""
import sys
import numpy as np
from PIL import Image, ImageDraw
fa, fb = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = [int(v) for v in sys.argv[3:7]]
k = int(sys.argv[7]) if len(sys.argv) > 8 else 4
out = sys.argv[-1]
a = Image.open(fa).convert("RGB").crop((x0, y0, x1, y1))
b = Image.open(fb).convert("RGB").crop((x0, y0, x1, y1))
d = np.abs(np.asarray(a).astype(int) - np.asarray(b).astype(int)).max(axis=2)
dv = Image.fromarray(np.clip(d * 3, 0, 255).astype(np.uint8)).convert("RGB")
W, H = (x1 - x0) * k, (y1 - y0) * k
sheet = Image.new("RGB", (W, 3 * H + 8), (255, 0, 255))
for i, im in enumerate([a, b, dv]):
    sheet.paste(im.resize((W, H), Image.NEAREST), (0, i * (H + 4)))
ImageDraw.Draw(sheet).text((4, 2), "figma / html / diff  x%d  (%d,%d)-(%d,%d)" % (k, x0, y0, x1, y1), fill=(255, 0, 0))
sheet.save(out)
print(out, sheet.size)
