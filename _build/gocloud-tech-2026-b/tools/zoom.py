"""zoom.py — Figma vs HTML crops, stacked (Figma on top), magnified; plus the ink centroid shift per crop.

    python tools/zoom.py out.png sNN x0 y0 x1 y1 [zoom] [html_dir]
"""
import sys
import numpy as np
from PIL import Image

out, n = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = map(int, sys.argv[3:7])
z = float(sys.argv[7]) if len(sys.argv) > 7 else 2
hdir = sys.argv[8] if len(sys.argv) > 8 else '/home/user/La-moution-design_vila-claude/out/gctb/rest'
a = Image.open('/home/user/La-moution-design_vila-claude/_build/gocloud-tech-2026-b/ref/%s.png' % n).convert('RGB').crop((x0, y0, x1, y1))
b = Image.open('%s/%s.png' % (hdir, n)).convert('RGB').crop((x0, y0, x1, y1))
w, h = int((x1 - x0) * z), int((y1 - y0) * z)
c = Image.new('RGB', (w, h * 2 + 6), (255, 0, 0))
c.paste(a.resize((w, h), Image.NEAREST), (0, 0))
c.paste(b.resize((w, h), Image.NEAREST), (0, h + 6))
c.save(out)


def ink(im):
    g = np.asarray(im.convert('L')).astype(float)
    bg = np.median(g)
    m = np.abs(g - bg)
    m[m < 12] = 0
    if m.sum() == 0:
        return None
    ys, xs = np.mgrid[0:g.shape[0], 0:g.shape[1]]
    return (float((xs * m).sum() / m.sum()), float((ys * m).sum() / m.sum()), float(m.sum()))


ia, ib = ink(a), ink(b)
if ia and ib:
    print('centroid dx %.2f dy %.2f  ink ratio %.3f' % (ib[0] - ia[0], ib[1] - ia[1], ib[2] / ia[2]))
