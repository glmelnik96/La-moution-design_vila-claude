"""compare.py — rest frames (HTML) vs Figma renders: numbers per slide + Figma | HTML | diff strips.

    python tools/compare.py <html_dir> <ref_dir> <out_dir> [slides...]
"""
import sys, os
import numpy as np
from PIL import Image

hdir, rdir, odir = sys.argv[1:4]
only = sys.argv[4:]
os.makedirs(odir, exist_ok=True)
for i in range(1, 8):
    n = 's%02d' % i
    if only and str(i) not in only:
        continue
    hp, rp = os.path.join(hdir, n + '.png'), os.path.join(rdir, n + '.png')
    if not (os.path.exists(hp) and os.path.exists(rp)):
        continue
    a = np.asarray(Image.open(rp).convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(hp).convert('RGB')).astype(np.int16)
    d = np.abs(a - b).max(axis=2)
    print('%s mean %.2f  >24 %.3f%%  >64 %.3f%%' % (n, d.mean(), 100 * (d > 24).mean(), 100 * (d > 64).mean()))
    # worst 64x64 blocks
    H, W = d.shape
    bs = 64
    blocks = d[:H // bs * bs, :W // bs * bs].reshape(H // bs, bs, W // bs, bs).mean(axis=(1, 3))
    idx = np.argsort(blocks.ravel())[::-1][:5]
    print('   worst blocks (x,y,mean):', [(int(k % blocks.shape[1]) * bs, int(k // blocks.shape[1]) * bs, round(float(blocks.ravel()[k]), 1)) for k in idx])
    dv = np.clip(d * 3, 0, 255).astype(np.uint8)
    strip = Image.new('RGB', (W // 2 * 3 + 20, H // 2), 'white')
    strip.paste(Image.fromarray(a.astype(np.uint8)).resize((W // 2, H // 2)), (0, 0))
    strip.paste(Image.fromarray(b.astype(np.uint8)).resize((W // 2, H // 2)), (W // 2 + 10, 0))
    strip.paste(Image.fromarray(dv).convert('RGB').resize((W // 2, H // 2)), (W + 20, 0))
    strip.save(os.path.join(odir, n + '_cmp.png'))
