"""prep_assets.py — image layers for deck 2 (GoCloud Tech 2026, part B), from the Figma exports.

  cube   One raw 3D render (2294 x 2253, real alpha) is placed three times in the file (S2-S4, S5-S6, S8)
         with the same image filters (exposure .35, contrast .367, temperature -.22). Figma's filter is not
         per channel (a pure green turns mint), so it is fitted as a 33^3 trilinear 3D LUT on pairs
         raw -> Figma pixel: the in-context export at placement P1 plus every cube pixel the cards leave
         visible in the reference renders at P2 / P3. One filtered master with the raw alpha → the cube can
         glide between placements.
  photo  S7 host photo: raw cut-out (2731 x 4096, alpha), CROP transform → frame coords, shipped at 2x.
  qr     QR codes as module matrices (exact: modules are 35 / 40 raw px) → vector in the page.

    python tools/prep_assets.py            (from _build/gocloud-tech-2026-b)
"""
import json
import numpy as np
from PIL import Image

RAW = 'assets/raw/'
OUT = 'img/'
N = 33


def place_fill(nx, ny, nw, nh, iw, ih):
    k = max(nw / iw, nh / ih)
    return nx + (nw - iw * k) / 2, ny + (nh - ih * k) / 2, k, k


def place_crop(nx, ny, nw, nh, a, tx, d, ty, iw, ih):
    """CROP imageTransform [[a,0,tx],[0,d,ty]]: node (u,v) in 0..1 shows image (a u + tx, d v + ty)."""
    return nx + (-tx / a) * nw, ny + (-ty / d) * nh, nw / (a * iw), nh / (d * ih)


def to_frame(im, ox, oy, kx, ky, size=(2304, 1280)):
    data = (1 / kx, 0, -ox / kx, 0, 1 / ky, -oy / ky)
    return np.asarray(im.transform(size, Image.AFFINE, data, resample=Image.BICUBIC)).astype(np.float32)


def lut_fit(r, e):
    h = 255 / (N - 1)
    f = r / h
    i0 = np.clip(np.floor(f).astype(int), 0, N - 2)
    t = f - i0
    acc = np.zeros((N, N, N, 3))
    w = np.zeros((N, N, N))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wt = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                ix = (i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz)
                np.add.at(w, ix, wt)
                for c in range(3):
                    np.add.at(acc[..., c], ix, wt * e[:, c])
    L = acc / np.maximum(w, 1e-9)[..., None]
    F = w > 0.5
    for _ in range(64):                      # empty nodes ← mean of filled neighbours, ring by ring
        if F.all():
            break
        a = np.zeros_like(L)
        cnt = np.zeros(F.shape)
        for ax in range(3):
            for s in (1, -1):
                FF = np.roll(F, s, axis=ax)
                a += np.roll(L, s, axis=ax) * FF[..., None]
                cnt += FF
        new = (~F) & (cnt > 0)
        L[new] = a[new] / cnt[new][:, None]
        F |= new
    return L


def lut_apply(L, x):
    h = 255 / (N - 1)
    f = x / h
    i0 = np.clip(np.floor(f).astype(int), 0, N - 2)
    t = f - i0
    out = np.zeros(x.shape[:-1] + (3,))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wt = (t[..., 0] if dx else 1 - t[..., 0]) * (t[..., 1] if dy else 1 - t[..., 1]) * (t[..., 2] if dz else 1 - t[..., 2])
                out += wt[..., None] * L[i0[..., 0] + dx, i0[..., 1] + dy, i0[..., 2] + dz]
    return out


def opaque_core(a, g):
    o = a > 0.999
    m = o.copy()
    for s in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
        m &= np.roll(o, s, axis=(0, 1))
    return m & (g < 6)


def grad(rgb):
    l = rgb.mean(axis=2)
    return np.abs(np.diff(l, axis=1, prepend=0)) + np.abs(np.diff(l, axis=0, prepend=0))


def save(im, name, q=92):
    im.save(OUT + name + '.webp', 'WEBP', quality=q, method=6, alpha_quality=100)
    print(name, im.size)


