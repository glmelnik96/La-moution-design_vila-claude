# -*- coding: utf-8 -*-
"""Third and correct read on jerkiness: peak speed of a single continuous move.

Both earlier scripts measured the wrong thing.

  jumps.py  measured per-segment DISTANCE and found almost nothing over a
            quarter screen, so it declared the layout calm.
  jumps2.py measured CHAINED distance with a 20-frame gap tolerance, which
            glued three seconds of slow drift into one 1283 px "flight" and
            declared the same layout violent.

Neither is what the complaint describes. "A word appears and then abruptly
flies across half the screen" is about SPEED - a large distance covered in a
short time. Distance alone cannot express it and chained distance actively
hides it, because chaining rewards exactly the slow migrations that look fine.

So: report px/frame on each uninterrupted segment, plus how soon after the
word arrived it happens, because the same speed reads worse on a word the eye
has only just found.
"""
import io
import math
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0], os.environ.get("CLOUD_VER", "--v4")]
G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
buf, sys.stdout = sys.stdout, io.StringIO()
exec(compile(open(G["__file__"], encoding="utf-8").read(), G["__file__"], "exec"), G)
sys.stdout = buf

STATES, WORDS, FRAME, N, W = G["STATES"], G["WORDS"], G["FRAME"], G["N"], G["W"]

segs = []
for i in range(N):
    for a, b in zip(STATES[i], STATES[i][1:]):
        d = math.hypot(b[1][0] - a[1][0], b[1][1] - a[1][1])
        dt = max(b[0] - a[0], 1e-6)
        if d < 30:
            continue
        segs.append((d / dt, d, dt, a[0], b[0] - FRAME[i], WORDS[i][0]))

segs.sort(reverse=True)
print("%s   moves >30px: %d" % (sys.argv[1], len(segs)))
fast = [s for s in segs if s[0] > 40]
harsh = [s for s in segs if s[0] > 40 and s[4] < 90]
print("faster than 40 px/f: %d      of those, within 3.6 s of arrival: %d"
      % (len(fast), len(harsh)))
sp = [s[0] for s in segs]
print("speed  median %.0f   90th %.0f   max %.0f px/frame"
      % (sp[len(sp) // 2], sp[int(len(sp) * 0.1)], sp[0]))
print("\n-- fastest single moves --")
for v, d, dt, f0, lat, w in segs[:10]:
    print("  %-17s %3.0f px/f   %5.0f px in %2.0f f   at f%-4.0f  %+4.0f f after arrival"
          % (w, v, d, dt, f0, lat))
