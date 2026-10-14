"""prep_v2.py — layers added in the reworked layout (Figma section «Лобоцкий OUT2», 2026-10-14).

  servers  «image 210» on the ×5 card: a cut-out (real alpha), CROP itf [[0.5581,0,0.4418],[0,0.67,0]] on a
           976 x 654 node at (119, 437), no filters → the visible part of the raw at raw resolution.
  bull     «image 208» on the green card: a cut-out, FILL on 1988 x 1110 at (1196, 276), filters saturation −1 and
           exposure .39, paint opacity .9, layer blend SCREEN. Screening onto a colour only needs the premultiplied
           filtered value P (a black background is neutral), so the layer ships as an opaque grey image:
           result = A + 0.9 · P · (1 − A). P is solved from the in-context export (backdrop A = #222 there), the
           filter is fitted as a 3D LUT on the raw's colour and applied to the raw at 1.5x frame resolution.

    python tools/prep_v2.py            (from _build/gocloud-tech-2026)
"""
import json
import numpy as np
from PIL import Image

RAW = 'assets/raw2/'
OUT = 'img/'
rep = {}

# ── servers ──
s = Image.open(RAW + 'srv_raw1.png').convert('RGBA')
W, H = s.size
box = (0.4418 * W, 0, (0.4418 + 0.5581) * W, 0.67 * H)
srv = s.resize((round(box[2] - box[0]), round(box[3] - box[1])), Image.LANCZOS, box=box)
srv.save(OUT + 'servers.webp', 'WEBP', quality=90, method=6, alpha_quality=100)
rep['servers'] = {'size': srv.size, 'node': [119, 437, 976, 654], 'raw_box': [round(v, 2) for v in box]}

# ── bull ──
b = Image.open(RAW + 'bull_raw1.png').convert('RGBA')
W, H = b.size
k = max(1988 / W, 1110 / H)
ox, oy = 1196 + (1988 - W * k) / 2, 276 + (1110 - H * k) / 2
ex = np.asarray(Image.open(RAW + 'bull_export.png').convert('RGB')).astype(np.float64)[..., 0] / 255   # grey, frame (1196.., 276..)
A = 34 / 255
P = np.clip((ex - A) / (0.9 * (1 - A)), 0, 1)
# raw → export pixels
data = (1 / k, 0, (1196 - ox) / k, 0, 1 / k, (276 - oy) / k)
m = np.asarray(b.transform((ex.shape[1], ex.shape[0]), Image.AFFINE, data, resample=Image.BICUBIC)).astype(np.float64) / 255
a = m[..., 3]
# the cut-out is a semi-transparent texture (most alpha 0.8–0.99): fit the filter as a 17^3 trilinear 3D LUT on the
# straight colour f = P / a (alpha > 0.25, weighted by alpha) — a 1D curve on luma left p99 36 levels, this 7.7
N = 17
sel = a > 0.25
rgb, f, w = m[..., :3][sel], np.clip(P[sel] / a[sel], 0, 1.2), a[sel]
h = 1 / (N - 1)
g = rgb / h
i0 = np.clip(np.floor(g).astype(int), 0, N - 2)
t = g - i0
acc = np.zeros((N, N, N)); ww = np.zeros((N, N, N))
for dx in (0, 1):
    for dy in (0, 1):
        for dz in (0, 1):
            wt = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2]) * w
            ix = (i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz)
            np.add.at(ww, ix, wt); np.add.at(acc, ix, wt * f)
L = acc / np.maximum(ww, 1e-9)
F = ww > 0.05
for _ in range(40):
    if F.all():
        break
    sm = np.zeros_like(L); c = np.zeros(L.shape)
    for ax in range(3):
        for sh in (1, -1):
            FF = np.roll(F, sh, axis=ax); sm += np.roll(L, sh, axis=ax) * FF; c += FF
    new = (~F) & (c > 0); L[new] = sm[new] / c[new]; F |= new


def lut3(x):
    g = x / h
    i0 = np.clip(np.floor(g).astype(int), 0, N - 2)
    t = g - i0
    o = np.zeros(x.shape[:-1])
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wt = (t[..., 0] if dx else 1 - t[..., 0]) * (t[..., 1] if dy else 1 - t[..., 1]) * (t[..., 2] if dz else 1 - t[..., 2])
                o += wt * L[i0[..., 0] + dx, i0[..., 1] + dy, i0[..., 2] + dz]
    return o


d = np.abs(lut3(m[..., :3]) * a - P) * 0.9 * (1 - A) * 255
rep['bull_fit'] = {'mean': round(float(d.mean()), 2), 'p95': round(float(np.percentile(d, 95)), 2), 'p99': round(float(np.percentile(d, 99)), 2)}
# the layer: premultiplied filtered grey at 1.5x over the visible part (the card ends at x 2163.5, y 1091)
S2 = 1.5
X0, Y0, X1, Y1 = 1196, 276, 2163.5, 1091
ra = np.asarray(b).astype(np.float64) / 255
pm = np.clip(lut3(ra[..., :3]), 0, 1) * ra[..., 3]
pim = Image.fromarray((pm * 255).round().astype(np.uint8), 'L')
rbox = ((X0 - ox) / k, (Y0 - oy) / k, (X1 - ox) / k, (Y1 - oy) / k)
layer = pim.resize((round((X1 - X0) * S2), round((Y1 - Y0) * S2)), Image.LANCZOS, box=rbox).convert('RGB')
layer.save(OUT + 'bull.webp', 'WEBP', quality=88, method=6)
rep['bull'] = {'k': k, 'ox': ox, 'oy': oy, 'box': [X0, Y0, X1 - X0, Y1 - Y0], 'size': layer.size}
# check: the layer screened over #222 at .9 vs the export
L1 = np.asarray(layer.resize((round(X1 - X0), round(Y1 - Y0)), Image.LANCZOS).convert('L')).astype(np.float64) / 255
pred = A + 0.9 * L1 * (1 - A)
sub = ex[:pred.shape[0], :pred.shape[1]]
d = np.abs(pred - sub) * 255
rep['bull_check'] = {'mean': round(float(d.mean()), 2), 'p99': round(float(np.percentile(d, 99)), 2)}
json.dump(rep, open(OUT + 'prep_v2_report.json', 'w'), indent=1)
print(json.dumps(rep, indent=1))