report = {}
LOGO = (102, 103, 438.675, 359.938)
CARDS = {   # everything that covers the cube in each reference render (frame px)
    's02': [(586, 103, 1613, 500), (105, 623, 550, 488), (675, 623, 1525, 488), LOGO],
    's03': [(586, 103, 1613, 500), (105, 623, 550, 488), (675, 623, 1525, 488), LOGO],
    's04': [(586, 103, 1613, 500), (105, 623, 550, 488), (675, 623, 752.5, 488), (1447.5, 623, 752.5, 488), LOGO],
    's05': [(560, 103, 1625, 360), (120, 483, 1020, 477), (1164, 483, 1020, 477), (120, 980, 1020, 111), LOGO],
    's06': [(560, 100, 1639, 1011), LOGO],
    's08': [(560, 103, 1640, 357), (105, 480, 1037.5, 197), (105, 697, 1037.5, 197), (105, 914, 1037.5, 197),
            (1162.5, 480, 617, 631), (1799.5, 480, 400.5, 631), LOGO],
}

# ── cube ──
raw = Image.open(RAW + 'cube_raw1.png').convert('RGBA')
IW, IH = raw.size
P = {
    'P1': place_fill(807, -113, 2453, 2409, IW, IH),
    'P2': place_crop(-151, -632, 2607, 2561, 1.361, -0.1803, 1.3608, -0.1803, IW, IH),
    'P3': place_crop(360, -289, 2675, 2540, 1.0344, -0.0172, 1, 0, IW, IH),
}
SLIDE_P = {'s02': 'P1', 's03': 'P1', 's04': 'P1', 's05': 'P2', 's06': 'P2', 's08': 'P3'}
rs, es = [], []
m1 = to_frame(raw, *P['P1'])
ex = np.asarray(Image.open(RAW + 'cube_export_s2.png').convert('RGB')).astype(np.float32)
R1, A1 = m1[:, 807:807 + ex.shape[1], :3], m1[:, 807:807 + ex.shape[1], 3] / 255
sel = opaque_core(A1, grad(R1))
rs.append(R1[sel]); es.append(ex[sel])
vis = {}
for s, p in SLIDE_P.items():
    m = to_frame(raw, *P[p])
    v = np.ones((1280, 2304), bool)
    for (x, y, w, h) in CARDS[s]:
        v[max(0, int(y) - 4):int(y + h) + 5, max(0, int(x) - 4):int(x + w) + 5] = False
    vis[s] = v
    if s in ('s05', 's06', 's08'):
        ref = np.asarray(Image.open('ref/%s.png' % s).convert('RGB')).astype(np.float32)
        sl = opaque_core(m[..., 3] / 255, grad(m[..., :3])) & v
        rs.append(m[..., :3][sl]); es.append(ref[sl])
L = lut_fit(np.concatenate(rs), np.concatenate(es))
ra = np.asarray(raw).astype(np.float32)
col = np.clip(lut_apply(L, ra[..., :3]), 0, 255)
master = np.dstack([col, ra[..., 3]]).round().astype(np.uint8)
# ship only the rows any placement shows (+ margin for the entrance scale)
rows = []
for p in P.values():
    ox, oy, kx, ky = p
    rows += [(-oy) / ky, (1280 - oy) / ky]
y0 = max(0, int(np.floor(min(rows))) - 24)
y1 = min(IH, int(np.ceil(max(rows))) + 24)
cube = Image.fromarray(master[y0:y1], 'RGBA')
save(cube, 'cube', q=90)
report['cube'] = {'crop_y0': y0, 'crop_y1': y1, 'size': cube.size,
                  'place': {k: [round(v, 4) for v in p] for k, p in P.items()}}
# check against the renders (opaque, visible cube pixels)
for s, p in SLIDE_P.items():
    ox, oy, kx, ky = P[p]
    m = to_frame(cube, ox, oy + y0 * ky, kx, ky)
    ref = np.asarray(Image.open('ref/%s.png' % s).convert('RGB')).astype(np.float32)
    sl = vis[s] & (m[..., 3] > 254)
    d = np.abs(m[..., :3] - ref)[sl]
    report['check_' + s] = {'px': int(sl.sum()), 'mean': d.mean(axis=0).round(2).tolist(), 'p99': np.percentile(d, 99, axis=0).round(1).tolist()}

# ── S7 host photo: node (84,467) 509x509 CROP [[0.9195,0,0.025],[0,0.6131,0.0406]] in the media tile ──
ph = Image.open(RAW + 'photo_raw1.png').convert('RGBA')
ox, oy, kx, ky = place_crop(84, 467, 509, 509, 0.9195, 0.025, 0.6131, 0.0406, *ph.size)
S2X = 2                                   # shipped at 2x frame resolution
TX, TY, TW, TH = 84, 467, 509, 509        # the node box (the media tile clips it further)
box = ((TX - ox) / kx, (TY - oy) / ky, (TX + TW - ox) / kx, (TY + TH - oy) / ky)   # raw px of the node box
photo = ph.resize((TW * S2X, TH * S2X), Image.LANCZOS, box=box)
save(photo, 'photo')
report['photo'] = {'ox': ox, 'oy': oy, 'kx': kx, 'ky': ky, 'box': [TX, TY, TW, TH], 'scale': S2X}

