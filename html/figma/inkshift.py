"""inkshift.py — sub-pixel offset and ink mass of a region, Figma vs HTML.
    python tools/inkshift.py figma.png html.png x0 y0 x1 y1 [bg=26d07c]
Ink = distance from the background colour, per pixel. Prints centroid dx/dy (html - figma), the ink mass
ratio (weight / gamma difference) and the ink bbox of each.
"""
import sys
import numpy as np
from PIL import Image
fa, fb = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = [int(v) for v in sys.argv[3:7]]
bg = sys.argv[7] if len(sys.argv) > 7 else "26d07c"
bgc = np.array([int(bg[i:i + 2], 16) for i in (0, 2, 4)], float)
def ink(p):
    a = np.asarray(Image.open(p).convert("RGB")).astype(float)[y0:y1, x0:x1]
    return np.abs(a - bgc).max(axis=2)
A, B = ink(fa), ink(fb)
def stats(I):
    m = I.sum()
    ys, xs = np.mgrid[0:I.shape[0], 0:I.shape[1]]
    cx, cy = (I * xs).sum() / m, (I * ys).sum() / m
    on = I > 40
    yy, xx = np.where(on)
    bb = (xx.min() + x0, yy.min() + y0, xx.max() + x0, yy.max() + y0) if len(xx) else None
    return m, cx, cy, bb
ma, ax, ay, abb = stats(A)
mb, bx, by, bbb = stats(B)
print("centroid dx %+.3f dy %+.3f   mass html/figma %.4f   bbox figma %s html %s" % (bx - ax, by - ay, mb / ma, abb, bbb))
