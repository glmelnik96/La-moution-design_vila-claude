# -*- coding: utf-8 -*-
"""
Generates _build/code.jsx - the 20-frame "product launch via code" effect.

Visual language: Figma "Go Cloud 26" node 7726-6735 - flat #222222 ground,
monospace tokens inside chips (light #F2F2F2 / green #26D07C, DARK text inside,
text centred with EQUAL padding), thin green connector arrows, dot-grid
placeholder blocks as filler.

Type: SBSansTextMono-Regular, one size everywhere.

LAYOUT IS MEASURED, NOT COMPUTED. SBSansTextMono is not strictly monospaced
(M advance 62.27 vs space advance 65.0 at size 100), so ANY assumed character
cell drifts and the text walks out of its chip. Instead every token is its own
text layer, measured with sourceRectAtTime, and its chip is drawn from that
measurement + a fixed padding. Vertical placement uses the FONT's ascender /
descender (constant), never the per-string ink, so rows with caps/descenders
still sit on one line.

Written with encoding="ascii" so every Cyrillic char becomes \\uXXXX.
NB: do not use ES3 reserved words (char, class, int, ...) as object keys.
"""
import io
import os
import json

FPS = 25.0
W, H = 3840, 2160
CX, CY = W // 2, H // 2

# measured live in AE at fontSize 100 (SBSansTextMono-Regular)
ASC  = 0.7049561
DESC = 0.1883240

SIZE = 68
INK   = SIZE * (ASC + DESC)          # text-box height, constant for every row
VPAD  = SIZE * 0.45
PADX  = SIZE * 0.34                  # equal left/right padding inside a chip
CHIPH = INK + VPAD * 2               # 121.9
PITCH = CHIPH * 1.237                # Figma row pitch / chip height
CHIPDY = -SIZE * (ASC - DESC) / 2.0  # chip centre relative to the baseline
GAP    = SIZE * 0.52                 # gap between elements on a row
INDENT = SIZE * 1.70
ARROWW = SIZE * 2.60
CELL   = SIZE * 0.6227               # nominal cell, only for dot-block widths

DARK  = [0.13333, 0.13333, 0.13333]  # #222222
LIGHT = [0.94900, 0.94900, 0.94900]  # #F2F2F2
GREEN = [0.14900, 0.81600, 0.48600]  # #26D07C
DOT   = [0.40000, 0.40000, 0.40000]

MONO  = "SBSansTextMono-Regular"
MONOB = "SBSansTextMono-Bold"

# (column, kind, value) - every item sits in a shared COLUMN, Figma-style, so
# nothing is ragged. kind: L light chip, G green chip, A arrow, D dot block (n cells)
ROWS = [
    [(0, "G", "@dataclass"), (2, "A", 0), (3, "L", "frozen"), (4, "D", 7)],
    [(0, "L", "class"), (1, "L", "snapshot"), (3, "D", 9), (4, "D", 5)],
    [(1, "L", "label"), (2, "A", 0), (3, "L", "str")],
    [(1, "L", "employees"), (2, "A", 0), (3, "L", "int")],
    [(1, "L", "verified"), (2, "A", 0), (3, "L", "bool")],
    [(0, "L", "timeline"), (2, "A", 0), (3, "D", 8), (4, "D", 6)],
    [(1, "G", "старт"), (2, "A", 0), (3, "L", "10"), (4, "L", "false")],
    [(1, "G", "сегодня"), (2, "A", 0), (3, "L", "2000"), (4, "L", "true")],
    [(0, "L", "def"), (1, "L", "growth"), (2, "A", 0), (3, "L", "b/a")],
    [(0, "G", ">>>"), (2, "A", 0), (3, "L", "200.0"), (4, "D", 6)],
    [(0, "G", "team.launch()"), (2, "A", 0), (3, "D", 8), (4, "D", 4)],
]
NCOL = 5
NROW = len(ROWS)