# ── QR codes → module matrices ──
def qr_matrix(path):
    a = np.asarray(Image.open(path).convert('L')).astype(np.float32)
    dark = a < 128
    ys, xs = np.nonzero(dark)
    x0, y0_, x1, y1_ = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    # module size from the top-left finder pattern: a 7-module run
    row = dark[y0_ + 2, x0:x1]
    run = int(np.argmin(row)) if not row.all() else len(row)
    mod = run / 7
    n = int(round((x1 - x0) / mod))
    rows = []
    for j in range(n):
        y = int(y0_ + (j + 0.5) * mod)
        rows.append(''.join('1' if dark[y, int(x0 + (i + 0.5) * mod)] else '0' for i in range(n)))
    # exactness: re-render and compare
    re = np.zeros_like(dark)
    for j, rr in enumerate(rows):
        for i, ch in enumerate(rr):
            if ch == '1':
                re[int(round(y0_ + j * mod)):int(round(y0_ + (j + 1) * mod)), int(round(x0 + i * mod)):int(round(x0 + (i + 1) * mod))] = True
    mism = float((re != dark).mean())
    return {'n': n, 'mod': mod, 'quiet': int(x0), 'size': a.shape[1], 'rows': rows, 'mismatch': mism}


QR = {'future': 'qr6_raw1.png', 'career': 'qr6_raw3.png', 'learn': 'qr6_raw6.png', 'tg': 'qr6_raw8.png', 'app': 'qr5_raw1.png'}
qr = {}
for k, f in QR.items():
    q = qr_matrix(RAW + f)
    qr[k] = q
    report['qr_' + k] = {'n': q['n'], 'mod': q['mod'], 'quiet': q['quiet'], 'size': q['size'], 'mismatch': q['mismatch']}
json.dump({k: {'n': v['n'], 'quiet': v['quiet'] / v['mod'], 'size': v['size'] / v['mod'], 'rows': v['rows']} for k, v in qr.items()},
          open(OUT + 'qr.json', 'w'))
json.dump(report, open(OUT + 'prep_report.json', 'w'), indent=1)
print(json.dumps(report, indent=1))

# ── page data: lib/qr.js (module matrices) and lib/logo.js (the logo's paths, grouped for its build) ──
EYE = {'future': 1.05, 'career': 1.05, 'learn': 1.05, 'tg': 37 / 35, 'app': 37 / 35}   # finder ring, modules (measured)
qd = {k: {'n': v['n'], 'quiet': v['quiet'] / v['mod'], 'size': v['size'] / v['mod'], 'rows': v['rows'], 'eye': round(EYE[k], 4)}
      for k, v in qr.items()}
with open('lib/qr.js', 'w') as f:
    f.write('// generated by tools/prep_assets.py — QR codes as module matrices (exact: re-rendered = the Figma images)\n'
            '// n modules + quiet zone; eye = inner edge of the finder ring in modules (the codes use a 1.05-module ring)\n'
            'window.DECK_QR = ' + json.dumps(qd, separators=(',', ':')) + ';\n')
import re
svg = open('assets/logo.svg').read()
paths = []
for p in re.findall(r'<path([^>]*)/>', svg):
    paths.append({'d': re.search(r' d="([^"]+)"', p).group(1), 'fill': re.search(r'fill="([^"]+)"', p).group(1),
                  'rule': 'evenodd' if 'fill-rule="evenodd"' in p else 'nonzero'})
# groups by path index (boxes measured with getBBox): plate · G O · C L O U D · the cloud.ru mark and word · t e c h
groups = {'plate': [0], 'G': [2], 'O': [1], 'C': [4], 'L': [6], 'O2': [5], 'U': [3], 'D': [7],
          'mark': [8, 9, 18], 'word': [15, 16, 10, 11, 12, 13, 17, 14], 't': [19], 'e': [20], 'c': [21], 'h': [22]}
with open('lib/logo.js', 'w') as f:
    f.write('// generated by tools/prep_assets.py — the event logo (Figma "Logo FINAL", 438.675 x 359.938), paths grouped for its build\n'
            'window.DECK_LOGO = ' + json.dumps({'paths': paths, 'groups': groups}, separators=(',', ':')) + ';\n')
print('lib/qr.js, lib/logo.js written')
