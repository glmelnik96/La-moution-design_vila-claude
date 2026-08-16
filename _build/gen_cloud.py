# -*- coding: utf-8 -*-
"""
Generates the tag-cloud spot for Slavneft-YANOS in four escalating versions.

Question at the top, 41 answer words accumulating into a packed cloud, logo
sign-off. 4096x2160 @ 25 fps, 30 s.

    python _build/gen_cloud.py        -> _build/cloud.jsx     -> "Comp 1"
    python _build/gen_cloud.py --v2   -> _build/cloud_v2.jsx  -> "Comp 2"
    python _build/gen_cloud.py --v3   -> _build/cloud_v3.jsx  -> "Comp 3"
    python _build/gen_cloud.py --v4   -> _build/cloud_v4.jsx  -> "Comp 4"

v1  reflow. The cloud re-packs after every answer, the way a live poll cloud
    does (Mentimeter / Slido / d3-cloud), and the words already on screen glide
    to their new places.
v2  reflow + physicality. Words gather inward on entry under motion blur, the
    displacement travels outward as a RIPPLE instead of everyone lurching at
    once, a hairline marker pings under each new answer, a counter ticks, and
    the tiers are separated by atmospheric opacity.
v3  everything in v2 staged in real 3D. The tiers sit at different depths and a
    camera drifts and dollies across the whole spot, so the cloud has genuine
    parallax instead of a flat scale-up, and a light sweep crosses it before
    the logo.
v4  everything in v3 plus LIVE VOTING. In v1-v3 a word arrives already at its
    final size, which is a lie: the size is the vote count, and the votes have
    not been cast yet. Here every answer enters small and CLIMBS the type scale
    as votes come in, re-ranking the cloud until 0:25 - so the layout keeps
    re-packing not because new words land, but because the standings change.
    KOLLEKTIV wins the poll on screen: it enters merely first among equals and
    surges to 370 pt at the climax. The counter now counts VOTES, not words.

Two passes, because the packer needs real ink boxes and only AE can measure
those:

    python _build/gen_cloud.py --measure          -> _build/measure.jsx
    node scripts/ae.js '@_build/measure.jsx'      -> _build/boxes.json

Packing all 41 layouts inside ExtendScript would be minutes of work in AE;
in Python it is instant, and the layouts can be sanity-checked offline.

Brand palette sampled from Logo/IMG_1493 (the brandbook swatch card).
Written with encoding="ascii" so every Cyrillic char becomes \\uXXXX.
NB: do not use ES3 reserved words (char, class, int, ...) as object keys.
"""
import io
import math
import os
import sys
import json

HERE = os.path.dirname(os.path.abspath(__file__))
BOXES = os.path.join(HERE, "boxes.json")

VER = 1
for a in ("--v2", "--v3", "--v4"):
    if a in sys.argv:
        VER = int(a[-1])
COMP_NAME = {1: "Comp 1", 2: "Comp 2", 3: "Comp 3", 4: "Comp 4"}[VER]
OUTNAME = {1: "cloud.jsx", 2: "cloud_v2.jsx",
           3: "cloud_v3.jsx", 4: "cloud_v4.jsx"}[VER]
IS3D = (VER >= 3)
RICH = (VER >= 2)          # gather-in, ripple, marker, counter, motion blur
GROW = (VER == 4)          # words climb the type scale as votes arrive

FPS = 25.0
W, H = 4096, 2160
CX, CY = W // 2, H // 2
DUR_F = 750                      # 30 s

# ---- brand palette (sampled from the brandbook swatch card) ----
NAVY   = [0.00784, 0.05490, 0.11765]   # #02101E  ground
NAVY2  = [0.03922, 0.20000, 0.34118]   # #0A3357  radial lift
WHITE  = [1.0, 1.0, 1.0]
BLUE_D = [0.00392, 0.27843, 0.52157]   # #014785  main blue
BLUE   = [0.10980, 0.50980, 0.76863]   # #1C82C4  main light blue
BLUE_L = [0.40392, 0.70196, 0.89804]   # #67B3E5  add light blue
BLUE_P = [0.75294, 0.89412, 0.98824]   # #C0E4FC  add pale
RED    = [0.95294, 0.07843, 0.08235]   # #F31415  add red

FONT = "Arial-BoldMT"

QUESTION = "\u0421 \u043a\u0430\u043a\u0438\u043c \u0441\u043b\u043e\u0432\u043e\u043c \u0443 \u0432\u0430\u0441 \u0430\u0441\u0441\u043e\u0446\u0438\u0438\u0440\u0443\u0435\u0442\u0441\u044f \u0421\u043b\u0430\u0432\u043d\u0435\u0444\u0442\u044c-\u042f\u041d\u041e\u0421?"
QSIZE = 78
CNT_LABEL = "\u041e\u0422\u0412\u0415\u0422\u041e\u0412"   # OTVETOV
CNT_SIZE = 44

LOGO = ("C:\\Users\\\u0413\u043b\u0435\u0431\\Downloads\\"
        "\u043e\u0431\u043b\u0430\u043a\u043e \u0442\u0435\u0433\u043e\u0432\\"
        "\u041b\u043e\u0433\u043e\\logo_main.png")


def js(s):
    """Escape a Python str for embedding in a JS string literal, ASCII-only.

    The file is written with encoding="ascii", so every non-ASCII char has to
    become a \\uXXXX escape here rather than being emitted raw.
    """
    out = []
    for ch in s:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ord(ch) < 128:
            out.append(ch)
        else:
            out.append("\\u%04x" % ord(ch))
    return "".join(out)


def jsonjs(obj):
    """json.dumps that is safe to paste into an ASCII-only .jsx."""
    return json.dumps(obj, ensure_ascii=True)


# ---- type scale ----
SZ = {"H": 370, "B": 168, "M": 102, "S": 63}

# words exactly as supplied, grouped by the size column of the xlsx
HERO = ["\u041a\u041e\u041b\u041b\u0415\u041a\u0422\u0418\u0412"]
BIG = ["\u0413\u0418\u0413\u0410\u041d\u0422", "\u041d\u0415\u0424\u0422\u042c", "\u042d\u041d\u0415\u0420\u0413\u0418\u042f",
       "\u041a\u0410\u0427\u0415\u0421\u0422\u0412\u041e", "\u0422\u0415\u0425\u041d\u041e\u041b\u041e\u0413\u0418\u0418",
       "\u0411\u0415\u0417\u041e\u041f\u0410\u0421\u041d\u041e\u0421\u0422\u042c", "\u041b\u0418\u0414\u0415\u0420",
       "\u0411\u0423\u0414\u0423\u0429\u0415\u0415", "\u041b\u042e\u0414\u0418", "\u041a\u041e\u041c\u0410\u041d\u0414\u0410"]
