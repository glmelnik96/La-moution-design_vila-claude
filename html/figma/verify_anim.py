"""verify_anim.py — does the ANIMATION pass through the Figma frames? Shoots every rest-frame hold listed
in the page's window.__MARKS ({"F3": t, …}) and diffs it with the Figma crop of that frame.

    python verify_anim.py page.html "figma/frames/s3_f%02d.png" [--mask 3:92-1053,4:92-1053]
      the pattern gets the frame number from the mark name (F3 → 3)
      --mask N:y0-y1  blanks rows y0..y1 of frame N in the diff (layers that never stop, e.g. a scrolling pattern)
Prints mean |diff| (/255) and the share of pixels off by >24 and >64; writes Fn_diff.png next to the shots.
Run it after every timing change — a later keyframe silently resetting a state shows up here, not by eye.
"""
import json, os, re, subprocess, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))

def main():
    page, pattern = sys.argv[1], sys.argv[2]
    masks = {}
    if "--mask" in sys.argv:
        for m in sys.argv[sys.argv.index("--mask") + 1].split(","):
            n, rng = m.split(":"); y0, y1 = rng.split("-")
            masks[int(n)] = (int(y0), int(y1))
    env = dict(os.environ)
    marks = json.loads(subprocess.run(["node", os.path.join(HERE, "marks.js"), page], env=env, capture_output=True, text=True, check=True).stdout)
    name = re.sub(r"[^\w]+", "_", os.path.basename(page))
    out = os.path.join("out", "verify", "anim_" + name)
    os.makedirs(out, exist_ok=True)
    frames = sorted([k for k in marks if re.match(r"F\d+$", k) and marks[k] is not None], key=lambda k: int(k[1:]))
    jobs = [{"page": page, "t": marks[k], "out": os.path.join(out, k + ".png")} for k in frames]
    json.dump(jobs, open(os.path.join(out, "_jobs.json"), "w"), indent=1)
    subprocess.run(["node", os.path.join(HERE, "shoot.js"), "--jobs", os.path.join(out, "_jobs.json")], env=env, check=True, stdout=subprocess.DEVNULL)
    print("%s  frame      t    mean     >24     >64" % page)
    for k in frames:
        n = int(k[1:])
        a = np.asarray(Image.open(pattern % n).convert("RGB")).astype(np.int16)
        b = np.asarray(Image.open(os.path.join(out, k + ".png")).convert("RGB")).astype(np.int16)
        H, W = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
        d = np.abs(a[:H, :W] - b[:H, :W]).max(axis=2)
        d[:, 0] = 0                                   # Figma frames often start at x 0.5-1 (section bg shows)
        if n in masks:
            d[masks[n][0]:masks[n][1], :] = 0
        Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).save(os.path.join(out, k + "_diff.png"))
        print("      %-5s %6.2f %7.3f %6.3f%% %6.3f%%" % (k, marks[k], d.mean(), 100 * (d > 24).mean(), 100 * (d > 64).mean()))

if __name__ == "__main__":
    main()
