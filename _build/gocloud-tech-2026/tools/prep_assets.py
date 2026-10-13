"""prep_assets.py — photo layers for the deck, cut out of the Figma exports.

Figma's node export (download_assets, scale 1) renders the image node *in context*: the slide
background under it is baked in, the filters (contrast, saturation, exposure…) are applied. The
raw source image carries the real alpha. So: alpha = raw alpha mapped into slide coordinates with
the node's fill transform; colour = the export, un-mixed from the background at the soft edge
(F = (E - (1 - a) * B) / a, B = the export just outside the silhouette, propagated inwards).

    python tools/prep_assets.py            (from the project root: _build/gocloud-tech-2026)
"""
import json
import numpy as np
from PIL import Image

RAW = 'assets/raw/'
OUT = 'img/'


def mapped_alpha(raw_path, ox, oy, k, size=(2304, 1280), dx=0.0, dy=0.0):
    """raw image pixel (i, j) lands at slide (ox + i*k, oy + j*k); return its alpha on the slide grid."""
    a = Image.open(raw_path).convert('RGBA').getchannel('A')
    # output (X, Y) -> input ((X - ox) / k, (Y - oy) / k)
    data = (1 / k, 0, (-ox + dx) / k, 0, 1 / k, (-oy + dy) / k)
    m = a.transform(size, Image.AFFINE, data, resample=Image.BICUBIC)
    return np.asarray(m).astype(np.float32) / 255.0


def propagate(rgb, known, iters=24):
    """fill unknown pixels with the mean of known 4-neighbours, ring by ring (nearest-known estimate)."""
    val = rgb.copy()
    k = known.copy()
    for _ in range(iters):
        acc = np.zeros_like(val)
        cnt = np.zeros(k.shape, np.float32)
        for sy, sx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            kk = np.roll(k, (sy, sx), axis=(0, 1))
            vv = np.roll(val, (sy, sx), axis=(0, 1))
            acc += vv * kk[..., None]
            cnt += kk
        new = (~k) & (cnt > 0)
        val[new] = acc[new] / cnt[new][:, None]
        k = k | new
        if k.all():
            break
    return val


def unmix(export_path, alpha, crop=None):
    e = np.asarray(Image.open(export_path).convert('RGB')).astype(np.float32)
    if crop:
        x0, y0 = crop
        e = e  # export already covers the slide window starting at (x0, y0)
    a = alpha
    bg = propagate(e, a < 0.004)
    aa = np.clip(a, 1e-3, 1)[..., None]
    f = (e - (1 - aa) * bg) / aa
    f = np.where((a > 0.05)[..., None], f, e)
    f = np.clip(f, 0, 255)
    rgba = np.dstack([f, a * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA'), e, bg


def save(im, name, q=92):
    im.save(OUT + name + '.webp', 'WEBP', quality=q, method=6, alpha_quality=100)
    im.save(OUT + name + '.png', optimize=True)
    print(name, im.size)


def bbox(alpha, thr=0.004):
    ys, xs = np.nonzero(alpha > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


report = {}

# ── slide 3 · taxi: node (-653,-241) 3680x2054, FILL; image 2752x1536 → k = 2054/1536 ──
k3 = max(3680 / 2752, 2054 / 1536)
a3 = mapped_alpha(RAW + 's3_raw2.png', -653 + (3680 - 2752 * k3) / 2, -241 + (2054 - 1536 * k3) / 2, k3)
car, e3, bg3 = unmix(RAW + 's3_export.png', a3)
save(car, 'taxi_car')
report['taxi'] = {'k': k3, 'bbox': bbox(a3)}

# sign checker: lit squares are in the export; the 'off' plate = the sign body with the squares painted over
e3u8 = np.asarray(Image.open(RAW + 's3_export.png').convert('RGB')).astype(np.int16)
lum = e3u8.mean(axis=2)
sx0, sy0, sx1, sy1 = 820, 405, 1150, 515
reg = lum[sy0:sy1, sx0:sx1]
lit = reg > 60
ys, xs = np.nonzero(lit)
# squares: connected blobs on a 40 px grid; find column/row edges from projections
colp = lit.sum(axis=0)
rowp = lit.sum(axis=1)
report['sign_cols'] = [int(i + sx0) for i in np.nonzero(np.diff((colp > 3).astype(int)))[0]]
report['sign_rows'] = [int(i + sy0) for i in np.nonzero(np.diff((rowp > 3).astype(int)))[0]]
report['sign_lit_rgb'] = e3u8[sy0:sy1, sx0:sx1][lit].mean(axis=0).round(1).tolist()

# ── slide 5 · cube: node (67.81,-241) 2161.37x1858, FILL; image 2294x2253 ──
k5 = max(2161.37 / 2294, 1858 / 2253)
ox5 = 67.81 + (2161.37 - 2294 * k5) / 2
oy5 = -241 + (1858 - 2253 * k5) / 2
a5full = mapped_alpha(RAW + 's5_raw1.png', ox5, oy5, k5)
# the export covers x 67.81..2229.18 → pixels 68..2229 of the slide (2162 px wide)
e5 = np.asarray(Image.open(RAW + 's5_export.png').convert('RGB')).astype(np.float32)
E5 = np.full((1280, 2304, 3), 34, np.float32)
E5[:, 68:68 + e5.shape[1]] = e5[:, :2304 - 68]
Image.fromarray(E5.astype(np.uint8)).save('/tmp/_s5_export_slide.png')
cube, _, _ = unmix('/tmp/_s5_export_slide.png', a5full)
save(cube, 'cube')
report['cube'] = {'k': k5, 'ox': ox5, 'oy': oy5, 'bbox': bbox(a5full)}

# ── slide 6 · dashboard: node (-664,-112) 4034x2252, CROP itf [[0.9998,0,0.0001],[0,1,-0.0153]] ──
# node (u,v) shows image (0.9998u + 0.0001, v - 0.0153): image (s,t) ← node u = (s - 0.0001)/0.9998, v = t + 0.0153
W6, H6 = 2752, 1536
kx = 4034 / (0.9998 * W6)
ky = 2252 / H6
ox6 = -664 + (-0.0001 / 0.9998) * 4034
oy6 = -112 + 0.0153 * 2252
best = None
for name in ('s6_raw2.png', 's6_raw6.png'):
    src = Image.open(RAW + name).convert('RGBA')
    data = (1 / kx, 0, -ox6 / kx, 0, 1 / ky, -oy6 / ky)
    m = src.transform((2304, 1280), Image.AFFINE, data, resample=Image.BICUBIC)
    arr = np.asarray(m).astype(np.float32)
    al = arr[..., 3] / 255
    e6 = np.asarray(Image.open(RAW + 's6_export.png').convert('RGB')).astype(np.float32)
    gray = arr[..., :3].mean(axis=2)
    sel = al > 0.99
    c = np.corrcoef(gray[sel], e6[..., 0][sel])[0, 1]
    report['dash_' + name] = round(float(c), 4)
    if best is None or c > best[0]:
        best = (c, name, al)
a6 = best[2]
dash, _, _ = unmix(RAW + 's6_export.png', a6)
save(dash, 'dash')
report['dash'] = {'raw': best[1], 'kx': kx, 'ky': ky, 'ox': ox6, 'oy': oy6, 'bbox': bbox(a6)}

json.dump(report, open(OUT + 'prep_report.json', 'w'), indent=1)
print(json.dumps(report, indent=1))
