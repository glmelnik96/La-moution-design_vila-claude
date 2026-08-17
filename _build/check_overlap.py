# -*- coding: utf-8 -*-
"""Sample the v4 animation frame by frame and report ink-box collisions.

The packer guarantees a clean layout at every EVENT, but words travel between
events - and a word asked to leave before it has finished a previous move can
still be sitting in a slot the next word has already landed on. That defect is
invisible in a spot check of four frames and obvious on a per-frame sweep.
"""
import io
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

STATES, BOX, WORDS, FRAME = G["STATES"], G["BOX"], G["WORDS"], G["FRAME"]
N, F_LAST = G["N"], G["F_LAST"]
OPA, OPMAX = G["OPA"], G["OPMAX"]


def opacity(i, f):
    """Interpolated opacity, as a fraction of the word's own full value.

    A word blanked while it crosses another cannot collide with anything: it is
    not on screen. Reading geometry alone reports those crossings as defects.
    """
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
    """Linear read of the (position, size ratio) state list - the real curve is
    eased, so this understates mid-move offsets and never invents a collision."""
    if f <= st[0][0]:
        return st[0][1], st[0][2]
    for a, b in zip(st, st[1:]):
        if f <= b[0]:
            u = (f - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 1.0
            return ((a[1][0] + (b[1][0] - a[1][0]) * u,
                     a[1][1] + (b[1][1] - a[1][1]) * u),
                    a[2] + (b[2] - a[2]) * u)
    return st[-1][1], st[-1][2]


worst = {}
frames = {}
for f in range(0, int(F_LAST) + 90):
    live = []
    for i in range(N):
        if f < FRAME[i] + 4:
            continue
        if opacity(i, f) < 0.20:
            continue
        p, r = sample(STATES[i], f)
        b = BOX[i]
        live.append((i, p[0] - b["wd"] * r / 2, p[0] + b["wd"] * r / 2,
                     p[1] - b["ht"] * r / 2, p[1] + b["ht"] * r / 2))
    for a in range(len(live)):
        for c in range(a + 1, len(live)):
            i, l1, r1, t1, b1 = live[a]
            j, l2, r2, t2, b2 = live[c]
            ox = min(r1, r2) - max(l1, l2)
            oy = min(b1, b2) - max(t1, t2)
            if ox > 0 and oy > 0:
                k = (i, j)
                small = min((r1 - l1) * (b1 - t1), (r2 - l2) * (b2 - t2))
                frac = ox * oy / small
                frames[k] = frames.get(k, 0) + 1
                if frac > worst.get(k, (0,))[0]:
                    worst[k] = (frac, f, round(ox), round(oy))

# A crossing that covers a fifth of the smaller word for more than a couple of
# frames reads as a collision; anything less is two words brushing past.
bad = [(k, v) for k, v in worst.items() if v[0] > 0.20 and frames[k] > 2]
bad.sort(key=lambda kv: -kv[1][0] * frames[kv[0]])
print("real collisions: %d  (of %d touching pairs)" % (len(bad), len(worst)))
for (i, j), (frac, f, ox, oy) in bad[:15]:
    print("  f%-4d %-16s x %-16s  %3d%% of the smaller, %2d frames"
          % (f, WORDS[i][0], WORDS[j][0], frac * 100, frames[(i, j)]))
