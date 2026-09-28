"""verify_frames.py — shoot storyboard states of a page (?frame=Fn) and diff them with the Figma crops.
    python verify_frames.py page.html "figma/frames/s1_f%02d.png" F1 F5 ... [--q look=figma] [--w 791 --h 1406] [--map F3=2,F4=3]
The viewport (--w/--h) = the Figma frame size, so 1 design unit = 1 px. Frame numbers map to the crop files by their
digits (F8 → s1_f08.png); --map renumbers. --q is the extra query (default look=figma: the page's Figma-verbatim
switch). Writes out/verify/st_<page>/ with the stills, the diff strips and a sheet (verify.py).
"""
import json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
page, pattern = args.pop(0), args.pop(0)
q, W, H, remap, frames = "look=figma", "791", "1406", {}, []
while args:
    a = args.pop(0)
    if a == "--q": q = args.pop(0)
    elif a == "--w": W = args.pop(0)
    elif a == "--h": H = args.pop(0)
    elif a == "--map": remap = dict((k, int(v)) for k, v in (p.split("=") for p in args.pop(0).split(",")))
    else: frames.append(a)
tag = os.path.splitext(os.path.basename(page))[0]
out = os.path.join(ROOT, "out", "verify", "st_" + tag)
os.makedirs(out, exist_ok=True)
sep = "&" if q else ""
jobs = [{"page": "%s?frame=%s%s%s" % (page, f, sep, q), "t": 0, "out": os.path.join(out, f + ".png")} for f in frames]
pairs = [{"name": f, "figma": os.path.join(ROOT, pattern % remap.get(f, int(f[1:]))), "html": os.path.join(out, f + ".png")} for f in frames]
json.dump(jobs, open(os.path.join(out, "_jobs.json"), "w"), indent=1)
json.dump(pairs, open(os.path.join(out, "_pairs.json"), "w"), indent=1)
env = dict(os.environ, CHROME_PATH=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
subprocess.run(["node", os.path.join(ROOT, "tools", "shoot.js"), "--w", W, "--h", H, "--jobs", os.path.join(out, "_jobs.json")], cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
subprocess.run([sys.executable, os.path.join(ROOT, "tools", "verify.py"), out, os.path.join(out, "_pairs.json")], cwd=ROOT, check=True)
