"""fla_verify.py — Animate's own stills of the FLA vs the HTML version, frame by frame, at stage size.
    python tools/fla_verify.py PAGE.html OUT_DIR STAGE_W step
OUT_DIR holds png_<frame>.png exported by Animate (tools/fla_finish.py); the HTML is shot at the same frames
(tools/shoot.js --outw STAGE_W). Prints per-frame mean |diff| and the share of pixels off by more than 48 (of 255),
and writes OUT_DIR/_sheet.png with the worst frames: Animate | HTML | diff ×4.
"""
import json, os, re, subprocess, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def main():
    page, out, sw = sys.argv[1], sys.argv[2], sys.argv[3]
    frames = sorted(int(m.group(1)) for m in (re.match(r'png_(\d+)\.png$', f) for f in os.listdir(out)) if m)
    hdir = os.path.join(out, 'html'); os.makedirs(hdir, exist_ok=True)
    jobs = [{'page': page, 't': f / 25, 'out': os.path.join(hdir, 'h_%d.png' % f)} for f in frames
            if not os.path.exists(os.path.join(hdir, 'h_%d.png' % f))]
    if jobs:
        json.dump(jobs, open(os.path.join(hdir, 'jobs.json'), 'w'))
        env = dict(os.environ, CHROME_PATH=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
        subprocess.run(['node', os.path.join(ROOT, 'tools', 'shoot.js'), '--outw', sw, '--jobs', os.path.join(hdir, 'jobs.json')],
                       cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
    rows = []
    for f in frames:
        a = Image.open(os.path.join(out, 'png_%d.png' % f)).convert('RGBA')
        bg = Image.new('RGBA', a.size, (255, 255, 255, 255)); bg.alpha_composite(a)
        A = np.asarray(bg.convert('RGB')).astype(int)
        Hm = Image.open(os.path.join(hdir, 'h_%d.png' % f)).convert('RGB')
        if Hm.size != a.size: Hm = Hm.resize(a.size, Image.LANCZOS)
        H = np.asarray(Hm).astype(int)
        d = np.abs(A - H).max(axis=2)
        rows.append((f, d.mean(), 100 * (d > 48).mean(), A, H, d))
    print('frame    t     mean   >48')
    for f, m, p, *_ in rows: print('%5d  %5.2f  %5.2f  %5.2f%%%s' % (f, f / 25, m, p, '   <<' if p > 1.0 else ''))
    worst = sorted(rows, key=lambda r: -r[2])[:6]
    h, w = worst[0][3].shape[:2]
    sheet = Image.new('RGB', (3 * w + 20, len(worst) * (h + 10)), (255, 0, 255))
    for i, (f, m, p, A, H, d) in enumerate(worst):
        sheet.paste(Image.fromarray(A.astype('uint8')), (0, i * (h + 10)))
        sheet.paste(Image.fromarray(H.astype('uint8')), (w + 10, i * (h + 10)))
        sheet.paste(Image.fromarray(np.clip(d * 4, 0, 255).astype('uint8')).convert('RGB'), (2 * w + 20, i * (h + 10)))
    sheet.save(os.path.join(out, '_sheet.png'))
    print('worst:', [(r[0], round(r[2], 2)) for r in worst], '→', os.path.join(out, '_sheet.png'))


if __name__ == '__main__':
    main()
