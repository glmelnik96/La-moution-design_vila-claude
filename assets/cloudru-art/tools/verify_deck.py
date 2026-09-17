# -*- coding: utf-8 -*-
"""Check the AE build against Figma, element by element.

  python tools/verify_deck.py gen     -> _build/cap_verify.jsx  (one master frame per rest time)
  node ae.js '@_build/cap_verify.jsx' -> C:/dev/gct-pres/vf/vf_NN.png
  python tools/verify_deck.py check   -> per-element ink-box deltas vs the Figma render

Each verify point (from tools/deck.py) is a measure rect, the mode that isolates the element
inside it (luminance threshold on black, colour key on artwork / for dark-on-light labels)
and the ink box Figma rendered there. The same rect + mode is applied to the AE frame, so
the comparison is symmetric: clipping, neighbours and thresholds affect both sides alike.
The bar is |dx|,|dy| <= 2 px and |dw|,|dh| <= 2 px.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import inkmeasure

ROOT = Path(__file__).resolve().parents[1]
FILM = sys.argv[2] if len(sys.argv) > 2 else "1"
VF = Path("C:/dev/gct-pres/vf" + FILM)
POINTS = ROOT / "_build" / ("deck_verify_%s.json" % FILM)


def load_points():
    d = json.load(open(POINTS, encoding="utf-8"))
    if isinstance(d, dict):
        return d["master"], d["points"]
    return "PRESENTATION NAT", d


def times(points):
    return sorted(set(p["t_master"] for p in points))


def gen():
    master, points = load_points()
    ts = times(points)
    VF.mkdir(parents=True, exist_ok=True)
    o = ["JSON.stringify((function () {",
         "var c = null;",
         "for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i);"
         ' if (it instanceof CompItem && it.name === %s) c = it; }' % json.dumps(master),
         'if (!c) return { ok: false, error: "no master" };',
         "var n = 0;"]
    for i, t in enumerate(ts):
        o.append('c.saveFrameToPng(%.3f, new File("%s/vf_%02d.png")); n++;' % (t, VF.as_posix(), i))
    o += ["return { ok: true, frames: n };", "})());"]
    (ROOT / "_build" / ("cap_verify_%s.jsx" % FILM)).write_text("\n".join(o), encoding="ascii")
    print("cap_verify.jsx: %d frames" % len(ts))


def bbox(img, p):
    x, y, w, h = [int(v) for v in p["rect"]]
    sub = img[y:y + h, x:x + w]
    if p["mode"] == "key":
        cols = p["key"] if isinstance(p["key"][0], list) else [p["key"]]
        m = np.zeros(sub.shape[:2], bool)
        for c in cols:
            m |= np.abs(sub - np.array([int(round(ch * 255)) for ch in c])).max(axis=2) < 40
    elif p["mode"] == "art":
        col = np.array([int(round(c * 255)) for c in p["rgb"]])
        grey = abs(col[0] - col[1]) < 8 and abs(col[1] - col[2]) < 8 and col[0] < 170
        tol = 28 if grey else p.get("keytol", 70)
        m = np.abs(sub - col).max(axis=2) < tol
    else:
        m = sub.max(axis=2) > p.get("thr", 100)
    if p.get("core"):                                  # this text's own glyph components only
        cx, cy, cw, ch = [int(v) for v in p["core"]]
        m = inkmeasure.own_mask(m, (cx - x, cy - y, cx - x + cw, cy - y + ch), p["size"])
    if not m.any():
        return None
    ys, xs = np.where(m)
    return [x + int(xs.min()), y + int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]


def line_ranges(img, p):
    """Per-line x-extents inside the rect (same band rule as deck.ref_lines) - catches wrong
    justification, which leaves the block's bbox intact."""
    x, y, w, h = [int(v) for v in p["rect"]]
    sub = img[y:y + h, x:x + w]
    if p["mode"] == "key":
        cols = p["key"] if isinstance(p["key"][0], list) else [p["key"]]
        m = np.zeros(sub.shape[:2], bool)
        for c in cols:
            m |= np.abs(sub - np.array([int(round(ch * 255)) for ch in c])).max(axis=2) < 40
    elif p["mode"] == "art":
        col = np.array([int(round(c * 255)) for c in p["rgb"]]); m = np.abs(sub - col).max(axis=2) < p.get("keytol", 70)
    else:
        m = sub.max(axis=2) > p.get("thr", 100)
    if p.get("core"):                                  # this text's own glyph components only
        cx, cy, cw, ch = [int(v) for v in p["core"]]
        m = inkmeasure.own_mask(m, (cx - x, cy - y, cx - x + cw, cy - y + ch), p["size"])
    bands = inkmeasure.bands_of(m, max(3, int(0.35 * p["size"])))
    out = []
    for t, b in bands:
        if b - t + 1 < 0.35 * p.get("size", 24):
            continue
        cols = np.where(m[t:b + 1].any(axis=0))[0]
        out.append((x + int(cols.min()), x + int(cols.max())))
    return out


def check():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    master, points = load_points()
    ts = times(points)
    frames = {}
    for i, t in enumerate(ts):
        f = VF / ("vf_%02d.png" % i)
        if not f.exists():
            print("missing", f); continue
        frames[t] = np.asarray(Image.open(f).convert("RGB")).astype(int)
    bad, n = [], 0
    cur = None
    for p in points:
        img = frames.get(p["t_master"])
        if img is None:
            continue
        got = bbox(img, p)
        ex = p["expect"]
        if got is None:
            d = None
        else:
            d = [got[i] - ex[i] for i in range(4)]
        n += 1
        tag = "%s/%s" % (p["sid"], p["name"])
        if d is None or max(abs(v) for v in d) > 2:
            bad.append((tag, ex, got, d))
        elif p.get("size"):                       # text: every line must sit where Figma set it
            ref = np.asarray(Image.open(ROOT / "assets" / ("%s_full.png" % p["sid"])).convert("RGB")).astype(int)
            la, lb = line_ranges(img, p), line_ranges(ref, p)
            if len(la) != len(lb) or any(abs(a[0] - b[0]) > 2 or abs(a[1] - b[1]) > 2 for a, b in zip(la, lb)):
                d = "lines AE %s vs Figma %s" % (la, lb)
                bad.append((tag, ex, got, d))
        if p["sid"] != cur:
            cur = p["sid"]; print("\n%s:" % cur, end=" ")
        ok = isinstance(d, list) and max(abs(v) for v in d) <= 2
        print("%s%s" % (p["name"], "" if ok else "!%s" % (d,)), end=" ")
    print("\n\n%d points, %d off by more than 2 px" % (n, len(bad)))
    for tag, ex, got, d in bad:
        print("  %-14s expect %s  got %s  delta %s" % (tag, ex, got, d))


if __name__ == "__main__":
    {"gen": gen, "check": check}[sys.argv[1]]()
