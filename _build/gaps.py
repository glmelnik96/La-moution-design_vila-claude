# -*- coding: utf-8 -*-
"""Report the tightest GAP between visible words, not just the overlaps.

check_overlap.py gates on ink-box intersection, so two words separated by 1 px
score exactly as well as two separated by 100. Rendered frames show that is not
how it reads: PODEDY and OSNOVOPOLAGAYUSHCHIY at f275 have no overlap at all and
still print as one run-on word.

The cause is the stay_put deadband. The packer lays out a clean grid with PADX
of clearance, then each word is allowed to ignore a displacement under DAMP - and
BOTH words either side of a gap may ignore one, toward each other. So the real
guarantee is PADX - 2*DAMP, not PADX - DAMP, which is what the deadband comment
in gen_cloud.py assumed.
"""
import io
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0], os.environ.get("CLOUD_VER", "--v5")]
G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
buf, sys.stdout = sys.stdout, io.StringIO()
exec(compile(open(G["__file__"], encoding="utf-8").read(), G["__file__"], "exec"), G)
sys.stdout = buf

STATES, BOX, WORDS, FRAME = G["STATES"], G["BOX"], G["WORDS"], G["FRAME"]
N, OPA, OPMAX = G["N"], G["OPA"], G["OPMAX"]
PADX, PADY, DAMP = G["PADX"], G["PADY"], G["DAMP"]


def opacity(i, f):
    ops = OPA[i]
    if f <= ops[0][0]:
        v = ops[0][1]
    elif f >= ops[-1][0]:
        v = ops[-1][1]
    else:
        v = ops[-1][1]
        for a, b in zip(ops, ops[1:]):
            if f <= b[0]:
                u = (f - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 1.0
                v = a[1] + (b[1] - a[1]) * u
                break
    return v / OPMAX[WORDS[i][1]]


def sample(st, f):
    if f <= st[0][0]:
        return st[0][1], st[0][2]
    for a, b in zip(st, st[1:]):
        if f <= b[0]:
            u = (f - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 1.0
            return ((a[1][0] + (b[1][0] - a[1][0]) * u,
                     a[1][1] + (b[1][1] - a[1][1]) * u),
                    a[2] + (b[2] - a[2]) * u)
    return st[-1][1], st[-1][2]


# Only settled frames: a word mid-flight is expected to pass close to others,
# and the dip system already blanks it. What must never read as cramped is the
# layout the eye rests on.
tight = []
for f in range(40, 740, 5):
    live = []
    for i in range(N):
        if f < FRAME[i] + 10 or opacity(i, f) < 0.75:
            continue
        p, r = sample(STATES[i], f)
        b = BOX[i]
        live.append((i, p[0] - b["wd"] * r / 2, p[0] + b["wd"] * r / 2,
                     p[1] - b["ht"] * r / 2, p[1] + b["ht"] * r / 2))
    for a in range(len(live)):
        for c in range(a + 1, len(live)):
            i, l1, r1, t1, b1 = live[a]
            j, l2, r2, t2, b2 = live[c]
            gx = max(l1, l2) - min(r1, r2)
            gy = max(t1, t2) - min(b1, b2)
            # only a pair that actually shares a band on the other axis can read
            # as touching; diagonal neighbours always look separate
            if gx < gy:
                continue
            tight.append((gx, f, WORDS[i][0], WORDS[j][0]))

tight.sort()
print("PADX %d  PADY %d  DAMP %.0f   worst-case guaranteed gap %d px"
      % (PADX, PADY, DAMP, PADX - 2 * DAMP))
print("side-by-side pairs sampled: %d   touching (<=2px): %d   cramped (<10px): %d"
      % (len(tight), sum(1 for t in tight if t[0] <= 2),
         sum(1 for t in tight if t[0] < 10)))
print("\n-- tightest --")
seen = set()
for gx, f, w1, w2 in tight:
    k = tuple(sorted((w1, w2)))
    if k in seen:
        continue
    seen.add(k)
    print("  %5.0f px   f%-4d %s / %s" % (gx, f, w1, w2))
    if len(seen) >= 10:
        break
