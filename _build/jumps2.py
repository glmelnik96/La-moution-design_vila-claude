# -*- coding: utf-8 -*-
"""Second read on jerkiness: episodes and chained travel, not single hops.

The first measurement found only one move over a quarter screen and concluded
the layout was calm. That was the wrong statistic. Two things it missed:

  1. A word that moves 13 separate times reads as fidgety even if every hop is
     small - the eye tracks the number of starts, not the distance.
  2. Consecutive segments in the same direction are ONE perceived flight. A word
     that goes 300 px three times in a row has crossed 900 px, and the state
     list records it as three innocuous moves.
"""
import io
import math
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
VERFLAG = os.environ.get("CLOUD_VER", "--v4")
sys.argv = [sys.argv[0], VERFLAG]
G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
buf, sys.stdout = sys.stdout, io.StringIO()
exec(compile(open(G["__file__"], encoding="utf-8").read(), G["__file__"], "exec"), G)
sys.stdout = buf

STATES, WORDS, FRAME, N, W = G["STATES"], G["WORDS"], G["FRAME"], G["N"], G["W"]

rows = []
for i in range(N):
    st = STATES[i]
    segs = [(a[0], b[0], a[1], b[1], math.hypot(b[1][0] - a[1][0], b[1][1] - a[1][1]))
            for a, b in zip(st, st[1:])]
    segs = [s for s in segs if s[4] > 8]
    # chain segments separated by less than 20 idle frames into one flight
    flights, cur = [], None
    for f0, f1, p0, p1, d in segs:
        if cur and f0 - cur[1] <= 20:
            cur = [cur[0], f1, cur[2], p1, cur[4] + d]
        else:
            if cur:
                flights.append(cur)
            cur = [f0, f1, p0, p1, d]
    if cur:
        flights.append(cur)
    net = [math.hypot(fl[3][0] - fl[2][0], fl[3][1] - fl[2][1]) for fl in flights]
    rows.append((len(flights), max(net) if net else 0, sum(s[4] for s in segs),
                 WORDS[i][0], flights))

print("word                flights  farthest-flight  total-path")
for nf, mx, tot, w, _ in sorted(rows, reverse=True)[:14]:
    print("  %-17s %3d      %5.0f px (%.2f scr)   %5.0f px" % (w, nf, mx, mx / W, tot))

allf = [f for r in rows for f in r[4]]
net = sorted((math.hypot(f[3][0] - f[2][0], f[3][1] - f[2][1]), f) for f in allf)
print("\nflights total: %d   over half a screen: %d   over a third: %d"
      % (len(allf), sum(1 for d, _ in net if d > W * 0.5),
         sum(1 for d, _ in net if d > W / 3.0)))
print("median flight %.0f px, 90th pct %.0f px, max %.0f px"
      % (net[len(net) // 2][0], net[int(len(net) * 0.9)][0], net[-1][0]))
print("\n-- the flights a viewer would call 'flew across the screen' --")
for d, fl in sorted(net, reverse=True)[:10]:
    who = [r[3] for r in rows if fl in r[4]][0]
    print("  %-17s %5.0f px (%.2f scr)  f%.0f -> f%.0f  over %.0f frames"
          % (who, d, d / W, fl[0], fl[1], fl[1] - fl[0]))