CY0 = CY - (NROW - 1) * PITCH / 2.0
TOP = CY0 - CHIPH / 2
BOT = CY0 + (NROW - 1) * PITCH + CHIPH / 2

CAP = "\u0440\u043e\u0441\u0442 \u043a\u043e\u043c\u0430\u043d\u0434\u044b \u0437\u0430 7 \u043b\u0435\u0442"
NSZ = 420

DATA = [[[c, k, v] for c, k, v in row] for row in ROWS]

j = io.StringIO()
w = j.write

w("""var comp = app.project.activeItem;
var FD = 1/%(fps)g;
function f(n){ return n*FD; }
var TAG = "CODE_FX";
var END = f(20);

var DARK=%(dark)s, LIGHT=%(light)s, GREEN=%(green)s, DOT=%(dot)s;
var MONO="%(mono)s", MONOB="%(monob)s";
var SIZE=%(size)g, CHIPH=%(chiph)g, PITCH=%(pitch)g, CHIPDY=%(chipdy)g;
var PADX=%(padx)g, GAP=%(gap)g, NCOL=%(ncol)d, ARROWW=%(arroww)g, CELL=%(cell)g;
var CY0=%(cy0)g, CX=%(cx)g;
var ROWS = %(rows)s;

function hold(p){ for(var k=1;k<=p.numKeys;k++) p.setInterpolationTypeAtKey(k,
  KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); }

// Temporal-ease arity is per-property: a TEXT layer's Scale reads back 3
// elements, a shape layer's 2. Derive it, then fall back. (quirk #12/#18)
function ease(p,k,i,o){ var d=(p.value instanceof Array)?p.value.length:1;
  var a=[],b=[]; for(var z=0; z<d; z++){ a.push(new KeyframeEase(0,i)); b.push(new KeyframeEase(0,o)); }
  try { p.setTemporalEaseAtKey(k,a,b); }
  catch(e1){ try { p.setTemporalEaseAtKey(k,[a[0]],[b[0]]); }
             catch(e2){ p.setTemporalEaseAtKey(k,[a[0],a[0]],[b[0],b[0]]); } } }
function reveal(p){ ease(p,1,16,16); ease(p,2,88,88); }   // decisive ease-out, no overshoot

function newShape(name){
  var S = comp.layers.addShape(); S.name = name; S.comment = TAG;
  S.property("Transform").property("Anchor Point").setValue([0,0]);
  S.property("Transform").property("Position").setValue([0,0]);
  return S;
}
function grp(S,name){
  var g = S.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  g.name = name; return g.property("ADBE Vectors Group");
}
function chip(S, x0, x1, yc, h, col){
  var c = grp(S,"chip");
  var r = c.addProperty("ADBE Vector Shape - Rect");
  r.property("ADBE Vector Rect Size").setValue([x1-x0, h]);
  r.property("ADBE Vector Rect Position").setValue([(x0+x1)/2, yc]);
  c.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(col);
}
function arrow(S, xa, xb, y, col){
  var c = grp(S,"arrow");
  var p1 = c.addProperty("ADBE Vector Shape - Group");
  var s1 = new Shape(); s1.vertices = [[xa,y],[xb,y]]; s1.closed = false;
  p1.property("ADBE Vector Shape").setValue(s1);
  var p2 = c.addProperty("ADBE Vector Shape - Group");
  var s2 = new Shape(); s2.vertices = [[xb-26,y-17],[xb,y],[xb-26,y+17]]; s2.closed = false;
  p2.property("ADBE Vector Shape").setValue(s2);
  var st = c.addProperty("ADBE Vector Graphic - Stroke");
  st.property("ADBE Vector Stroke Color").setValue(col);
  st.property("ADBE Vector Stroke Width").setValue(4);
}
// N x M grid from ONE rect via two stacked repeaters. Never emit N*M rects.
function dots(S, x0, y0, nx, ny, step, d, col){
  var c = grp(S,"dots");
  var r = c.addProperty("ADBE Vector Shape - Rect");
  r.property("ADBE Vector Rect Size").setValue([d,d]);
  r.property("ADBE Vector Rect Position").setValue([x0,y0]);
  c.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(col);
  var r1 = c.addProperty("ADBE Vector Filter - Repeater");
  r1.property("ADBE Vector Repeater Copies").setValue(nx);
  r1.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([step,0]);
  var r2 = c.addProperty("ADBE Vector Filter - Repeater");
  r2.property("ADBE Vector Repeater Copies").setValue(ny);
  r2.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([0,step]);
}
function dotBlock(S, x0, x1, yc, h, step, d){
  var nx = Math.floor((x1-x0)/step), ny = Math.floor(h/step);
  if (nx < 1) nx = 1;
  if (ny < 1) ny = 1;
  var ox = x0 + ((x1-x0) - (nx-1)*step)/2;
  var oy = yc - (ny-1)*step/2;
  dots(S, ox, oy, nx, ny, step, d, DOT);
}
function txt(name, str, font, size, col, centred){
  var L = comp.layers.addText(str); L.name = name; L.comment = TAG;
  var P = L.property("ADBE Text Properties").property("ADBE Text Document");
  var d = P.value;
  d.font = font; d.fontSize = size; d.applyFill = true; d.fillColor = col;
  d.applyStroke = false; d.tracking = 0;
  d.justification = centred ? ParagraphJustification.CENTER_JUSTIFY
                            : ParagraphJustification.LEFT_JUSTIFY;
  P.setValue(d);
  L.property("Transform").property("Anchor Point").setValue([0,0]);
  return L;
}
function snapOn(L, fr, dimTo){
  var o = L.property("Transform").property("Opacity");
  o.setValueAtTime(0, 0);
  o.setValueAtTime(f(fr), 100);
  o.setValueAtTime(f(16), 100);
  o.setValueAtTime(f(17), dimTo);
  hold(o);
}
function revealFrame(r){ return 4 + Math.floor(r*0.85 + 0.5); }

app.beginUndoGroup("Code launch FX");
for (var i = comp.numLayers; i >= 1; i--) if (comp.layer(i).comment === TAG) comp.layer(i).remove();
var made = [];
var STEP_ = "init";
try {

// ---------- PASS 1: build every token layer, MEASURE its ink, and find the
//            width each COLUMN needs ----------
STEP_="measure";
var colW = [];
for (var k = 0; k < NCOL; k++) colW[k] = 0;
for (var r = 0; r < ROWS.length; r++){
  var row = ROWS[r];
  for (var i2 = 0; i2 < row.length; i2++){
    var col = row[i2][0], kind = row[i2][1], val = row[i2][2], iw;
    if (kind === "A"){ iw = ARROWW; }
    else if (kind === "D"){ iw = val * CELL; }
    else {
      var L = txt("FX TOK " + r + "." + i2, val, MONO, SIZE, DARK, false);
      var rect = L.sourceRectAtTime(0, false);
      row[i2][3] = L; row[i2][4] = rect.left; row[i2][5] = rect.width;
      iw = rect.width + PADX*2;
    }
    row[i2][6] = iw;
    if (iw > colW[col]) colW[col] = iw;
  }
}
var colX = [], maxW = 0;
for (var k2 = 0; k2 < NCOL; k2++){
  colX[k2] = (k2 === 0) ? 0 : colX[k2-1] + colW[k2-1] + GAP;
  if (colW[k2] > 0) maxW = colX[k2] + colW[k2];
}
var X0 = (comp.width - maxW) / 2;

// ---------- background field ----------
STEP_="field";
var field = newShape("FX FIELD");
dots(field, 40, 40, 96, 54, 40, 3, DOT);
var fo = field.property("Transform").property("Opacity");
fo.setValueAtTime(0, 26); hold(fo);
made.push(field);

// ---------- PASS 2: place text, draw chips ----------
STEP_="rows";
var lightRects = [];
var rowEndX = [];
for (var r = 0; r < ROWS.length; r++){
  var row = ROWS[r];
  var yc = CY0 + r*PITCH;          // chip centre - constant grid
  var yb = yc - CHIPDY;            // baseline
  var fr = revealFrame(r);
  var S = newShape("FX ROW" + (r<10?"0":"") + r);
  var toks = [], endX = 0;
  for (var i3 = 0; i3 < row.length; i3++){
    var col = row[i3][0], kind = row[i3][1], val = row[i3][2];
    var x = X0 + colX[col], wI = row[i3][6];
    if (kind === "A"){
      arrow(S, x + SIZE*0.30, x + wI - SIZE*0.30, yc, GREEN);
    } else if (kind === "D"){
      dotBlock(S, x, x + wI, yc, CHIPH, 22, 4);
    } else {
      var lsb = row[i3][4], ink = row[i3][5], L = row[i3][3];
      var x1 = x + wI;
      chip(S, x, x1, yc, CHIPH, kind === "L" ? LIGHT : GREEN);
      if (kind === "L") lightRects.push([x, x1, yc]);
      // ink sits at x + PADX; the layer origin compensates the left bearing
      L.property("Transform").property("Position").setValue([x + PADX - lsb, yb]);
      snapOn(L, fr, 7); made.push(L); toks.push(L);
    }
    if (x + wI > endX) endX = x + wI;
  }
  rowEndX[r] = endX;
  snapOn(S, fr, 7); made.push(S);
  // pass 1 created the text layers, so they sit BELOW every shape made in
  // pass 2 - lift each token above its own row shape
  for (var i4 = 0; i4 < toks.length; i4++) toks[i4].moveBefore(S);
}
""" % {"fps": FPS, "dark": DARK, "light": LIGHT, "green": GREEN, "dot": DOT,
       "mono": MONO, "monob": MONOB, "size": SIZE, "chiph": CHIPH,
       "pitch": PITCH, "chipdy": CHIPDY, "padx": PADX, "gap": GAP,
       "ncol": NCOL, "arroww": ARROWW, "cell": CELL, "cy0": CY0, "cx": CX,
       "rows": json.dumps(DATA)})

