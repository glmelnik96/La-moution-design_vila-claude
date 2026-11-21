"""sheet.py — contact sheet of film.js stills (t000000.png …) with time labels.
    python tools/sheet.py out/v1_every out/v1_sheet.png [cols=10] [thumb_w=180]
"""
import sys, os, re
from PIL import Image, ImageDraw
src, dst = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 10
tw = int(sys.argv[4]) if len(sys.argv) > 4 else 180
files = sorted(f for f in os.listdir(src) if re.match(r"t\d{6}\.png$", f))
if not files:
    sys.exit("no stills in " + src)
first = Image.open(os.path.join(src, files[0]))
th = round(first.height * tw / first.width)
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (tw + 4) + 4, rows * (th + 18) + 4), (24, 24, 24))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(src, f)).convert("RGB").resize((tw, th), Image.LANCZOS)
    x, y = 4 + (i % cols) * (tw + 4), 4 + (i // cols) * (th + 18)
    sheet.paste(im, (x, y + 14))
    d.text((x + 2, y + 1), "%.2fs" % (int(f[1:7]) / 1000), fill=(200, 200, 200))
sheet.save(dst)
print(dst, sheet.size, len(files), "frames")
