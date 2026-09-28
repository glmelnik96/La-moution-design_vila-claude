"""verify.py — pixel check of HTML stills against the Figma frame renders.

    python tools/verify.py out/verify/A pairs.json [--sheet out/verify/A_sheet.png]
    pairs.json: [{"name": "F8", "figma": "figma/frames/s1_f08.png", "html": "out/verify/A/F8.png"}, ...]

Column 0 is ignored: the Figma frames' body starts at x = 0.53 (or 1), so their first column shows the
section background — an artefact, not design. Reports per frame: mean |diff|, share of pixels off by
more than 24/255, the bounding boxes of the worst clusters; writes Figma | HTML | diff strips.
"""
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw

def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.int16)

def clusters(mask, min_px=6):
    """Coarse connected regions of a boolean mask via 8px tiles (enough to point at a wrong element)."""
    H, W = mask.shape
    T = 8
    th, tw = (H + T - 1) // T, (W + T - 1) // T
    tiles = np.zeros((th, tw), bool)
    for ty in range(th):
        row = mask[ty * T:(ty + 1) * T]
        for tx in range(tw):
            if row[:, tx * T:(tx + 1) * T].sum() >= min_px:
                tiles[ty, tx] = True
    seen = np.zeros_like(tiles)
    out = []
    for ty in range(th):
        for tx in range(tw):
            if tiles[ty, tx] and not seen[ty, tx]:
                stack = [(ty, tx)]; seen[ty, tx] = True; cells = []
                while stack:
                    y, x = stack.pop(); cells.append((y, x))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = y + dy, x + dx
                            if 0 <= yy < th and 0 <= xx < tw and tiles[yy, xx] and not seen[yy, xx]:
                                seen[yy, xx] = True; stack.append((yy, xx))
                ys = [c[0] for c in cells]; xs = [c[1] for c in cells]
                y0, y1, x0, x1 = min(ys) * T, (max(ys) + 1) * T, min(xs) * T, (max(xs) + 1) * T
                out.append((int(mask[y0:y1, x0:x1].sum()), x0, y0, x1, y1))
    out.sort(reverse=True)
    return out

def main():
    outdir, pairs_path = sys.argv[1], sys.argv[2]
    sheet_path = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else os.path.join(outdir, "_verify_sheet.png")
    pairs = json.load(open(pairs_path, encoding="utf-8"))
    strips = []
    print("%-6s %8s %8s %8s  worst clusters (px, x0,y0-x1,y1)" % ("frame", "mean", ">24", ">64"))
    for p in pairs:
        a, b = load(p["figma"]), load(p["html"])
        H, W = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
        a, b = a[:H, :W], b[:H, :W]
        d = np.abs(a - b).max(axis=2)
        d[:, 0] = 0
        m24, m64 = d > 24, d > 64
        cl = clusters(m24)[:4]
        print("%-6s %8.3f %7.3f%% %7.3f%%  %s" % (p["name"], d.mean(), 100 * m24.mean(), 100 * m64.mean(),
              "  ".join("%d@%d,%d-%d,%d" % c for c in cl)))
        # strip: figma | html | diff (x4, red)
        dv = np.clip(d * 4, 0, 255).astype(np.uint8)
        heat = np.stack([dv, np.zeros_like(dv), np.zeros_like(dv)], axis=2)
        strip = np.concatenate([a.astype(np.uint8), b.astype(np.uint8), heat], axis=1)
        im = Image.fromarray(strip)
        dr = ImageDraw.Draw(im)
        dr.rectangle([0, 0, 130, 22], fill=(0, 0, 0)); dr.text((6, 5), p["name"] + "  figma|html|diff", fill=(255, 255, 255))
        im.save(os.path.join(outdir, "cmp_" + p["name"] + ".png"))
        strips.append(im.resize((im.width // 3, im.height // 3), Image.LANCZOS))
    if strips:
        cols = 2
        w, h = strips[0].size
        rows = (len(strips) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (w + 8), rows * (h + 8)), (30, 30, 30))
        for i, s in enumerate(strips):
            sheet.paste(s, ((i % cols) * (w + 8), (i // cols) * (h + 8)))
        sheet.save(sheet_path)
        print("sheet:", sheet_path)

if __name__ == "__main__":
    main()