MID = ["\u0421\u0422\u0410\u0411\u0418\u041b\u042c\u041d\u041e\u0421\u0422\u042c",
       "\u041f\u0420\u041e\u0424\u0415\u0421\u0421\u0418\u041e\u041d\u0410\u041b\u042b", "\u0422\u041e\u041f\u041b\u0418\u0412\u041e",
       "\u041d\u0410\u0414\u0415\u0416\u041d\u041e\u0421\u0422\u042c",
       "\u041e\u0422\u0412\u0415\u0422\u0421\u0422\u0412\u0415\u041d\u041d\u041e\u0421\u0422\u042c",
       "\u0422\u0420\u0410\u0414\u0418\u0426\u0418\u0418", "\u041f\u0415\u0420\u0412\u042b\u0419",
       "\u0414\u0412\u0418\u0416\u0415\u041d\u0418\u0415", "\u0424\u041b\u0410\u0413\u041c\u0410\u041d"]
SMALL = ["\u041e\u0421\u041d\u041e\u0412\u041e\u041f\u041e\u041b\u0410\u0413\u0410\u042e\u0429\u0418\u0419",
         "\u041e\u0421\u041e\u0411\u0415\u041d\u041d\u042b\u0419", "\u0421\u0418\u0421\u0422\u0415\u041c\u041d\u042b\u0419",
         "\u0421\u041e\u0412\u0420\u0415\u041c\u0415\u041d\u041d\u042b\u0419",
         "\u041e\u0411\u042a\u0415\u0414\u0418\u041d\u042f\u042e\u0429\u0418\u0419", "\u041d\u0410\u0423\u0427\u041d\u042b\u0419",
         "\u041f\u0415\u0420\u0415\u0420\u0410\u0411\u041e\u0422\u041a\u0410", "\u0420\u0410\u0417\u0412\u0418\u0422\u0418\u0415",
         "\u041f\u0420\u0418\u0417\u0412\u0410\u041d\u0418\u0415", "\u0421\u0418\u041b\u0410",
         "\u0418\u041d\u041d\u041e\u0412\u0410\u0426\u0418\u041e\u041d\u041d\u041e\u0421\u0422\u042c", "\u041c\u041e\u0429\u042c",
         "\u041f\u041e\u0411\u0415\u0414\u042b", "\u041b\u0423\u0427\u0428\u0418\u0419",
         "\u041f\u0415\u0420\u0415\u0414\u041e\u0412\u041e\u0419", "\u0420\u041e\u0414\u041d\u041e\u0419",
         "\u042f\u0420\u041e\u0421\u041b\u0410\u0412\u041b\u042c", "\u0414\u041e\u041c", "\u0414\u0420\u0423\u0417\u042c\u042f",
         "\u0421\u0415\u041c\u042c\u042f", "\u041c\u0415\u0427\u0422\u0410"]

# colour cycles per tier - the hero is white, big words carry the brand blues,
# and red stays a sparse accent exactly as in the client's reference preview
COL_B = [WHITE, BLUE, BLUE_L, WHITE, BLUE, BLUE_L, BLUE, WHITE, BLUE_L, BLUE]
COL_M = [BLUE_L, BLUE_P, BLUE_L, BLUE_P, BLUE_L, WHITE, BLUE_P, BLUE_L, BLUE_P]
COL_S = [BLUE_P, BLUE_L]   # cycled; red is re-assigned by angle after packing


def build_words():
    """(text, tier, fontSize, colour) - list order is SIZE order, biggest first."""
    out = [[HERO[0], "H", SZ["H"], WHITE]]
    for i, wd in enumerate(BIG):
        out.append([wd, "B", SZ["B"], COL_B[i % len(COL_B)]])
    for i, wd in enumerate(MID):
        out.append([wd, "M", SZ["M"], COL_M[i % len(COL_M)]])
    for i, wd in enumerate(SMALL):
        out.append([wd, "S", SZ["S"], COL_S[i % len(COL_S)]])
    return out


WORDS = build_words()
N = len(WORDS)

# ---- timing (frames) ----
F_Q_IN    = 6      # question starts
F_Q_FULL  = 26
F_HERO    = 34     # KOLLEKTIV lands
F_FIRST   = 52     # first supporting word
# v4 gets all the words in early, because the second half of the spot belongs
# to the VOTES: the cloud keeps re-ranking after the last answer has landed
F_LAST    = 545 if GROW else 630
F_LOGO    = 648
F_SWEEP   = 636    # v3 light sweep crosses just before the sign-off
SPAN = F_LAST - F_FIRST

# v4: the voting window. The brief is explicit - sizes must still be changing
# up to 0:25 (f625) - so the last climb starts early enough to SETTLE by then.
F_VOTE0, F_VOTE1 = 118, 604
F_HERO_UP = [300, 566]      # the two moments KOLLEKTIV pulls ahead
HERO_GUARD = 13             # frames a regular climb must keep clear of a surge

DAMP = 9.0 if GROW else 6.0  # px: below this a word stays put (no micro-twitch)
ENTER_F = 9        # gather-in travel (v2/v3)
GATHER = 130.0     # px a word travels inward as it arrives (v2/v3)
MARK_W = 1400      # base width of the answer-marker solid

# v4 type ladder: a word enters one rung below where it will finish (the hero
# two), so the final frame still matches the designed type scale exactly
START_SZ = {"H": 168, "B": 63, "M": 63, "S": 63}
LADDER = {"H": [240, 370], "B": [102, 168], "M": [102], "S": []}
# votes implied by each rung - drives the counter so the number on screen and
# the size on screen are the same fact
VOTES = {63: 3, 102: 14, 168: 31, 240: 58, 370: 96}


def move_len(d):
    """Travel time in frames. A word shoved 800 px and one nudged 40 px must
    not take the same time, or the long move whips and the short one crawls."""
    return max(8.0, min(18.0, 7.0 + d / 85.0))


# ================================ PASS 1 ====================================
def emit_measure():
    """Write measure.jsx: create every word, read its ink box, write boxes.json."""
    b = io.StringIO()
    data = [[wd[0], wd[2]] for wd in WORDS]
    b.write("""// GENERATED by _build/gen_cloud.py --measure
var STEP_ = "init";
try {
var comp = app.project.activeItem;
if (!comp || !(comp instanceof CompItem)) throw new Error("no active comp");
var FONT = "%s";
var WORDS = %s;
app.beginUndoGroup("MEASURE");
STEP_ = "measure";
var out = [];
for (var i = 0; i < WORDS.length; i++){
  var L = comp.layers.addText(WORDS[i][0]);
  var d = L.property("Source Text").value;
  d.font = FONT;
  d.fontSize = WORDS[i][1];
  d.tracking = 0;
  L.property("Source Text").setValue(d);
  var r = L.sourceRectAtTime(0, false);
  out.push({ lf: r.left, tp: r.top, wd: r.width, ht: r.height });
  L.remove();
}
app.endUndoGroup();
STEP_ = "write";
var fl = new File("%s");
fl.encoding = "UTF-8";
fl.open("w");
fl.write(JSON.stringify(out));
fl.close();
STEP_ = "done";
JSON.stringify({ step: STEP_, n: out.length, file: fl.fsName });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
""" % (FONT, jsonjs(data), js(BOXES.replace("\\", "/"))))
    path = os.path.join(HERE, "measure.jsx")
    with open(path, "w", encoding="ascii") as fh:
        fh.write(b.getvalue())
    print("written", path, "words:", N)


