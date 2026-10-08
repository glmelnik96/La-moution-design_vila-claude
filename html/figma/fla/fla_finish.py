"""fla_finish.py — write the JSFL that makes Animate open a generated XFL, save it as .fla, publish HTML5 Canvas and
export PNG stills, then run it in Animate and wait for its log.
    python tools/fla_finish.py BUILD_DIR NAME OUT_DIR frame,frame,...
Paths must be ASCII (JSFL file URIs)."""
import os, subprocess, sys, time

ANIMATE = r'C:\Program Files\Adobe\Adobe Animate 2024\Animate.exe'

JS = r'''
var LOG = FLfile.platformPathToURI("%(log)s");
var lines = [];
function log(s) { lines.push(s); FLfile.write(LOG, lines.join("\n") + "\n"); }
function step(n, f) { try { var r = f(); log("ok  " + n + (r !== undefined ? " -> " + r : "")); return r; } catch (e) { log("ERR " + n + ": " + e); } }
var doc = step("open", function () { return fl.openDocument(FLfile.platformPathToURI("%(xfl)s")); });
if (doc) {
  step("info", function () { var t = doc.getTimeline(); return doc.type + " " + doc.width + "x" + doc.height + " fps " + doc.frameRate + " layers " + t.layers.length + " frames " + t.frameCount + " symbols " + doc.library.items.length; });
  step("save", function () { return fl.saveDocument(doc, FLfile.platformPathToURI("%(fla)s")); });
  step("publish", function () { doc.publish(); return FLfile.exists(FLfile.platformPathToURI("%(js)s")); });
  var F = [%(frames)s];
  for (var i = 0; i < F.length; i++) (function (n) {
    step("png " + n, function () { doc.getTimeline().currentFrame = n; return doc.exportPNG(FLfile.platformPathToURI("%(png)s" + n + ".png"), true, true); });
  })(F[i]);
  step("close", function () { fl.closeDocument(doc, false); });
}
log("done");
'''


def main():
    build, name, out, frames = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    os.makedirs(out, exist_ok=True)
    log = os.path.join(out, name + '_jsfl.log')
    if os.path.exists(log): os.remove(log)
    fwd = lambda p: os.path.abspath(p).replace(os.sep, '/')
    js = JS % {'log': fwd(log), 'xfl': fwd(os.path.join(build, name + '.xfl')), 'fla': fwd(os.path.join(out, name + '.fla')),
               'js': fwd(os.path.join(out, name + '.js')), 'png': fwd(os.path.join(out, 'png_')), 'frames': frames}
    jsfl = os.path.join(out, name + '_finish.jsfl')
    open(jsfl, 'w', encoding='utf-8').write(js)
    subprocess.Popen([ANIMATE, jsfl])
    t0 = time.time()
    while time.time() - t0 < 600:
        if os.path.exists(log) and 'done' in open(log, encoding='utf-8', errors='replace').read(): break
        time.sleep(2)
    print(open(log, encoding='utf-8', errors='replace').read() if os.path.exists(log) else 'no log')


if __name__ == '__main__':
    main()