w("""
// ---------- CARET: hard accented double-blink dead centre, then it leads
//            the writing head DOWN the block, row by row ----------
STEP_="caret";
var rule = newShape("FX CARET RULE");
chip(rule, X0 - PADX, X0 + maxW + PADX, %d, 10, GREEN);
var ro = rule.property("Transform").property("Opacity");
ro.setValueAtTime(0,100); ro.setValueAtTime(f(1),0);
ro.setValueAtTime(f(2),100); ro.setValueAtTime(f(2.8),0);
ro.setValueAtTime(f(3.4),100); ro.setValueAtTime(f(4),0); hold(ro);
made.push(rule);

var caret = newShape("FX CARET");
chip(caret, -SIZE*0.62, SIZE*0.62, 0, CHIPH, GREEN);
var cp = caret.property("Transform").property("Position");
cp.setValueAtTime(0, [CX, %d]);
for (var r2 = 0; r2 < ROWS.length; r2++)
  cp.setValueAtTime(f(revealFrame(r2)), [rowEndX[r2] + SIZE*0.75, CY0 + r2*PITCH]);
hold(cp);
// the opening blink is the accent: the caret sits BIG dead centre, then snaps
// down to token size the instant the code starts writing
var cs = caret.property("Transform").property("Scale");
cs.setValueAtTime(0, [190, 190]);
cs.setValueAtTime(f(2), [150, 150]);
cs.setValueAtTime(f(4), [100, 100]); hold(cs);
var cop = caret.property("Transform").property("Opacity");
cop.setValueAtTime(0,100); cop.setValueAtTime(f(1),0);
cop.setValueAtTime(f(2),100); cop.setValueAtTime(f(2.8),0);
cop.setValueAtTime(f(3.4),100); cop.setValueAtTime(f(14),0); hold(cop);
made.push(caret);

// ---------- RUN BAR: green scan sweeps the finished block = execute ----------
STEP_="runbar";
var bar = newShape("FX RUNBAR");
chip(bar, X0 - PADX - 40, X0 + maxW + PADX + 40, 0, 12, GREEN);
var bp = bar.property("Transform").property("Position");
bp.setValueAtTime(f(13), [0, %.1f]); bp.setValueAtTime(f(16), [0, %.1f]); reveal(bp);
var bo = bar.property("Transform").property("Opacity");
bo.setValueAtTime(f(13),0); bo.setValueAtTime(f(13.001),100);
bo.setValueAtTime(f(15.9),100); bo.setValueAtTime(f(16),0); hold(bo);
made.push(bar);

// ---------- IGNITION: green multiply lands ONLY on the light chips.
//            A full-frame multiply would tint the #222 ground green. (quirk #20)
STEP_="ignite";
var ign = newShape("FX IGNITE");
for (var q = 0; q < lightRects.length; q++)
  chip(ign, lightRects[q][0], lightRects[q][1], lightRects[q][2], CHIPH, GREEN);
ign.blendingMode = BlendingMode.MULTIPLY;
var io_ = ign.property("Transform").property("Opacity");
io_.setValueAtTime(f(15),0); io_.setValueAtTime(f(15.001),100);
io_.setValueAtTime(f(16.5),100); io_.setValueAtTime(f(16.6),0); hold(io_);
made.push(ign);

// ---------- RESULT: the launch lands ----------
STEP_="result";
var num = txt("FX NUM", "\\u00d7200", MONOB, %d, LIGHT, true);
var nr = num.sourceRectAtTime(0, false);
num.property("Transform").property("Position").setValue([CX, %d - (nr.top + nr.height/2)]);
var nop = num.property("Transform").property("Opacity");
nop.setValueAtTime(f(16),0); nop.setValueAtTime(f(17.5),100); reveal(nop);
var nsc = num.property("Transform").property("Scale");
nsc.setValueAtTime(f(16),[93,93]); nsc.setValueAtTime(f(18.5),[100,100]); reveal(nsc);
made.push(num);

var capY = %d;
var cap = txt("FX CAP", %s, MONO, SIZE, DARK, true);
var cr = cap.sourceRectAtTime(0, false);
cap.property("Transform").property("Position").setValue([CX, capY - CHIPDY]);
var capBg = newShape("FX CAP BG");
chip(capBg, CX - cr.width/2 - PADX, CX + cr.width/2 + PADX, capY, CHIPH, GREEN);
var cbo = capBg.property("Transform").property("Opacity");
cbo.setValueAtTime(f(17),0); cbo.setValueAtTime(f(17.001),100); hold(cbo);
made.push(capBg);
var cpo = cap.property("Transform").property("Opacity");
cpo.setValueAtTime(f(17),0); cpo.setValueAtTime(f(17.001),100); hold(cpo);
made.push(cap);
capBg.moveAfter(cap);

for (var m = 0; m < made.length; m++){ made[m].inPoint = 0; made[m].outPoint = END; }
STEP_ = "done";
} catch (err) { STEP_ = "FAILED after: " + STEP_ + " | " + err.toString() + " @line " + err.line; }
app.endUndoGroup();
JSON.stringify({ step:STEP_, made:made.length, total:comp.numLayers });
""" % (CY, CY, TOP, BOT, NSZ, CY - 90, CY + 250, json.dumps(CAP)))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "code.jsx")
with open(out, "w", encoding="ascii") as fh:
    fh.write(j.getvalue())
print("written", out, "chars:", len(j.getvalue()),
      "chipH:", round(CHIPH, 1), "pitch:", round(PITCH, 1),
      "blockH:", round(BOT - TOP, 1))