if "--measure" in sys.argv:
    emit_measure()
    sys.exit(0)


# ================================ PACKING ===================================
if not os.path.exists(BOXES):
    sys.exit("missing %s - run:  python _build/gen_cloud.py --measure  then\n"
             "  node scripts/ae.js '@_build/measure.jsx'" % BOXES)

with open(BOXES, "r", encoding="utf-8") as fh:
    BOX = json.load(fh)
if len(BOX) != N:
    sys.exit("boxes.json has %d entries, expected %d - re-run --measure"
             % (len(BOX), N))

PADX, PADY = 26, 16          # breathing room around each word
TOPKEEP, BOTKEEP = 440, 190  # reserved for the question / the logo
LGX, LGY = W - 880, H - 340  # the logo signs off bottom-right: keep-out corner
# v3 parallax swings the far tier outward, so it needs a wider safety band
MARGIN = 190 if IS3D else 150
AR = 2.05                    # spiral is wider than tall, like the frame
CYC = CY + 30                # optical centre of the cloud
SPIRAL_T = 1400
SPIRAL_STEP = 0.16


def free(cx, cy, hw, hh, boxes):
    x0, x1, y0, y1 = cx - hw, cx + hw, cy - hh, cy + hh
    if x0 < MARGIN or x1 > W - MARGIN or y0 < TOPKEEP or y1 > H - BOTKEEP:
        return False
    if x1 > LGX and y1 > LGY:
        return False
    for q in boxes:
        if x0 < q[2] and x1 > q[0] and y0 < q[3] and y1 > q[1]:
            return False
    return True


def spiral(ox, oy, hw, hh, boxes):
    """First free spot on an elliptical Archimedean spiral around (ox, oy)."""
    t = 0.0
    while t < SPIRAL_T:
        cx = ox + AR * 3.1 * t * math.cos(t)
        cy = oy + 3.1 * t * math.sin(t)
        if free(cx, cy, hw, hh, boxes):
            return cx, cy
        t += SPIRAL_STEP
    return None


BAILS = [0]


def pack(present, prev, sz=None):
    """Lay out the words in `present` (ids), biggest first, sticky to `prev`.

    Returns {id: (cx, cy)}. Sticky means a word keeps its old spot unless
    something bigger has taken it; only then does it look for the nearest free
    spot, spiralling out from where it already stood - so the crowd parts
    around a newcomer instead of the whole frame reshuffling.

    `sz` maps id -> the font size it is CURRENTLY at (v4); the ink box scales
    linearly with it, and the placement order follows the current size, so a
    word that has just won votes claims its spot before its smaller neighbours.
    """
    def cur(i):
        return WORDS[i][2] if sz is None else sz[i]

    order = sorted(present, key=lambda i: (-cur(i), i))
    boxes, pos = [], {}
    for i in order:
        b = BOX[i]
        r = cur(i) / float(WORDS[i][2])
        hw, hh = b["wd"] * r / 2.0 + PADX, b["ht"] * r / 2.0 + PADY
        p = prev.get(i)
        if p is not None and free(p[0], p[1], hw, hh, boxes):
            cx, cy = p
        else:
            hit = None
            if p is not None:
                hit = spiral(p[0], p[1], hw, hh, boxes)
            if hit is None:
                hit = spiral(CX, CYC, hw, hh, boxes)
            if hit is None:                      # should not happen: bail wide
                hit = (CX, CYC)
                BAILS[0] += 1
            cx, cy = hit
        pos[i] = (cx, cy)
        boxes.append((cx - hw, cy - hh, cx + hw, cy + hh))
    return pos


def arrival_order():
    """Hero first, then the tiers woven proportionally.

    Answers must not arrive biggest-first: a greedy packer never disturbs
    anything when every newcomer is the smallest so far, and the cloud would
    never reflow at all. Weaving the tiers keeps dropping a BIG word into an
    already-crowded centre, which is what makes the crowd part.
    """
    groups = []
    for tier in ("B", "M", "S"):
        groups.append([i for i in range(N) if WORDS[i][1] == tier])
    idx = [0] * len(groups)
    out = [0]
    for _ in range(sum(len(g) for g in groups)):
        best, bestv = -1, -1.0
        for g, grp in enumerate(groups):
            if idx[g] >= len(grp):
                continue
            v = (len(grp) - idx[g]) / float(len(grp))
            if v > bestv:
                best, bestv = g, v
        out.append(groups[best][idx[best]])
        idx[best] += 1
    return out


def arrival_order_rank():
    """v4: the popular answers show up early, with a little local disorder.

    In v1-v3 the weave exists only to force reflow. v4 gets its reflow from the
    VOTES instead, and it needs the opposite arrival rule: a word that will end
    up at 370 pt has to already be near the centre when it starts winning, or
    the cloud finishes with its heavyweights stranded on the rim. Shuffling
    inside windows of six keeps it from reading as a sorted list.
    """
    rest = list(range(1, N))
    seed = 20260814
    for a in range(0, len(rest), 6):
        win = rest[a:a + 6]
        for b in range(len(win) - 1, 0, -1):
            seed = (seed * 1103515245 + 12345) % (1 << 31)
            c = seed % (b + 1)
            win[b], win[c] = win[c], win[b]
        rest[a:a + 6] = win
    return [0] + rest


ARRIVE = arrival_order_rank() if GROW else arrival_order()

# arrival frames: a constant interval reads as a metronome, the mild power
# curve makes the cloud start deliberately and gather pace as it fills
FRAME = {ARRIVE[0]: F_HERO}
for k in range(1, N):
    u = (k - 1) / float(N - 2)
    FRAME[ARRIVE[k]] = F_FIRST + SPAN * math.pow(u, 1.14)

# ---- the event list: what happens, when, to whom ----
# v1-v3: one event per arrival.  v4: arrivals AND vote climbs, interleaved.
# ["a"|"g", frame, word, size it is at from now on]
if GROW:
    EV = [[FRAME[i], "a", i, START_SZ[WORDS[i][1]]] for i in range(N)]

    climbs = []
    for i in range(N):
        for j, s in enumerate(LADDER[WORDS[i][1]]):
            climbs.append([i, j, s])
    # a word's second rung comes a good six seconds after its first, and words
    # that arrived early start winning early
    climbs.sort(key=lambda c: (FRAME[c[0]] + c[1] * 150.0, c[0], c[1]))

    rest = [c for c in climbs if c[0] != 0]
    last = -1e9
    for j, c in enumerate(rest):
        t = F_VOTE0 + (F_VOTE1 - F_VOTE0) * j / float(len(rest) - 1)
        # never before the word is on screen, and never on the same frame as
        # the previous climb - the drumbeat has to stay audible
        t = max(t, FRAME[c[0]] + 30.0, last + 7.0)
        # and never on top of a hero surge. The hero is scheduled by hand, so
        # it can land a frame or two from a regular climb, and then TWO full
        # re-packs ripple at once - the hero's is the widest of all, it shoves
        # every neighbour. Overlapping ripples cross far more often than either
        # alone, and each crossing costs a word off screen: nine words vanished
        # together at f568. Push the regular climb clear so the waves take turns.
        for h in F_HERO_UP:
            if h - HERO_GUARD < t < h + HERO_GUARD:
                t = h + HERO_GUARD
        last = t
        EV.append([t, "g", c[0], c[2]])
    # the hero is scheduled by hand: its two surges are the act breaks
    for j, c in enumerate([c for c in climbs if c[0] == 0]):
        EV.append([float(F_HERO_UP[j]), "g", 0, c[2]])
    EV.sort(key=lambda e: e[0])
