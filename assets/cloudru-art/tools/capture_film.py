# -*- coding: utf-8 -*-
"""Capture every frame of a built film from the live AE and encode the preview, one AE call at a time.
python capture_film.py <film> [<film> ...]
  _build/cap_full<n>_<k>.jsx (600 frames each; saveFrameToPng is asynchronous: wait for the chunk's last frame) -> tools/preview.py"""
import re
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path("C:/Users/Глеб/Documents/Motion Skill/gct-presentation")
SKILL = Path("C:/Users/Глеб/.claude/skills/ae-motion-live")


def ae(jsx, timeout=900000):
    t0 = time.time()
    r = subprocess.run(["node", "scripts/ae.js", "--timeout", str(timeout), "@" + str(jsx)], cwd=str(SKILL),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (r.stdout or "") + (r.stderr or "")
    ok = '"ok":true' in out.replace(" ", "")
    print("AE %-20s %5.0fs %s %s" % (jsx.name, time.time() - t0, "OK" if ok else "FAIL", "" if ok else out.strip().replace("\n", " ")[-400:]), flush=True)
    if not ok:
        print("STOP: AE did not answer ok:true - not retrying.", flush=True)
        sys.exit(2)
    return out


def wait_for(path, limit=1500):
    t0, size = time.time(), -1
    while time.time() - t0 < limit:
        if path.exists():
            s = path.stat().st_size
            if s == size and s > 0:
                return True
            size = s
        time.sleep(3)
    return False


resume = "--resume" in sys.argv          # keep chunks already on disk (an interrupted capture of an unchanged build)
for film in [a for a in sys.argv[1:] if not a.startswith("--")]:
    pv = Path("C:/dev/gct-pres/pv%s" % film)
    pv.mkdir(parents=True, exist_ok=True)
    if not resume:
        for f in pv.glob("pv_*.png"):
            f.unlink()
    chunks = sorted((ROOT / "_build").glob("cap_full%s_*.jsx" % film), key=lambda p: int(p.stem.split("_")[-1]))
    for ch in chunks:
        src = ch.read_text(encoding="ascii")
        a0, b0 = (int(v) for v in re.search(r"for \(var k = (\d+); k < (\d+);", src).groups())
        last = pv / ("pv_%04d.png" % (b0 - 1))
        if resume and (pv / ("pv_%04d.png" % a0)).exists():
            if not wait_for(last):                          # a chunk still rendering from the interrupted run
                print("STOP: last frame of", ch.name, "did not appear", flush=True)
                sys.exit(3)
            print("skip %s: frames %d-%d on disk" % (ch.name, a0, b0 - 1), flush=True)
            continue
        ae(ch)
        if not wait_for(last):
            print("STOP: last frame of", ch.name, "did not appear", flush=True)
            sys.exit(3)
    time.sleep(3)
    n = len(list(pv.glob("pv_*.png")))
    print("film %s: %d frames captured" % (film, n), flush=True)
    r = subprocess.run([sys.executable, "tools/preview.py", film], cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    print((r.stdout or "") + (r.stderr or ""), flush=True)
