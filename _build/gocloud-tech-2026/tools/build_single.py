"""build_single.py — one self-contained HTML: CSS, fonts, images, motion.js and deck.js inlined.

    python tools/build_single.py [out.html]      (run from _build/gocloud-tech-2026)
"""
import base64, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', '..', 'out', 'gocloud-tech-2026', 'GoCloudTech2026_v2.html')


def rd(p, mode='r'):
    with open(os.path.join(ROOT, p), mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as f:
        return f.read()


def b64(p):
    return base64.b64encode(rd(p, 'rb')).decode('ascii')


css = rd('deck.css')
css = re.sub(r'url\((fonts/[^)]+\.woff2)\)', lambda m: 'url(data:font/woff2;base64,' + b64(m.group(1)) + ')', css)
# the images are the defaults of deck.js's IMG table, so the two cannot drift apart
deck = rd('deck.js')
imgs = dict(re.findall(r"(\w+): '(img/[\w.-]+)'", re.search(r'const IMG = window\.DECK_IMG \|\| \{(.*?)\};', deck, re.S).group(1)))
assert imgs, 'no images found in deck.js'
img_js = 'window.DECK_IMG = {\n' + ',\n'.join("  %s: 'data:image/webp;base64,%s'" % (k, b64(v)) for k, v in imgs.items()) + '\n};'

html = rd('index.html')
html = html.replace('<link rel="stylesheet" href="deck.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script src="lib/motion.js"></script>', '<script>\n' + rd('lib/motion.js') + '\n</script>')
html = html.replace('<script src="deck.js"></script>', '<script>\n' + img_js + '\n</script>\n<script>\n' + deck + '\n</script>')
assert 'href="deck.css"' not in html and 'src="deck.js"' not in html and 'src="lib/motion.js"' not in html
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print(out, round(os.path.getsize(out) / 1024 / 1024, 2), 'MB', '· images:', ', '.join(imgs))
