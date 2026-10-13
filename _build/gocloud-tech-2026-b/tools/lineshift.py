"""lineshift.py — per text line: sub-pixel shift (dx, dy) of the HTML rest frame against the Figma render,
from ink profiles (rows → dy, columns → dx) cross-correlated inside each line box.

    python tools/lineshift.py <lines.json> <ref.png> <html.png>
lines.json: [[x, y, w, h, fontSize, lineHeight, color, text], …] — every .lt box of the slide (tools/evalpage.js)
"""
import json, sys
import numpy as np
from PIL import Image

L = json.load(open(sys.argv[1]))
A = np.asarray(Image.open(sys.argv[2]).convert('L')).astype(float)
B = np.asarray(Image.open(sys.argv[3]).convert('L')).astype(float)


def prof(img, x0, y0, x1, y1, axis):
    c = img[y0:y1, x0:x1]
    bg = np.median(np.concatenate([c[0], c[-1]]))
    m = np.abs(c - bg)
    return m.sum(axis=axis)


def best(pa, pb):
    n = len(pa)
    xs = np.arange(n)
    bestv, bests = -1e18, 0
    for s in np.arange(-3, 3.001, 0.05):
        sb = np.interp(xs + s, xs, pb, left=0, right=0)   # pb shifted by -s
        v = (pa * sb).sum()
        if v > bestv:
            bestv, bests = v, s
    return bests          # html is displaced by +s relative to ref


for r in L:
    x, y, w, h = r[0], r[1], r[2], r[3]
    size = float(r[4][:-2])
    x0, x1 = int(max(0, x - 6)), int(min(A.shape[1], x + w + 6))
    y0, y1 = int(max(0, y - 0.15 * size)), int(min(A.shape[0], y + h + 0.15 * size))
    dy = best(prof(A, x0, y0, x1, y1, 1), prof(B, x0, y0, x1, y1, 1))
    dx = best(prof(A, x0, y0, x1, y1, 0), prof(B, x0, y0, x1, y1, 0))
    print('%7.1f %7.1f %4s/%-5s dx %+5.2f dy %+5.2f  %s' % (x, y, r[4][:-2], r[5][:-2], dx, dy, r[7]))
