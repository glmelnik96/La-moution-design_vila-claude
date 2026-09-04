# -*- coding: utf-8 -*-
"""Audit the frozen Ya layout for words that touch or crowd.

Reads ya_layout.json - the artifact the client signed off and the generator
builds from - and measures every pair. Deliberately independent of form_ya.py:
the packer's own grid is what could be wrong, so re-using its Field class to
check it would only confirm its own rounding back to itself.

Reports the GAP, not just intersection. A checker that gates on overlap cannot
tell you how close you are to it: two words 1 px apart score exactly as well as
two 100 px apart, while on screen the first pair reads as one run-on word.
"""
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))

WARN = float(os.environ.get("YA_WARN", 12))     # px below which a pair crowds

G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
sys.argv = [sys.argv[0], "--v5"]
_buf, sys.stdout = sys.stdout, io.StringIO()
exec(compile(open(G["__file__"], encoding="utf-8").read(), G["__file__"], "exec"), G)
sys.stdout = _buf
WORDS, BOX = G["WORDS"], G["BOX"]

L = json.load(open(os.path.join(HERE, "ya_layout.json"), encoding="utf-8"))
slots = L["slots"]

# Ink boxes WITHOUT pad - what the viewer actually sees. The packer reserves
# pad around each word; the audit must not credit itself with that reservation.
box = []
for s in slots:
    i = s["i"]
    r = s["pt"] / float(WORDS[i][2])
    hw, hh = BOX[i]["wd"] * r / 2.0, BOX[i]["ht"] * r / 2.0
    box.append((s["w"], s["x"] - hw, s["x"] + hw, s["y"] - hh, s["y"] + hh))

hits, tight = [], []
for a in range(len(box)):
    wa, ax0, ax1, ay0, ay1 = box[a]
    for b in range(a + 1, len(box)):
        wb, bx0, bx1, by0, by1 = box[b]
        # Separation on each axis; a pair is apart if EITHER axis separates.
        gx = max(bx0 - ax1, ax0 - bx1)
        gy = max(by0 - ay1, ay0 - by1)
        gap = max(gx, gy)
        if gap < 0:
            hits.append((gap, wa, wb))
        elif gap < WARN:
            tight.append((gap, wa, wb))

print("%d instances, %d pairs" % (len(box), len(box) * (len(box) - 1) // 2))
if hits:
    hits.sort()
    print("OVERLAP: %d pairs" % len(hits))
    for g, wa, wb in hits[:20]:
        print("   %6.1f px  %s / %s" % (g, wa, wb))
else:
    print("OVERLAP: none")

tight.sort()
print("tighter than %.0f px: %d pairs" % (WARN, len(tight)))
for g, wa, wb in tight[:15]:
    print("   %6.1f px  %s / %s" % (g, wa, wb))
