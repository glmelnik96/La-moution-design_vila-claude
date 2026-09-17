# -*- coding: utf-8 -*-
"""Encode a film's captured frames (C:/dev/gct-pres/pv<film>/pv_NNNN.png) into out/film<film>.mp4 and
build contact strips for review: python tools/preview.py <film> [step]"""
import glob
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
film = sys.argv[1]
step = int(sys.argv[2]) if len(sys.argv) > 2 else 12
src = Path("C:/dev/gct-pres/pv%s" % film)
files = sorted(glob.glob(str(src / "pv_*.png")))
out = ROOT / "out" / ("film%s.mp4" % film)
out.parent.mkdir(exist_ok=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "25", "-i", str(src / "pv_%04d.png"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", str(out)], check=True)
sel = files[::step]
cols, tw = 8, 236
th = int(tw * 1080 / 1920)
rows = (len(sel) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * th), (30, 30, 30))
for i, f in enumerate(sel):
    sheet.paste(Image.open(f).convert("RGB").resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
parts = max(1, (rows + 6) // 7)
per = (rows + parts - 1) // parts
for k in range(parts):
    sheet.crop((0, k * per * th, cols * tw, min(rows, (k + 1) * per) * th)).save("C:/dev/gct-pres/pv/_strip%s_%d.png" % (film, k))
print("film %s: %d frames -> %s (%.1f MB), %d thumbs in %d strips" % (film, len(files), out.name, out.stat().st_size / 1e6, len(sel), parts))
