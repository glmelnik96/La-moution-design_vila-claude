"""build_single.py — the three self-contained presentations: CSS, font, images, motion.js, logo/QR data and the
deck inlined; each file carries its own slide order (window.DECK_ORDER) and only the images it uses.

    python tools/build_single.py [outdir]      (run from _build/gocloud-tech-2026-b)
"""
import base64, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', '..', 'out', 'gocloud-tech-2026-b')
FILES = [
    ('GoCloudTech2026_Info_1-3.html', ['s1', 's2', 's3'], 'слайды 1–3'),
    ('GoCloudTech2026_Info_4-8.html', ['s4', 's5', 's6', 's7', 's8'], 'слайды 4–8'),
    ('GoCloudTech2026_Info_1-8.html', ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'], 'слайды 1–8'),
]
CUBE = {'s2', 's3', 's4', 's5', 's6', 's8'}


def rd(p, mode='r'):
    with open(os.path.join(ROOT, p), mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as f:
        return f.read()


def b64(p):
    return base64.b64encode(rd(p, 'rb')).decode('ascii')


css = rd('deck.css')
css = re.sub(r'url\((fonts/[^)]+\.woff2)\)', lambda m: 'url(data:font/woff2;base64,' + b64(m.group(1)) + ')', css)
os.makedirs(OUT, exist_ok=True)
for name, order, label in FILES:
    imgs = {}
    if CUBE & set(order):
        imgs['cube'] = 'img/cube.webp'
    if 's7' in order:
        imgs['photo'] = 'img/photo.webp'
    head = 'window.DECK_ORDER = %s;\nwindow.DECK_IMG = {\n%s\n};' % (
        '[' + ', '.join("'%s'" % k for k in order) + ']',
        ',\n'.join("  %s: 'data:image/webp;base64,%s'" % (k, b64(v)) for k, v in imgs.items()))
    html = rd('index.html')
    html = html.replace('<title>GoCloud Tech 2026</title>', '<title>GoCloud Tech 2026 · %s</title>' % label)
    html = html.replace('<b>1–8</b> — слайд', '<b>1–%d</b> — слайд' % len(order))
    html = html.replace('<link rel="stylesheet" href="deck.css">', '<style>\n' + css + '\n</style>')
    for lib in ('motion', 'logo', 'qr'):
        html = html.replace('<script src="lib/%s.js"></script>' % lib, '<script>\n' + rd('lib/%s.js' % lib) + '\n</script>')
    html = html.replace('<script src="deck.js"></script>', '<script>\n' + head + '\n</script>\n<script>\n' + rd('deck.js') + '\n</script>')
    assert 'href="deck.css"' not in html and 'src="deck.js"' not in html and 'src="lib/' not in html
    p = os.path.join(OUT, name)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(html)
    print(p, round(os.path.getsize(p) / 1024 / 1024, 2), 'MB', order)