else:
    EV = [[FRAME[i], "a", i, WORDS[i][2]] for i in ARRIVE]

# ---- run the packer once per event ----
layouts, SIZES = [], []
present, sz, prev = [], {}, {}
for e in EV:
    if e[1] == "a":
        present.append(e[2])
    sz[e[2]] = e[3]
    prev = pack(present, prev, sz if GROW else None)
    layouts.append(prev)
    SIZES.append(dict(sz))

EVI = {e[2]: k for k, e in enumerate(EV) if e[1] == "a"}   # word -> its arrival
FINAL = layouts[-1]

# ---- red is punctuation: spread it by ANGLE in the final layout ----
# Colouring from a fixed list clusters the accents wherever the spiral happened
# to drop those indices; taking every third small word around the centre makes
# the red read as an even rhythm around the cloud.
smalls = sorted([i for i in range(N) if WORDS[i][1] == "S"],
                key=lambda i: math.atan2(FINAL[i][1] - CYC, FINAL[i][0] - CX))
for j in range(0, len(smalls), 3):
    WORDS[smalls[j]][3] = RED


# =============================== DEPTH (v3) =================================
# A camera at z = -CAMD with zoom = CAMD renders the z = 0 plane 1:1, so a
# layer pushed to depth z can be made to look EXACTLY like the packed 2D layout
# by scaling it (z+CAMD)/CAMD and pushing its position out from the centre by
# the same factor. At rest v3 therefore matches v1 frame for frame - the depth
# only shows itself once the camera moves, as true parallax. Without that
# compensation the tiers would simply shrink and the packing would fall apart.
CAMD = 5200.0
ZTIER = {"H": -520, "B": -230, "M": 180, "S": 520}
# atmospheric perspective: the far tier sits back, so it also sits quieter
OPMAX = {"H": 100, "B": 100, "M": 94, "S": 86} if RICH else \
        {"H": 100, "B": 100, "M": 100, "S": 100}


def depth(i):
    if not IS3D:
        return 0.0, 1.0
    z = ZTIER[WORDS[i][1]]
    return z, (z + CAMD) / CAMD


def place(i, p, r=1.0):
    """Screen point for the ink centre -> the layer's Position value.

    Anchor is [0,0] (the text origin), so the ink centre sits at an offset from
    it; that offset is scaled by BOTH the depth compensation factor and (v4)
    the current size ratio r. Skipping the r term is the classic bug: the word
    would grow out of its top-left corner and slide off its own slot.
    """
    z, k = depth(i)
    b = BOX[i]
    ox = b["lf"] + b["wd"] / 2.0
    oy = b["tp"] + b["ht"] / 2.0
    return (round(CX + (p[0] - CX) * k - k * r * ox, 1),
            round(CY + (p[1] - CY) * k - k * r * oy, 1),
            round(z, 1))


def gather_from(i, p):
    """Where a word starts its entrance: a little further out along its own
    radius, so the cloud visibly draws itself together instead of blinking on."""
    if not RICH or i == 0:
        return p
    dx, dy = p[0] - CX, p[1] - CYC
    d = math.hypot(dx, dy)
    if d < 1.0:
        return p
    return (p[0] + dx / d * GATHER, p[1] + dy / d * GATHER)


def ripple_delay(i, k):
    """Frames a word waits before yielding to whoever caused event k.

    Everyone lurching on the same frame reads as a glitch; letting the
    displacement travel outward at a fixed speed reads as a crowd being parted.
    """
    if not RICH:
        return 0.0
    q = layouts[k][EV[k][2]]
    p = layouts[k - 1].get(i, layouts[k][i])
    return min(7.0, math.hypot(p[0] - q[0], p[1] - q[1]) / 230.0)


def grow_len(r0, r1):
    """A word doubling in size needs longer than one nudging up a rung."""
    return 12.0 if r1 / r0 < 1.5 else 16.0


# ---- position / opacity / scale keyframes ----
KEYS = [None] * N
OPA = [None] * N
SCL = [None] * N
SETTLE = {}        # event index -> frame the event's own word stops moving
STATES = [None] * N   # v4: raw [frame, (x, y), size ratio] per word, for checks
DIPS = [[] for _ in range(N)]   # v4: [start, length, floor] ghost windows
moved_total = 0
grown_total = 0


def build_grow_keys():
    """v4: one sampler drives position AND scale off the same (t, p, r) states.

    They cannot be authored separately. The layer's anchor is its text origin,
    so the ink centre sits at r * offset from the Position value: change the
    scale without re-deriving the position on the SAME keyframe times and the
    word slides sideways as it grows.
    """
    global moved_total, grown_total
    for i in range(N):
        k0 = EVI[i]
        fr = FRAME[i]
        z, kk = depth(i)
        sf = float(WORDS[i][2])
        omax = OPMAX[WORDS[i][1]]
        p = layouts[k0][i]
        r = SIZES[k0][i] / sf

        st = [[fr, gather_from(i, p), r * 0.93], [fr + ENTER_F, p, r]]
        ops = [[fr, 0], [fr + 5, omax]]
        cp, cr = p, r
        SETTLE[k0] = fr + ENTER_F

        for k in range(k0 + 1, len(EV)):
            nq = layouts[k][i]
            nr = SIZES[k][i] / sf
            d = math.hypot(nq[0] - cp[0], nq[1] - cp[1])
            mine = (EV[k][2] == i)
            if not mine and d < DAMP:
                continue
            if mine:                       # this word just won votes
                t0 = EV[k][0]
                dur = grow_len(cr, nr)
                grown_total += 1
            else:                          # ... and everyone else gives way
                # No beat before the ripple here, unlike v2/v3: a growing word
                # claims its neighbours' pixels as it swells, so they have to be
                # clearing while it grows, not four frames later. But that is
                # only true of the words it actually touches, so it is tempting
                # to let ripple_delay run at full strength and send the outer
                # ring a quarter-second later. Measured: that is WORSE. A longer
                # stagger keeps words in flight longer, and a word in flight is
                # a word that can be crossed - concurrent blanks went 7 -> 9.
                # Words shoved as one block travel in parallel and never meet.
                t0 = EV[k][0] + ripple_delay(i, k) * 0.4
                dur = min(move_len(d), 11.0)
                moved_total += 1
            # Events come every ~7 frames but a move takes 8-18, so a word can
            # be asked to leave before it has arrived. Queueing the move behind
            # the one in flight makes the word vacate its slot up to 16 frames
            # late - and the word that displaced it has already landed on top by
            # then. Cut the transition in flight short instead: re-routing
            # mid-travel is what a reflow does anyway.
            if t0 < st[-1][0] and len(st) > 1:
                st[-1][0] = max(t0, st[-2][0] + 4.0)
            t0 = max(t0, st[-1][0])
            if t0 - st[-1][0] > 0.5:
                st.append([t0, cp, cr])
            st.append([t0 + dur, nq, nr])
            if mine:
                SETTLE[k] = t0 + dur
            if not mine:
                # every move gets a window; a short shuffle keeps full opacity
                # unless the crossing sweep later asks for it to be blanked
                DIPS[i].append([t0, dur, 0.60 if d > 150 else 1.0])
            cp, cr = nq, nr

        STATES[i] = st
        KEYS[i] = [[round(s[0], 2)] + list(place(i, s[1], s[2])) for s in st]
        SCL[i] = [[round(s[0], 2), round(100.0 * s[2] * kk, 3)] for s in st]
        OPA[i] = ops


