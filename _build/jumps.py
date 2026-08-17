# -*- coding: utf-8 -*-
"""How far does each word actually travel, and how soon after it appears?

"Less jerky" is not actionable until it is a number. The complaint is a word
that lands and then bolts across the frame, so the two axes that matter are
distance (in screen widths) and latency (frames between arrival and the jump).
A 900 px move twenty seconds in is the cloud breathing; the same move four
frames after the word fades up is the defect.
"""
import io
import math
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0], "--v4"]
G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
buf, sys.stdout = sys.stdout, io.StringIO()
exec(compile(open(G["__file__"], encoding="utf-8").read(), G["__file__"], "exec"), G)
sys.stdout = buf

STATES, WORDS, FRAME, N, W = G["STATES"], G["WORDS"], G["FRAME"], G["N"], G["W"]

moves = []
for i in range(N):
    st = STATES[i]
    for a, b in zip(st, st[1:]):
        d = math.hypot(b[1][0] - a[1][0], b[1][1] - a[1][1])
        if d < 8:
            continue
        moves.append((d, b[0] - FRAME[i], WORDS[i][0], a[0], b[0]))

moves.sort(reverse=True)
big = [m for m in moves if m[0] > W * 0.25]
early = [m for m in moves if m[0] > W * 0.12 and m[1] < 60]
print("moves >8px: %d   >quarter-screen (%dpx): %d   far-and-early: %d"
      % (len(moves), W * 0.25, len(big), len(early)))
print("\n-- longest --")
for d, lat, w, f0, f1 in moves[:12]:
    print("  %-17s %5.0f px  (%.2f screens)  f%.0f->%.0f  %+.0f f after arrival"
          % (w, d, d / W, f0, f1, lat))
print("\n-- far AND soon after the word appeared --")
for d, lat, w, f0, f1 in sorted(early, key=lambda m: m[1])[:12]:
    print("  %-17s %5.0f px  f%.0f->%.0f  only %.0f f after arrival"
          % (w, d, f0, f1, lat))
