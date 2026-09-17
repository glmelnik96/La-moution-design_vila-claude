# -*- coding: utf-8 -*-
"""Build one film in the live AE and verify it, strictly one AE call at a time.
python build_film.py <film> [--nogen]
  cleanup_f<n>.jsx -> deck_F<n>.jsx -> deck_M_<n>.jsx -> cap_verify_<n>.jsx (poll the last frame) -> check / bgdiff / qa_sheet
Stops at the first AE call that does not answer ok:true (a CDP timeout means a modal is up: never retry)."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
film = sys.argv[1]
ROOT = Path("C:/Users/Глеб/Documents/Motion Skill/gct-presentation")
SKILL = Path("C:/Users/Глеб/.claude/skills/ae-motion-live")
NODE = "node"


def ae(jsx, timeout=900000):
    t0 = time.time()
    r = subprocess.run([NODE, "scripts/ae.js", "--timeout", str(timeout), "@" + str(jsx)], cwd=str(SKILL),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (r.stdout or "") + (r.stderr or "")
    ok = '"ok":true' in out.replace(" ", "") or '"ok": true' in out
    tail = out.strip().replace("\n", " ")[-600:]
    print("AE %-28s %5.0fs %s %s" % (jsx.name, time.time() - t0, "OK" if ok else "FAIL", "" if ok else tail), flush=True)
    if not ok:
        print("STOP: AE did not answer ok:true - not retrying.", flush=True)
        sys.exit(2)
    return out


def py(*args):
    r = subprocess.run([sys.executable] + list(args), cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    print((r.stdout or "") + (r.stderr or ""), flush=True)
    return r.returncode


B = ROOT / "_build"
if "--nogen" not in sys.argv:
    if py("tools/deck.py", film) != 0:
        sys.exit(1)
    if py("tools/verify_deck.py", "gen", film) != 0:
        sys.exit(1)
pts = json.load(open(B / ("deck_verify_%s.json" % film), encoding="utf-8"))["points"]
n_frames = len(set(p["t_master"] for p in pts))
vf = Path("C:/dev/gct-pres/vf%s" % film)
for f in vf.glob("vf_*.png"):
    f.unlink()

ae(B / ("cleanup_f%s.jsx" % film), 300000)
ae(B / ("deck_F%s.jsx" % film))
ae(B / ("deck_M_%s.jsx" % film))
ae(B / ("cap_verify_%s.jsx" % film), 600000)
last = vf / ("vf_%02d.png" % (n_frames - 1))
t0 = time.time()
size = -1
while time.time() - t0 < 900:
    if last.exists():
        s = last.stat().st_size
        if s == size and s > 0:
            break
        size = s
    time.sleep(3)
else:
    print("STOP: last verify frame did not appear", last, flush=True)
    sys.exit(3)
time.sleep(2)
print("frames:", len(list(vf.glob("vf_*.png"))), "of", n_frames, flush=True)
py("tools/verify_deck.py", "check", film)
py("tools/bgdiff.py", film)
py("tools/qa_sheet.py", film)