def at(i, f):
    """Ink rect of word i at frame f, read linearly off its state list."""
    st = STATES[i]
    if f <= st[0][0]:
        p, r = st[0][1], st[0][2]
    else:
        p, r = st[-1][1], st[-1][2]
        for a, b in zip(st, st[1:]):
            if f <= b[0]:
                u = (f - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 1.0
                p = (a[1][0] + (b[1][0] - a[1][0]) * u,
                     a[1][1] + (b[1][1] - a[1][1]) * u)
                r = a[2] + (b[2] - a[2]) * u
                break
    b = BOX[i]
    return (p[0] - b["wd"] * r / 2, p[0] + b["wd"] * r / 2,
            p[1] - b["ht"] * r / 2, p[1] + b["ht"] * r / 2)


def merge_dips():
    """Fold each word's overlapping blank windows into one, darkest floor wins.

    A word gets a window per move and the crossing sweep mints more, so they
    overlap. Left separate, one window's ramp back to full opacity lands inside
    the next window's blank and cancels it - the word flickers instead of going
    away, and the sweep's own view of what is hidden stops matching the curve.
    """
    for i in range(N):
        merged = []
        for t0, dur, floor in sorted(DIPS[i]):
            # A dip overlapping the word's own fade-in puts a "back to full"
            # key in the middle of it and the word strobes on-off-on inside
            # five frames. Hold every dip until the entrance has landed.
            dur -= max(0.0, FRAME[i] + 6.0 - t0)
            t0 = max(t0, FRAME[i] + 6.0)
            if dur < 3.0:
                continue
            if merged and t0 <= merged[-1][0] + merged[-1][1]:
                end = max(merged[-1][0] + merged[-1][1], t0 + dur)
                merged[-1][1] = end - merged[-1][0]
                merged[-1][2] = min(merged[-1][2], floor)
            else:
                merged.append([t0, dur, floor])
        DIPS[i] = merged


def hide_crossings():
    """Two words trading places pass straight through each other.

    The packed layout is clean at every event, but nothing constrains the
    straight line between two of them, and a swap puts one word's ink inside
    another's for up to half a second. Rather than fight the paths, find the
    crossings and take the moving word off screen while it travels: a word that
    dissolves and re-forms elsewhere is the language of a live poll anyway.
    """
    hidden = 0
    orphan = {}
    merge_dips()

    def gone(w, f):
        """True where a blank window already has this word off screen.

        A word that has been taken out cannot collide with anything, so it must
        drop out of the sweep too - otherwise pass two keeps re-reporting the
        crossing pass one already solved and starts blanking innocent
        bystanders. Matches the opacity ramp below, minus its shoulders.
        """
        for t0, dur, floor in DIPS[w]:
            ramp = min(2.5, dur * 0.45)
            if floor == 0 and t0 + ramp <= f <= t0 + dur - ramp:
                return True
        return False

    # F_LAST is the last ARRIVAL, but the vote ladder keeps reflowing the cloud
    # for another three seconds after the final word lands - sweeping to
    # F_LAST left the busiest stretch of the whole spot unexamined
    end = int(max(s[-1][0] for s in STATES)) + 6
    for f in range(int(FRAME[0]), end):
        # count a word from the moment it is legible, not from the end of its
        # entrance: an answer lands at full opacity 5 frames in, well before it
        # has finished scaling into place, and it can cross a reflowing
        # neighbour in between
        live = [(i, at(i, f)) for i in range(N)
                if f >= FRAME[i] + 4 and not gone(i, f)]
        for a in range(len(live)):
            for c in range(a + 1, len(live)):
                i, r1 = live[a]
                j, r2 = live[c]
                ox = min(r1[1], r2[1]) - max(r1[0], r2[0])
                oy = min(r1[3], r2[3]) - max(r1[2], r2[2])
                if ox <= 0 or oy <= 0:
                    continue
                small = min((r1[1] - r1[0]) * (r1[3] - r1[2]),
                            (r2[1] - r2[0]) * (r2[3] - r2[2]))
                if ox * oy < 0.15 * small:
                    continue
                # blank whichever of the two is mid-move; if both are, the
                # smaller one gives way, because losing the big word reads as
                # a dropout while losing a 63 pt one reads as a re-shuffle
                order = (i, j) if WORDS[i][2] <= WORDS[j][2] else (j, i)
                cand = [dp for w in order for dp in DIPS[w]
                        if dp[0] - 1 <= f <= dp[0] + dp[1] + 1 and dp[2] > 0]
                if cand:
                    cand[0][2] = 0.0
                    hidden += 1
                else:
                    # Neither word is reflowing, so there is no move to hide
                    # behind: this is a word SWELLING into a settled neighbour,
                    # or a new answer landing on one. Only ripple moves get a
                    # window above, so mint one here for the smaller word -
                    # a small word slipping behind a big one as it grows is
                    # what the eye expects of overlapping type anyway.
                    orphan.setdefault(order[0], []).append(f)

    for w, fs in sorted(orphan.items()):
        run = [fs[0], fs[0]]
        for f in fs[1:] + [10 ** 9]:
            if f - run[1] <= 2:
                run[1] = f
                continue
            DIPS[w].append([run[0] - 3.0, run[1] - run[0] + 6.0, 0.0])
            hidden += 1
            run = [f, f]
    return hidden


if GROW:
    build_grow_keys()
    # One pass is not a fixed point: blanking a word frees the slot it was
    # fighting over, which can expose a crossing that was masked behind it.
    # Sweep until nothing new turns up - it settles in two or three rounds.
    crossings_hidden = 0
    for _ in range(5):
        got = hide_crossings()
        crossings_hidden += got
        if not got:
            break
    merge_dips()
    for i in range(N):
        ops = OPA[i]
        omax = OPMAX[WORDS[i][1]]
        for t0, dur, floor in DIPS[i]:
            if floor >= 1.0:
                continue
            lo = round(omax * floor, 1)
            # A blank has to be OUT before the crossing starts and back only
            # once it clears, so the ramps are a fixed length, not a fraction
            # of the window: merging two windows lengthens dur, and a
            # proportional ramp would then bottom out well after the crossing
            # it was minted for. Fixed ramps also keep every dissolve the same
            # speed, which is what makes the reflow read as one gesture.
            ramp = min(2.5 if floor == 0 else dur * 0.45, dur * 0.45)
            ops.append([round(t0, 2), omax])
            ops.append([round(t0 + ramp, 2), lo])
            ops.append([round(t0 + dur - ramp, 2), lo])
            ops.append([round(t0 + dur, 2), omax])
        ops.sort(key=lambda o: o[0])
        OPA[i] = [[round(o[0], 2), o[1]] for o in ops]

for i in ([] if GROW else range(N)):
    k0 = ARRIVE.index(i)
    fr = FRAME[i]
    z, kk = depth(i)
    cur = layouts[k0][i]
    omax = OPMAX[WORDS[i][1]]

    if RICH:
        ks = [[round(fr, 2)] + list(place(i, gather_from(i, cur))),
              [round(fr + ENTER_F, 2)] + list(place(i, cur))]
    else:
        ks = [[round(fr, 2)] + list(place(i, cur))]
    ops = [[round(fr, 2), 0], [round(fr + 5, 2), omax]]
    s0 = 86 if i == 0 else 91
    sf = 11 if i == 0 else 7
    scl = [[round(fr, 2), round(s0 * kk, 3)],
           [round(fr + sf, 2), round(100 * kk, 3)]]

    for k in range(k0 + 1, N):
        nxt = layouts[k][i]
        d = math.hypot(nxt[0] - cur[0], nxt[1] - cur[1])
        if d < DAMP:
            continue
        t0 = FRAME[ARRIVE[k]] + ripple_delay(i, k)
        dur = move_len(d)
        if t0 - ks[-1][0] > 0.5:                       # hold, then glide
            ks.append([round(t0, 2), ks[-1][1], ks[-1][2], ks[-1][3]])
        ks.append([round(t0 + dur, 2)] + list(place(i, nxt)))
        # a word crossing other words at full strength turns into mush for
        # half a second; ghosting it down mid-flight keeps the frame readable
        # and makes the shuffle look intended
        if d > 150:
            ops.append([round(t0, 2), omax])
            # v2/v3 already sell the travel with motion blur, so the ghost only
            # has to take the edge off the crossing - dipping to 42% as well
            # turns the two effects into mush
            dip = 0.60 if RICH else 0.42
            ops.append([round(t0 + dur * 0.45, 2), round(omax * dip, 1)])
            ops.append([round(t0 + dur, 2), omax])
        cur = nxt
        moved_total += 1
    KEYS[i] = ks
    OPA[i] = ops
    SCL[i] = scl

# ---- answer marker + counter (v2/v3/v4) ----
# In v4 the marker pings on EVERY event, not just arrivals: a ping means "a
# vote just landed here", which is exactly what a climb is. And the counter
# counts votes rather than words - the number and the type size are then the
# same fact stated twice.
MARK, COUNT = [], []
votes = {}
mt = -1e9
for k, e in enumerate(EV):
    i = e[2]
    p = layouts[k][i]
    b = BOX[i]
    z, kk = depth(i)
    r = SIZES[k][i] / float(WORDS[i][2])
    # the marker is drawn at the word's DESTINATION, so it must not appear until
    # the word has actually arrived there - ping it on the event frame and the
    # hairline hangs in open space, or strikes through whoever still occupies it
    tm = SETTLE.get(k, e[0]) if GROW else e[0]
    tm = max(tm, mt + 1.0)
    mt = tm
    # the gap scales with the type: a fixed 34 px reads as an elegant underline
    # beneath the 370 pt hero but lands in the NEXT word's face under a 102 pt
    # one, because the packer only leaves a 32 px gutter between rows
    yb = p[1] + b["ht"] * r / 2.0 + max(12.0, e[3] * 0.09)
    MARK.append([round(tm, 2),
                 round(CX + (p[0] - CX) * kk, 1),
                 round(CY + (yb - CY) * kk, 1),
                 round(z, 1),
                 round(b["wd"] * r * kk / MARK_W * 100.0, 2)])
    votes[i] = VOTES[e[3]] if GROW else 1
    COUNT.append([round(e[0], 2), sum(votes.values())])
CNT_TOTAL = COUNT[-1][1]

buf = io.StringIO()
w = buf.write

w("""// GENERATED by _build/gen_cloud.py%s - do not edit by hand.
var STEP_ = "init";
try {
var TARGET = "%s";
var comp = null;
for (var ci = 1; ci <= app.project.numItems; ci++){
  var it0 = app.project.item(ci);
  if (it0 instanceof CompItem && it0.name === TARGET){ comp = it0; break; }
}
if (!comp) comp = app.project.items.addComp(TARGET, %d, %d, 1, %.4f, %.4f);
var FD = 1 / comp.frameRate;
function f(n){ return n * FD; }

app.beginUndoGroup("TAG CLOUD %s");

// idempotent rebuild
STEP_ = "clean";
for (var i = comp.numLayers; i >= 1; i--)
  if (comp.layer(i).comment === "CLOUD_FX") comp.layer(i).remove();

var made = [];
function keep(L){ L.comment = "CLOUD_FX"; made.push(L); return L; }
""" % ({1: "", 2: " --v2", 3: " --v3", 4: " --v4"}[VER], js(COMP_NAME),
       W, H, DUR_F / FPS, FPS, "v%d" % VER))

w("""
var W = %d, H = %d, CX = %d, CY = %d;
var END = %d;
var THREE = %s, RICH = %s, GROW = %s;
var FONT = "%s";
var WORDS = %s;
var KEYS = %s;
var OPA = %s;
var SCL = %s;
var INF = %s;
var F_LOGO = %d, F_Q_IN = %d, F_Q_FULL = %d;
""" % (W, H, CX, CY, DUR_F,
       "true" if IS3D else "false", "true" if RICH else "false",
       "true" if GROW else "false",
       FONT, jsonjs(WORDS), jsonjs(KEYS), jsonjs(OPA), jsonjs(SCL),
       jsonjs([round(FRAME[i], 2) for i in range(N)]),
       F_LOGO, F_Q_IN, F_Q_FULL))

w("""
// ---------- helpers ----------
// decisive ease-out: fast departure, soft arrival, NO overshoot (IBM-style)
function easeKey(p, k, inf0, inf1){
  var tries = [2, 1, 3];
  try { tries = [p.value.length || 1, 1, 2, 3]; } catch (e0) {}
  for (var a = 0; a < tries.length; a++){
    try {
      var n = tries[a], ea = [], eb = [];
      for (var q = 0; q < n; q++){
        ea.push(new KeyframeEase(0, inf0));
        eb.push(new KeyframeEase(0, inf1));
      }
      p.setTemporalEaseAtKey(k, eb, ea);
      return;
    } catch (e1) {}
  }
}
function reveal(p){ easeKey(p, 1, 16, 88); easeKey(p, 2, 16, 88); }
// every key is both a soft arrival and a brisk departure
function easeAll(p){
  for (var k = 1; k <= p.numKeys; k++) easeKey(p, k, 16, 88);
}
// straight travel: auto-bezier spatial tangents make words swoop and overshoot
function straighten(p){
  for (var k = 1; k <= p.numKeys; k++){
    try { p.setSpatialAutoBezierAtKey(k, false); } catch (e0) {}
    try { p.setSpatialTangentsAtKey(k, [0,0,0], [0,0,0]); } catch (e1) {}
  }
}
function holdAll(p){
  for (var k = 1; k <= p.numKeys; k++){
    try { p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD,
                                         KeyframeInterpolationType.HOLD); } catch (e0) {}
  }
}
function P(v){ return THREE ? [v[0], v[1], v[2]] : [v[0], v[1]]; }
function S(s){ return THREE ? [s, s, 100] : [s, s]; }
// the marker only ever stretches horizontally, so Y stays pinned at 100
function MS(x){ return THREE ? [x, 100, 100] : [x, 100]; }

function txt(name, str, size, col){
  var L = comp.layers.addText(str);
  L.name = name;
  var d = L.property("Source Text").value;
  d.font = FONT;
  d.fontSize = size;
  d.fillColor = col;
  d.applyFill = true;
  d.applyStroke = false;
  d.tracking = 0;
  L.property("Source Text").setValue(d);
  return keep(L);
}
""")

w("""
// ---------- ground: brand navy with a radial lift behind the cloud ----------
STEP_ = "ground";
var bg = keep(comp.layers.addSolid([%.5f,%.5f,%.5f], "CLOUD BG", W, H, 1));
var ramp = bg.property("Effects").addProperty("ADBE Ramp");
ramp.property("Ramp Shape").setValue(2);                 // radial
ramp.property("Start of Ramp").setValue([CX, CY - 40]);
ramp.property("End of Ramp").setValue([CX, H * 1.16]);
ramp.property("Start Color").setValue([%.5f,%.5f,%.5f,1]);
ramp.property("End Color").setValue([%.5f,%.5f,%.5f,1]);
""" % tuple(NAVY + NAVY2 + NAVY))

if not IS3D:
    w("""
// ---------- push null: one slow, deliberate move on the whole cloud ----------
// Anchor == Position == comp centre, so a child's own coordinates ARE comp
// coordinates while the null sits at 100% - the packed values can be written
// straight in. Children are parented BEFORE any key is set, otherwise AE
// rewrites the values to preserve the world transform.
STEP_ = "null";
var nul = keep(comp.layers.addNull(comp.duration));
nul.name = "CLOUD RIG";
nul.property("Transform").property("Anchor Point").setValue([CX, CY]);
nul.property("Transform").property("Position").setValue([CX, CY]);
var ns = nul.property("Transform").property("Scale");
ns.setValueAtTime(0, [99, 99]);
ns.setValueAtTime(f(END), [104, 104]);
nul.enabled = false;
""")
else:
    w("""
// in 3D the camera does the push, so there is no rig null to parent to
var nul = null;
""")

w("""
// ---------- the words: create, parent, then animate the reflow ----------
STEP_ = "words";
var lays = [];
for (var i = 0; i < WORDS.length; i++){
  var L = txt("W " + i + " " + WORDS[i][0], WORDS[i][0], WORDS[i][2], WORDS[i][3]);
  if (THREE){
    L.threeDLayer = true;
    L.property("Transform").property("Anchor Point").setValue([0, 0, 0]);
  } else {
    L.property("Transform").property("Anchor Point").setValue([0, 0]);
    L.parent = nul;
  }
  // the hero title never gets blur: at 370 pt the smear doubles the glyphs
  // and deforms the brand word on entrance
  if (RICH && i !== 0) L.motionBlur = true;
  lays.push(L);
}

STEP_ = "reflow";
var nkeys = 0;
for (var i2 = 0; i2 < lays.length; i2++){
  var pp = lays[i2].property("Transform").property("Position");
  var ks = KEYS[i2];
  if (ks.length === 1){
    pp.setValue(P([ks[0][1], ks[0][2], ks[0][3]]));
  } else {
    for (var j = 0; j < ks.length; j++)
      pp.setValueAtTime(f(ks[j][0]), P([ks[j][1], ks[j][2], ks[j][3]]));
    easeAll(pp);
    straighten(pp);
    nkeys += ks.length;
  }
}

STEP_ = "anim";
for (var i3 = 0; i3 < lays.length; i3++){
  var L3 = lays[i3];
  var op = L3.property("Transform").property("Opacity");
  var oks = OPA[i3];
  for (var j2 = 0; j2 < oks.length; j2++)
    op.setValueAtTime(f(oks[j2][0]), oks[j2][1]);
  easeAll(op);
  var sc = L3.property("Transform").property("Scale");
  var sks = SCL[i3];
  for (var j3 = 0; j3 < sks.length; j3++)
    sc.setValueAtTime(f(sks[j3][0]), S(sks[j3][1]));
  // v4 keeps re-sizing all through the spot, so every scale key needs the
  // ease - not just the two of the entrance
  if (GROW) easeAll(sc); else reveal(sc);
  L3.inPoint = f(INF[i3]);
}
""")

if RICH:
    w("""
// ---------- answer marker: one hairline that pings under each new answer ----
// Position keys are HOLD - interpolated ones would send the bar sliding across
// the frame between answers instead of teleporting under the newest word.
STEP_ = "marker";
var MARK = %s;
var mk = keep(comp.layers.addSolid([%.5f,%.5f,%.5f], "CLOUD MARKER", %d, 4, 1));
if (THREE) mk.threeDLayer = true;
// no blur on the marker: it HOLD-teleports between words, so the shutter
// smears the jump into a white streak across the frame
var mp = mk.property("Transform").property("Position");
var ms = mk.property("Transform").property("Scale");
for (var m2 = 0; m2 < MARK.length; m2++){
  var mm = MARK[m2];
  mp.setValueAtTime(f(mm[0]), P([mm[1], mm[2], mm[3]]));
  ms.setValueAtTime(f(mm[0]),       MS(0));
  ms.setValueAtTime(f(mm[0] + 3),   MS(mm[4]));
  ms.setValueAtTime(f(mm[0] + 7),   MS(0));
}
holdAll(mp);
easeAll(ms);
mk.inPoint = f(MARK[0][0]);
mk.outPoint = f(MARK[MARK.length - 1][0] + 8);
""" % (jsonjs(MARK), BLUE_L[0], BLUE_L[1], BLUE_L[2], MARK_W))

    w("""
// ---------- live counter, bottom left ----------
STEP_ = "counter";
var COUNT = %s;
var cn = txt("CLOUD COUNTER", "%s  %s", %d, [%.5f,%.5f,%.5f]);
var cr = cn.sourceRectAtTime(0, false);
cn.property("Transform").property("Anchor Point").setValue([0, 0]);
cn.property("Transform").property("Position").setValue([150 - cr.left,
                                                        H - 132 - cr.top - cr.height / 2]);
var st = cn.property("Source Text");
for (var c2 = 0; c2 < COUNT.length; c2++){
  var cd = st.value;
  var nn = COUNT[c2][1];
  cd.text = "%s  " + (GROW ? nn : (nn < 10 ? "0" + nn : nn) + " / 41");
  st.setValueAtTime(f(COUNT[c2][0]), cd);
}
var co = cn.property("Transform").property("Opacity");
co.setValueAtTime(f(COUNT[0][0]), 0);
co.setValueAtTime(f(COUNT[0][0] + 8), 72); reveal(co);
cn.inPoint = f(COUNT[0][0]);
""" % (jsonjs(COUNT), js(CNT_LABEL), str(CNT_TOTAL) if GROW else "41 / 41",
       CNT_SIZE, BLUE_L[0], BLUE_L[1], BLUE_L[2], js(CNT_LABEL)))

if IS3D:
    w("""
// ---------- camera: the slow move that replaces v1's flat scale-up ----------
// Must be created AFTER the 3D words: a camera only affects 3D layers BELOW it
// in the stack, and every addText() call inserts at the top.
STEP_ = "camera";
var CAMD = %.1f;
var cam = keep(comp.layers.addCamera("CLOUD CAM", [CX, CY]));
var copt = cam.property("ADBE Camera Options Group");
copt.property("ADBE Camera Zoom").setValue(CAMD);
try { copt.property("ADBE Camera Depth of Field").setValue(0); } catch (eD) {}
cam.property("Transform").property("Point of Interest").setValue([CX, CY, 0]);
var cp = cam.property("Transform").property("Position");
cp.setValueAtTime(0,      [CX - 95, CY + 50, -(CAMD + 300)]);
cp.setValueAtTime(f(END), [CX + 75, CY - 40, -(CAMD - 110)]);
easeAll(cp);
straighten(cp);
""" % CAMD)

w("""
// ---------- the question, held for the whole spot ----------
STEP_ = "question";
var q = txt("CLOUD QUESTION", "%s", %d, [1,1,1]);
var qd = q.property("Source Text").value;
qd.justification = ParagraphJustification.CENTER_JUSTIFY;
q.property("Source Text").setValue(qd);
var qr = q.sourceRectAtTime(0, false);
q.property("Transform").property("Anchor Point").setValue([0, 0]);
q.property("Transform").property("Position").setValue([CX, 178 - qr.top - qr.height / 2]);
var qo = q.property("Transform").property("Opacity");
qo.setValueAtTime(f(F_Q_IN), 0);
qo.setValueAtTime(f(F_Q_FULL), 100); reveal(qo);

// a hairline rule under the question ties it to the brand blue.
// NB: build the solid at final size and scale X 0 -> 100. A 1x1 solid scaled
// by a percentage gives a 1-px tick, not a rule.
var rule = keep(comp.layers.addSolid([%.5f,%.5f,%.5f], "CLOUD RULE", 560, 3, 1));
rule.property("Transform").property("Position").setValue([CX, 258]);
var rs = rule.property("Transform").property("Scale");
rs.setValueAtTime(f(F_Q_IN + 4), [0, 100]);
rs.setValueAtTime(f(F_Q_FULL + 8), [100, 100]); reveal(rs);
rule.inPoint = f(F_Q_IN + 4);
""" % (js(QUESTION), QSIZE, BLUE[0], BLUE[1], BLUE[2]))

if IS3D:
    w("""
// ---------- light sweep across the finished cloud ----------
// A plain solid blurred hard IS the soft gradient bar - no mask feathering
// needed, and it stays cheap at 4K.
STEP_ = "sweep";
var sw = keep(comp.layers.addSolid([1,1,1], "CLOUD SWEEP", 520, Math.round(H * 1.9), 1));
var sb = sw.property("Effects").addProperty("ADBE Gaussian Blur 2");
sb.property("Blurriness").setValue(260);
try { sb.property("Repeat Edge Pixels").setValue(false); } catch (eB) {}
sw.blendingMode = BlendingMode.ADD;
sw.property("Transform").property("Rotation").setValue(14);
sw.property("Transform").property("Opacity").setValue(9);
var sp = sw.property("Transform").property("Position");
sp.setValueAtTime(f(%d),      [-700, CY]);
sp.setValueAtTime(f(%d + 58), [W + 700, CY]);
sw.inPoint = f(%d);
sw.outPoint = f(%d + 60);
""" % (F_SWEEP, F_SWEEP, F_SWEEP, F_SWEEP))

w("""
// ---------- logo sign-off ----------
STEP_ = "logo";
var logoNote = "skipped";
try {
  var lf = new File("%s");
  if (lf.exists){
    var io2 = new ImportOptions(lf);
    var it = app.project.importFile(io2);
    var lg = keep(comp.layers.add(it));
    lg.name = "CLOUD LOGO";
    var lw = it.width, lh = it.height;
    var target = 620;
    var k2 = target / lw * 100;
    lg.property("Transform").property("Scale").setValue([k2, k2]);
    lg.property("Transform").property("Position").setValue([W - 120 - target / 2,
                                                            H - 118 - lh * k2 / 200]);
    var lo = lg.property("Transform").property("Opacity");
    lo.setValueAtTime(f(F_LOGO), 0);
    lo.setValueAtTime(f(F_LOGO + 12), 100); reveal(lo);
    lg.inPoint = f(F_LOGO);
    logoNote = "ok " + lw + "x" + lh;
  } else { logoNote = "missing"; }
} catch (eL) { logoNote = "ERR " + eL.toString(); }
""" % js(LOGO))

w("""
STEP_ = "window";
for (var m = 0; m < made.length; m++)
  if (made[m].outPoint > f(END)) made[m].outPoint = f(END);
comp.motionBlur = RICH;
if (RICH) comp.shutterAngle = 90;

app.endUndoGroup();
STEP_ = "done";
JSON.stringify({ step: STEP_, comp: comp.name, made: made.length,
                 words: WORDS.length, posKeys: nkeys, logo: logoNote,
                 total: comp.numLayers });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
""")

out = os.path.join(HERE, OUTNAME)
with open(out, "w", encoding="ascii") as fh:
    fh.write(buf.getvalue())

kmax = max(len(k) for k in KEYS)
nk = sum(len(k) for k in KEYS)
print("v%d -> %s  (%s)  chars: %d" % (VER, OUTNAME, COMP_NAME, len(buf.getvalue())))
print("words: %d   events: %d   relocations: %d   climbs: %d"
      % (N, len(EV), moved_total, grown_total))
print("pos keys: %d   max on one word: %d   packer bails: %d"
      % (nk, kmax, BAILS[0]))
if GROW:
    print("last size change: f%.0f (%.1f s)   votes: %d   crossings hidden: %d"
          % (EV[-1][0], EV[-1][0] / FPS, CNT_TOTAL, crossings_hidden))
x0 = min(FINAL[i][0] - BOX[i]["wd"] / 2.0 for i in range(N))
x1 = max(FINAL[i][0] + BOX[i]["wd"] / 2.0 for i in range(N))
y0 = min(FINAL[i][1] - BOX[i]["ht"] / 2.0 for i in range(N))
y1 = max(FINAL[i][1] + BOX[i]["ht"] / 2.0 for i in range(N))
print("final bbox gaps  L%d R%d T%d B%d" % (x0, W - x1, y0 - TOPKEEP, H - BOTKEEP - y1))
