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
for a in ("--v2", "--v3", "--v4", "--v5", "--v6"):
    if a in sys.argv:
        VER = int(a[-1])
COMP_NAME = {1: "Comp 1", 2: "Comp 2", 3: "Comp 3",
             4: "Comp 4", 5: "Comp 5", 6: "Comp 6"}[VER]
OUTNAME = {1: "cloud.jsx", 2: "cloud_v2.jsx", 3: "cloud_v3.jsx",
           4: "cloud_v4.jsx", 5: "cloud_v5.jsx", 6: "cloud_v6.jsx"}[VER]
IS3D = (VER >= 3)
RICH = (VER >= 2)          # gather-in, ripple, marker, counter, motion blur
GROW = (VER >= 4)          # words climb the type scale as votes arrive
# v5 is the calm cut: same cloud, same ladder, but the hero is on screen from
# early on and the crowd is allowed to ignore small displacements. v4 asks every
# word to hold a mathematically perfect slot after every one of 72 events, and
# the price is 221 separate flights - each individually short, collectively
# fidgety. v5 trades a few pixels of packing rigour for stillness.
CALM = (VER in (5, 6))

# v6 is v5 plus a closing act: 10 more seconds in which the cloud migrates into
# the silhouette of the letter "Ya". The target layout is NOT computed here -
# it is read from ya_layout.json, which form_ya.py wrote and the client signed
# off. The pack is a greedy search over a numpy grid, so re-deriving it at build
# time would let a one-line change silently reshuffle an approved frame.
FORM = (VER == 6)

FPS = 25.0
W, H = 4096, 2160
CX, CY = W // 2, H // 2
DUR_F = 1125 if FORM else 750    # 45 s: 40 s to the letter, then the sign-off

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
# The reveal runs SMALLEST answer to largest, and KOLLEKTIV arrives last of all.
# Leading with the hero states the conclusion in the first second and leaves the
# remaining 29 with nothing to find out; starting at the rim with the one-off
# answers keeps the question open, and the cloud reads as a result being counted
# rather than a title with decoration.
F_Q_IN    = 6      # question starts
F_Q_FULL  = 26
F_FIRST   = 34     # first (smallest) answer
F_LAST    = 420 if GROW else 630   # last SUPPORTING answer
F_HERO    = 500    # KOLLEKTIV finally lands - and then grows on screen
if CALM:
    # v5: the hero is on screen from a third of the way in, hiding in the crowd
    # rather than announcing itself, so the audience cannot tell which of the
    # big words wins until one of them starts growing at the end. Making that
    # true takes more than moving F_HERO - see START_SZ / F_HERO_UP below.
    #
    # This is also the main calming move, not just a dramaturgical one. In v4
    # the 370 pt hero drops into a full frame at f500 and every word in the
    # middle third has to flee. Seating it early means the crowd packs AROUND
    # the centre from the start and that mass displacement never happens.
    F_LAST = 470
    F_HERO = 250
F_LOGO    = 0      # the logo holds from the first frame
# v3 light sweep crosses just before the sign-off. In v6 the held cloud is no
# longer the sign-off - it is the halfway point - so a sweep at f636 spends
# itself on a frame the viewer is about to leave. It moves onto the finished
# letter instead, which also solves the tail: everything else is done by f900
# and the last 4 s would otherwise be a dead frame.
F_SWEEP   = 912 if FORM else 636
SPAN = F_LAST - F_FIRST

# ---- v6: the closing act ----
# The cloud is still reflowing at f690 - measured, not assumed (endstate.py
# walks every word's state list and reports the last frame anything moves). A
# closing beat scheduled before that would collide with the tail of the vote,
# so the migration waits for real stillness first.
F_SETTLE = 690           # last cloud activity
F_FORM0  = 720           # first word departs - 1.2 s of held frame before it
F_SPREAD = 70            # stagger window: heroes leave first, fill last
F_FLIGHT = 110           # one word's travel, 4.4 s. Long on purpose: the brief
                         # is "плавно", and a slow drift of 100 words reads as
                         # one motion, where a fast one reads as 100 events.
F_FORM1 = F_FORM0 + F_SPREAD + F_FLIGHT      # f900, everything has landed
F_REP0, F_REP1 = 800, 900   # the repeat instances fade up under the arrivals
F_QOUT = 715             # question and rule clear before the figure needs the
                         # top of the frame

# ---- v6: from the letter of words to the mark ----
# The figure is NOT congruent with the logo's glyph, which was the whole question
# here. form_ya's win() clips its test window to the grid and then computes `need`
# from the CLIPPED indices, so a box hanging off the letterform is only tested on
# the part still on the grid and passes: 32 of the 112 boxes are not fully on the
# glyph, the worst 68% off, and some of those sit across the letter's internal
# counters. No uniform scale of the glyph contains them - scaling the letter
# scales its holes too - so a true match cut is not available at any size.
# mark_probe.py has the measurement.
#
# What rescues it is the artwork. The mark is a blue ring and disc with the Я
# KNOCKED OUT to transparency, not printed in a second colour. So the disc is its
# own mask: fade it up over the compacted figure and every word that overhangs
# the letterform is covered by opaque blue, while the words inside show through
# the hole. The 32 bad boxes stop being a defect and become the thing that is
# hidden. The beat is therefore: the figure compacts onto where the letter will
# be, the ring closes around it in the same gesture, and the last of the words
# dissolves away inside the counter, leaving the mark.
#
# Nothing here is legible by design. At the collapse scale the 370 pt hero is
# about 28 pt in a 4096 frame, so no word can be caught half-under the disc edge
# and read as a clipping error - which is what licenses the overlap below.
# The overlap below is the whole trick and it was arrived at on the render. The
# first pass ran the collapse alone, then brought the mark in afterwards, and
# f1025 came back as a small clump of type in an otherwise empty navy field -
# the corner lockup had already gone and the centre mark had not arrived, so
# there was a second of the spot with nothing in it. The two gestures have to
# run TOGETHER: the mark starts resolving while the figure is still twice the
# size of the counter, and they finish on the same frame.
F_COLL0, F_COLL1 = 975, 1055     # the figure compacts onto the mark's letterform
F_MARK0, F_MARK1 = 1008, 1062    # the ring resolves around it as it comes down
F_REPF0, F_REPF1 = 1022, 1052    # fill releases, biggest away first
F_BASF0, F_BASF1 = 1036, 1066    # then the answers, KOLLEKTIV last of all
F_FADE_LEN = 20                  # one word's dissolve
F_LOGOUT = 982                   # the corner lockup hands over to the centre
# 1150 px is 53% of frame height. 860 was tried first and read as timid: the end
# card is the only frame in 45 s with a single object in it, and at 40% the mark
# left a ring of empty navy wider than itself. It also sets the collapse - the
# counter is 47% of the artwork, so a bigger mark is a shorter fall for the type.
MARK_D = 1150.0

# v4: the voting window. The brief is explicit - sizes must still be changing
# up to 0:25 (f625) - and now it is the hero that carries that last change.
F_VOTE0, F_VOTE1 = 118, 470
F_HERO_UP = [548, 598]      # KOLLEKTIV grows 168 -> 240 -> 370 in full view
if CALM:
    # Moving the hero's arrival forward silently broke its camouflage. 168 pt
    # hides it at f500, where a dozen answers have already climbed to 168 - but
    # at f250 the largest word on screen is 63 pt, so the hero lands 2.7x taller
    # than anything else and the result is announced ten seconds early. Rendered
    # f275 shows it plainly: KOLLEKTIV alone at the top of the scale, no peer.
    #
    # So the hero enters a rung lower and takes an extra step, tracking the
    # crowd's own climb instead of standing still above it:
    #   f250  102 pt, crowd 63     - one of the big answers, no more
    #   f490  168 pt, crowd ~150   - still no daylight between them
    #   f548  240 pt               - and now it breaks away
    #   f598  370 pt
    # The last two beats are untouched: the growth at the end plays exactly as
    # it did before, which is what was asked for.
    #
    # The new rung has to sit AFTER F_LAST. Tried at f400 first, and it cost
    # two of the calmest words in the cut: HERO_GUARD holds regular CLIMBS off a
    # hero beat but says nothing about ARRIVALS, so a hero surge inside the
    # arrival window ripples straight through words that landed seconds earlier.
    # TEKHNOLOGII and BEZOPASNOST both went ~700 px at 50 px/f within a second
    # of appearing - precisely the defect this version exists to remove. Every
    # v4 hero beat happened to fall after the last arrival, which is why the
    # rule was never needed before and never written down.
    F_HERO_UP = [490, 548, 598]
# The hero's arrival displaces more of the frame than any other event, so the
# regular climbs must keep clear of the landing as well as of the two surges.
HERO_BEATS = [F_HERO] + F_HERO_UP
HERO_GUARD = 18             # frames a regular climb must keep clear of a beat

DAMP = 9.0 if GROW else 6.0  # px: below this a word stays put (no micro-twitch)
if CALM:
    # The single biggest lever on fidget. At 9 px a word chases every rounding
    # the packer hands it; at 24 it only moves when it is genuinely in someone's
    # way. 24 is not arbitrary - PADX is 26, so a word that stays put through a
    # sub-DAMP displacement still keeps positive horizontal padding and cannot
    # touch its neighbour's ink. The y axis has only PADY = 16 to give, which is
    # why the deadband below is applied per-axis rather than to the distance.
    DAMP = 24.0
ENTER_F = 9        # gather-in travel (v2/v3)
GATHER = 130.0     # px a word travels inward as it arrives (v2/v3)

# v4 type ladder: a word enters one rung below where it will finish (the hero
# two), so the final frame still matches the designed type scale exactly
START_SZ = {"H": 168, "B": 63, "M": 63, "S": 63}
LADDER = {"H": [240, 370], "B": [102, 168], "M": [102], "S": []}
if CALM:
    # one rung lower in, one extra rung on the way up - see F_HERO_UP above.
    # The rungs are zipped against F_HERO_UP by index, so the two lists have to
    # stay the same length.
    START_SZ = dict(START_SZ, H=102)
    LADDER = dict(LADDER, H=[168, 240, 370])
# votes implied by each rung - drives the counter so the number on screen and
# the size on screen are the same fact
VOTES = {63: 3, 102: 14, 168: 31, 240: 58, 370: 96}


def stay_put(dx, dy, d):
    """True when a displacement is small enough that the word should ignore it.

    v4 tests the straight-line distance against a single threshold. That is the
    wrong shape for this layout: the padding is anisotropic (PADX 26, PADY 16),
    so a 22 px sideways nudge is free while a 22 px vertical one eats the whole
    gap. Testing the axes separately lets the deadband be as wide as the
    horizontal slack really is without ever spending vertical slack it does not
    have - which is where a distance test would have quietly created overlaps.
    """
    if not CALM:
        return d < DAMP
    return abs(dx) < DAMP and abs(dy) < DAMP * (PADY / float(PADX))


def move_len(d):
    """Travel time in frames. A word shoved 800 px and one nudged 40 px must
    not take the same time, or the long move whips and the short one crawls.

    Peak speed is set by the SLOPE, not the ceiling - d/85 means a long move
    approaches 85 px/frame however high the ceiling is raised. Reading the
    ceiling as the speed limit is what let a 2084 px eviction run at 98 px/f
    with the cap at 28: move_len returned 31 frames, so the cap never applied.
    CALM therefore halves the slope as well, to d/50, and raises the ceiling
    far enough that the slope is what actually binds - about 45 px/frame, which
    is where a move stops reading as a throw. v4 cannot afford either change:
    it re-packs so often that a 46-frame move would still be in flight when the
    slot is next needed.
    """
    if CALM:
        return max(8.0, min(46.0, 7.0 + d / 50.0))
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
    out = []
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
    return out + [0]


def arrival_order_rank():
    """v4: the rarest answers show up first and the winner arrives last.

    WORDS is built biggest-first, so walking it backwards gives smallest-first:
    the one-off answers scatter onto the rim, the mid tier fills in, the big
    answers push into the middle, and only then does KOLLEKTIV land. Reversing
    this was a dramaturgy fix, not a technical one - the previous order put the
    370 pt answer on screen at 1.4 s, which told the audience the result before
    the question had finished appearing.

    Shuffling inside windows of six keeps it from reading as a sorted list while
    preserving the overall small-to-large sweep.
    """
    rest = list(range(N - 1, 0, -1))
    seed = 20260814
    for a in range(0, len(rest), 6):
        win = rest[a:a + 6]
        for b in range(len(win) - 1, 0, -1):
            seed = (seed * 1103515245 + 12345) % (1 << 31)
            c = seed % (b + 1)
            win[b], win[c] = win[c], win[b]
        rest[a:a + 6] = win
    return rest + [0]


ARRIVE = arrival_order_rank() if GROW else arrival_order()

# arrival frames: a constant interval reads as a metronome, the mild power
# curve makes the cloud start deliberately and gather pace as it fills.
# ARRIVE ends with the hero, which is scheduled by hand - it has to sit clear of
# the last supporting answer so its landing reads as a separate beat.
FRAME = {0: float(F_HERO)}
for k in range(N - 1):
    u = k / float(N - 2)
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
        for h in HERO_BEATS:
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


def place_flat(i, p, r=1.0):
    """place() with the depth compensation removed - the word lies on z = 0.

    The closing figure is packed to a 10 px tolerance, and depth would eat it.
    Over the migration the camera travels 410 units in z plus ~95 px laterally;
    across the z span of -520..+520 that is ~17 px of differential drift between
    the near and far tiers. Every word is therefore flown home to z = 0 while
    the camera returns square-on, so the letter is rendered exactly as packed
    rather than as packed-plus-parallax. It is the right picture as well as the
    right geometry: a sign-off card should read flat and graphic.
    """
    b = BOX[i]
    return (round(p[0] - r * (b["lf"] + b["wd"] / 2.0), 1),
            round(p[1] - r * (b["tp"] + b["ht"] / 2.0), 1),
            0.0)


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

        for k in range(k0 + 1, len(EV)):
            nq = layouts[k][i]
            nr = SIZES[k][i] / sf
            d = math.hypot(nq[0] - cp[0], nq[1] - cp[1])
            mine = (EV[k][2] == i)
            if not mine and stay_put(nq[0] - cp[0], nq[1] - cp[1], d):
                continue
            if mine:                       # this word just won votes
                t0 = EV[k][0]
                dur = grow_len(cr, nr)
                if CALM:
                    # A word that wins votes usually also gets re-seated, and
                    # both ride this one duration - so the travel is timed by
                    # how long the SCALE needs and move_len never gets a say.
                    # That is the last uncapped path in the cut: DRUZYA was
                    # thrown 2015 px in the 21 frames its 63->102 step wanted,
                    # 95 px/f, more than twice anything else in the spot. Give
                    # the pair whichever duration is slower.
                    dur = max(dur, move_len(d))
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
                # v4 caps every yield at 11 frames so words clear their slot
                # before the next event needs it. At 800 px that is 0.44 s, and
                # the eye reads it as a word being flung. v5 buys the time back
                # by moving far less often, so a displacement can take the full
                # time move_len wanted to give it and read as drift instead.
                dur = min(move_len(d), 48.0 if CALM else 11.0)
                moved_total += 1
            # Events come every ~7 frames but a move takes 8-18, so a word can
            # be asked to leave before it has arrived. Queueing the move behind
            # the one in flight makes the word vacate its slot up to 16 frames
            # late - and the word that displaced it has already landed on top by
            # then. Cut the transition in flight short instead: re-routing
            # mid-travel is what a reflow does anyway.
            if t0 < st[-1][0] and len(st) > 1:
                if CALM:
                    # THE source of the flung-word effect, and it is here rather
                    # than in any duration constant. v4 cuts the in-flight move
                    # short in TIME only: it drags the arrival key back to t0 but
                    # leaves the arrival POSITION alone, so a move authored as 18
                    # frames of travel is made to cover the same distance in as
                    # few as 4. That is a 4.5x speed-up applied at random, and it
                    # is what produces the 914 px / 7 frame and 370 px / 4 frame
                    # moves the speed audit found - both far beyond anything
                    # move_len can return, which is how they were traced back
                    # here.
                    #
                    # Cut it in SPACE as well: re-route from wherever the word
                    # had actually got to by t0. Same velocity throughout, no
                    # compression, and the reflow still happens on time.
                    a0, a1 = st[-2], st[-1]
                    u = (t0 - a0[0]) / max(a1[0] - a0[0], 1e-6)
                    u = min(max(u, 0.0), 1.0)
                    a1[0] = t0
                    a1[1] = (a0[1][0] + (a1[1][0] - a0[1][0]) * u,
                             a0[1][1] + (a1[1][1] - a0[1][1]) * u)
                    a1[2] = a0[2] + (a1[2] - a0[2]) * u
                    # the word is no longer where the last event thought it was,
                    # so the distance - and therefore the travel time - changes
                    cp, cr = a1[1], a1[2]
                    d = math.hypot(nq[0] - cp[0], nq[1] - cp[1])
                    if mine:
                        dur = max(grow_len(cr, nr), move_len(d))
                    else:
                        dur = min(move_len(d), 48.0)
                else:
                    st[-1][0] = max(t0, st[-2][0] + 4.0)
            t0 = max(t0, st[-1][0])
            if t0 - st[-1][0] > 0.5:
                st.append([t0, cp, cr])
            st.append([t0 + dur, nq, nr])
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
    # Start at the FIRST arrival, whichever word that is. This used to read
    # FRAME[0] because index 0 - the hero - opened the spot; now that it closes
    # it, FRAME[0] is f500 and that spelling silently skipped the first twenty
    # seconds, which is where every crossing lives.
    for f in range(int(min(FRAME.values())), end):
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
                # ...but never pick a word that has only just arrived. merge_dips
                # holds every dip until FRAME+6 so a fresh word cannot strobe on-
                # off-on, which means a dip minted for it here is clamped to start
                # exactly at the crossing and hides nothing. Hand the blank to the
                # counterpart instead: it has been on screen long enough to
                # dissolve without the drop reading as a glitch.
                if f < FRAME[order[0]] + 12 and f >= FRAME[order[1]] + 12:
                    order = (order[1], order[0])
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


# ========================= v6: THE CLOSING ACT ==============================
# The cloud migrates into the silhouette of the letter "Ya". The figure itself
# is NOT computed here - form_ya.py packed it, the client signed it off, and it
# is frozen in ya_layout.json. Re-deriving it at build time would let an
# unrelated edit reshuffle an approved frame without anyone noticing.
#
# 41 words cannot fill a letterform, so the pack repeats them: the first slot
# for each word is flown there by the word's own layer, and the remaining 71
# are new layers that fade up underneath the arrivals. That is exactly what the
# client's own reference does, and it is why the type sizes range 19-150 pt.
REPS = []
BASE = {}
FORM_DX = FORM_DY = 0.0


def rep_colour(pt):
    """Colour for a REPEAT instance - by size, not by the word's cloud colour.

    Two things break if repeats simply inherit: red stops being an accent, and
    the silhouette stops reading.

    Red was tuned to be sparse across 41 words. Repeat a red word five times and
    the frame gets ten scattered red marks, which is a rash rather than an
    accent - and the eye chases them instead of tracing the letterform. Base
    words keep their own colour, so red survives at exactly the density it was
    designed for.

    Sizing the colour instead gives the figure tonal recession: the fill sinks
    toward the ground and lets the big type carry the shape. That is also what
    the client's reference does, and what the preview the layout was approved
    from looked like.

    The ramp stops one rung BELOW white deliberately. White at the top rung was
    tried and rejected on the render: the packer's 78 pt fill happens to land
    mostly in the right-hand stem, so a white top rung lit that stem and left
    the bowl mumbling - the letter went lopsided in tone even though it was
    correct in geometry. Keeping white for the 41 answer words is also the
    honest reading: white means "this is a word someone voted for".
    """
    return BLUE_L if pt >= 70 else BLUE if pt >= 42 else BLUE_D


if FORM:
    with open(os.path.join(HERE, "ya_layout.json"), encoding="utf-8") as fh:
        _lay = json.load(fh)

    # The pack was solved in the MASK's frame, and the mask is the logo's Ya -
    # a glyph with a leg, so its ink is not centred on its own bounding disc.
    # Dropped in as packed it lands ~200 px right of comp centre, which reads as
    # a mistake and leaves the rightmost words 14 px off the logo lockup. A
    # rigid translation is the safe correction: every gap the pack was checked
    # against is preserved exactly, which re-solving it would not be.
    _bx = [(s["x"] - BOX[s["i"]]["wd"] * s["pt"] / float(WORDS[s["i"]][2]) / 2.0,
            s["x"] + BOX[s["i"]]["wd"] * s["pt"] / float(WORDS[s["i"]][2]) / 2.0,
            s["y"] - BOX[s["i"]]["ht"] * s["pt"] / float(WORDS[s["i"]][2]) / 2.0,
            s["y"] + BOX[s["i"]]["ht"] * s["pt"] / float(WORDS[s["i"]][2]) / 2.0)
           for s in _lay["slots"]]
    FORM_DX = round(CX - (min(b[0] for b in _bx) + max(b[1] for b in _bx)) / 2.0, 1)
    FORM_DY = round(CY - (min(b[2] for b in _bx) + max(b[3] for b in _bx)) / 2.0, 1)
    for s in _lay["slots"]:
        s["x"] += FORM_DX
        s["y"] += FORM_DY
    # The packer seats every word once before it starts repeating, so the FIRST
    # slot carrying a given index is that word's own - and it is the one nearest
    # its resting place in the cloud, which makes it the shortest flight too.
    for s in _lay["slots"]:
        if s["i"] in BASE:
            REPS.append(s)
        else:
            BASE[s["i"]] = s
    assert len(BASE) == N, "layout is missing words: %d of %d" % (len(BASE), N)

    # Departure order: biggest first. WORDS is already in size order, so the
    # hero leads and the 63 pt tail brings up the rear. The alternative - all
    # 41 leaving together - was rejected on the brief ("плавно"): a synchronised
    # exit is a cut, a staggered one is a drift.
    def dep(i):
        return F_FORM0 + F_SPREAD * (i / float(N - 1))

    for i in range(N):
        st = STATES[i]
        t0 = dep(i)
        assert t0 > st[-1][0], "word %d still moving at f%.0f" % (i, t0)
        p, r = st[-1][1], st[-1][2]
        g = BASE[i]
        tgt = (float(g["x"]), float(g["y"]))
        r1 = g["pt"] / float(WORDS[i][2])
        z, kk = depth(i)
        omax = OPMAX[WORDS[i][1]]

        st.append([t0, p, r])
        st.append([t0 + F_FLIGHT, tgt, r1])
        st.append([float(DUR_F), tgt, r1])

        # The flight starts in depth-compensated space and ends flat, so the
        # two ends use DIFFERENT placements - place() at the cloud pose,
        # place_flat() at the figure. AE interpolates z from the tier's own
        # value down to 0 in between, which is the flattening made visible.
        KEYS[i].append([round(t0, 2)] + list(place(i, p, r)))
        KEYS[i].append([round(t0 + F_FLIGHT, 2)] + list(place_flat(i, tgt, r1)))
        KEYS[i].append([float(DUR_F)] + list(place_flat(i, tgt, r1)))
        SCL[i].append([round(t0, 2), round(100.0 * r * kk, 3)])
        SCL[i].append([round(t0 + F_FLIGHT, 2), round(100.0 * r1, 3)])
        SCL[i].append([float(DUR_F), round(100.0 * r1, 3)])
        # atmospheric perspective has to end when the depth does: the far tier
        # sits at 86% to look far away, and a word that is no longer far away
        # but still dimmer than its neighbours just looks like a mistake.
        OPA[i].append([round(t0, 2), omax])
        OPA[i].append([round(t0 + F_FLIGHT, 2), 100])

    # Repeats resolve largest-first, so the figure gains structure before it
    # gains texture. Fading them in size order also hides the smallest type in
    # the busiest frame, where it is least likely to be read as a new event.
    REPS.sort(key=lambda s: -s["pt"])
    for n, s in enumerate(REPS):
        i = s["i"]
        t0 = F_REP0 + (F_REP1 - F_REP0) * (n / float(max(len(REPS) - 1, 1)))
        tgt = (float(s["x"]), float(s["y"]))
        r1 = s["pt"] / float(WORDS[i][2])
        a = place_flat(i, tgt, r1 * 0.96)
        b = place_flat(i, tgt, r1)
        # ...and they release biggest-first, for the same reason the base words do
        # (see the OPA loop below): whatever is still inside the knock-out when the
        # mark goes opaque gets cropped by it, so it has to be too small to read.
        # The figure loses its structure before it loses its texture.
        last = float(max(len(REPS) - 1, 1))
        tf = F_REPF0 + (F_REPF1 - F_REPF0) * (n / last)
        REPS[n] = [WORDS[i][0], WORDS[i][2], rep_colour(s["pt"]), round(t0, 2),
                   a[0], a[1], round(96.0 * r1, 3),
                   b[0], b[1], round(100.0 * r1, 3), round(tf, 2)]

    # ---- where the figure has to end up -------------------------------------
    # Measured off the artwork, not off form_ya's chain: mark_fit.py finds the
    # letter's bbox as a FRACTION of the mark image, so the numbers survive any
    # change to MARK_D. The knock-out is not concentric with the artwork - the
    # leg pulls it down and left - so the figure has to travel those ~16 px as
    # well as shrink, or it collapses onto the disc's centre and sits visibly
    # high in its own counter.
    with open(os.path.join(HERE, "mark_fit.json"), encoding="utf-8") as fh:
        _mf = json.load(fh)
    LET_CX = CX + (_mf["lf_cx"] - 0.5) * MARK_D
    LET_CY = CY + (_mf["lf_cy"] - 0.5) * MARK_D
    _lw = (_mf["lf_x1"] - _mf["lf_x0"]) * MARK_D
    _lh = (_mf["lf_y1"] - _mf["lf_y0"]) * MARK_D

    # The ink is already centred on (CX, CY) - that is what FORM_DX/DY did - so
    # a rig anchored there scales the figure about its own centre and the only
    # other move needed is the offset to the letter. min() of the two ratios,
    # because the figure's aspect (1.24) is wider than the letter's (1.06): the
    # packed overhangs stretch its bbox sideways. Fitting on height instead would
    # push those overhangs well outside the counter, and while the disc would
    # still cover them, the words that remain visible would no longer fill it.
    INK_W = max(b[1] for b in _bx) - min(b[0] for b in _bx)
    INK_H = max(b[3] for b in _bx) - min(b[2] for b in _bx)
    COLL_S = round(min(_lw / INK_W, _lh / INK_H), 5)

    for i in range(N):
        # BIGGEST FIRST, and this is the one ordering decision in the beat that is
        # not a matter of taste. The words end up behind the mark, so the knock-out
        # crops them - which is fine, type cut to a letterform is an old and good
        # device, but only while the type reads as texture. KOLLEKTIV at the
        # collapse scale is still a 92 px cap in a 4096 frame: legible. Held to the
        # end, as it was on the first pass, the shoulder of the Ya sliced the brand's
        # hero word mid-stroke at full opacity and f1062 read as a masking bug.
        # Retiring the legible words first leaves only the small ones inside the
        # letter, and nobody reads a truncated word they could not read anyway.
        #
        # (The counter cannot simply be made big enough to contain them. The
        # knock-out is not the solid block it looks like - it carries the mark's
        # internal blue strokes, so the centre of its own bounding box is ON blue:
        # coll_fit.py finds no scale, down to 2%, at which the packed figure is
        # fully clear of it. Cropping is not avoidable, so it has to be dressed.)
        tf = F_BASF0 + (F_BASF1 - F_BASF0) * (i / float(N - 1))
        OPA[i].append([round(tf, 2), 100])
        OPA[i].append([round(tf + F_FADE_LEN, 2), 0])

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
// ...and re-assert the duration on a comp that already existed. addComp only
// runs the first time, so for six versions the length here was whatever the
// FIRST build happened to set - v6 extended the spot to 45 s and the timeline
// silently stayed at 40, which does not fail, it just renders the closing act
// past the end of the comp and hands back the last frame six times.
comp.duration = %.4f;
var FD = 1 / comp.frameRate;
function f(n){ return n * FD; }

app.beginUndoGroup("TAG CLOUD %s");

// idempotent rebuild
STEP_ = "clean";
for (var i = comp.numLayers; i >= 1; i--)
  if (comp.layer(i).comment === "CLOUD_FX") comp.layer(i).remove();

var made = [];
function keep(L){ L.comment = "CLOUD_FX"; made.push(L); return L; }
""" % ("" if VER == 1 else " --v%d" % VER, js(COMP_NAME),
       W, H, DUR_F / FPS, FPS, DUR_F / FPS, "v%d" % VER))

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
var REPS = %s;
var F_LOGO = %d, F_Q_IN = %d, F_Q_FULL = %d, F_QOUT = %d;
""" % (W, H, CX, CY, DUR_F,
       "true" if IS3D else "false", "true" if RICH else "false",
       "true" if GROW else "false",
       FONT, jsonjs(WORDS), jsonjs(KEYS), jsonjs(OPA), jsonjs(SCL),
       jsonjs([round(FRAME[i], 2) for i in range(N)]), jsonjs(REPS),
       F_LOGO, F_Q_IN, F_Q_FULL, F_QOUT))

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
// Symmetric ease, for the one gesture that must NOT depart briskly. easeAll's
// 16/88 split is deliberately front-loaded - it is what makes an entrance feel
// decisive - but on the closing contraction it puts most of a 4x shrink into
// the first second, and the figure reads as being sucked away rather than
// compacted. Measured on the render: at 55% of the beat it was already down to
// 28% of its width. Equal influence both ends gives the slow start the brief
// asks for. (Emitted JSX stays ASCII - the brief's own word for this beat is
// spelled out in gen_cloud.py, which does not have to be.)
function easeSym(p){
  for (var k = 1; k <= p.numKeys; k++) easeKey(p, k, 70, 70);
}
// straight travel: auto-bezier spatial tangents make words swoop and overshoot
function straighten(p){
  for (var k = 1; k <= p.numKeys; k++){
    try { p.setSpatialAutoBezierAtKey(k, false); } catch (e0) {}
    try { p.setSpatialTangentsAtKey(k, [0,0,0], [0,0,0]); } catch (e1) {}
  }
}
function P(v){ return THREE ? [v[0], v[1], v[2]] : [v[0], v[1]]; }
function S(s){ return THREE ? [s, s, 100] : [s, s]; }

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
var rig = null;
""")
elif not FORM:
    w("""
// in 3D the camera does the push, so there is no rig null to parent to
var nul = null;
var rig = null;
""")
else:
    w("""
// ---------- v6 form rig: the collapse, as ONE object ----------
// The closing beat contracts 112 layers onto a point. Doing that per layer means
// 112 independently eased shrinks, and any drift between them shows up as the
// figure boiling rather than compacting - the letter would come apart at exactly
// the moment it is meant to become solid. A single parent guarantees the figure
// stays rigid: whatever the ease does, it does to all of it at once.
//
// Anchor == Position == [CX, CY, 0], so the parent matrix is identity while it
// sits at 100%% and every packed value below stays a plain comp coordinate.
// Scaling then pivots on (CX, CY), which is where FORM_DX/DY already centred the
// ink, so the figure shrinks onto its own centre and the Position key carries it
// the rest of the way to the letter.
//
// The camera is irrelevant here even though these are 3D layers: the rig is only
// a transform, and it is disabled so it never renders.
STEP_ = "null";
var nul = null;
var rig = keep(comp.layers.addNull(comp.duration));
rig.name = "FORM RIG";
rig.threeDLayer = true;
rig.property("Transform").property("Anchor Point").setValue([CX, CY, 0]);
var rgp = rig.property("Transform").property("Position");
var rgs = rig.property("Transform").property("Scale");
rgp.setValueAtTime(f(%d), [CX, CY, 0]);
rgp.setValueAtTime(f(%d), [%.2f, %.2f, 0]);
rgs.setValueAtTime(f(%d), [100, 100, 100]);
rgs.setValueAtTime(f(%d), [%.3f, %.3f, %.3f]);
easeSym(rgp); straighten(rgp); easeSym(rgs);
rig.enabled = false;
""" % (F_COLL0, F_COLL1, LET_CX, LET_CY,
       F_COLL0, F_COLL1, COLL_S * 100, COLL_S * 100, COLL_S * 100))

w("""
// ---------- the words: create, parent, then animate the reflow ----------
STEP_ = "words";
var lays = [];
for (var i = 0; i < WORDS.length; i++){
  var L = txt("W " + i + " " + WORDS[i][0], WORDS[i][0], WORDS[i][2], WORDS[i][3]);
  if (THREE){
    L.threeDLayer = true;
    L.property("Transform").property("Anchor Point").setValue([0, 0, 0]);
    // BEFORE any key, always. Setting .parent on a layer that already has keys
    // makes AE rewrite every value to preserve the world transform, which would
    // silently undo the packed figure.
    if (rig) L.parent = rig;
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

if FORM:
    w("""
// ---------- v6: the repeat instances that fill the letterform ----------
// These have no life in the cloud at all - they exist only to give the figure
// density, so they are born flat on z = 0 where the pack put them and simply
// resolve into view. No flight: 41 words are already travelling, and another
// 71 in motion would turn the arrival into noise.
STEP_ = "repeats";
for (var ri = 0; ri < REPS.length; ri++){
  var R = REPS[ri];
  var RL = txt("R " + ri + " " + R[0], R[0], R[1], R[2]);
  RL.threeDLayer = true;
  RL.property("Transform").property("Anchor Point").setValue([0, 0, 0]);
  if (rig) RL.parent = rig;          // before any key - see the words loop
  var rp = RL.property("Transform").property("Position");
  var rc = RL.property("Transform").property("Scale");
  // The anchor is the text origin, so the ink centre sits at scale * offset
  // from Position: the 96 -> 100 settle has to re-derive the position on the
  // SAME keys, or the word slides as it resolves.
  rp.setValueAtTime(f(R[3]),      [R[4], R[5], 0]);
  rp.setValueAtTime(f(R[3] + 18), [R[7], R[8], 0]);
  rc.setValueAtTime(f(R[3]),      [R[6], R[6], 100]);
  rc.setValueAtTime(f(R[3] + 18), [R[9], R[9], 100]);
  easeAll(rp); straighten(rp); easeAll(rc);
  var ro = RL.property("Transform").property("Opacity");
  ro.setValueAtTime(f(R[3]), 0);
  ro.setValueAtTime(f(R[3] + 14), 100);
  ro.setValueAtTime(f(R[10]), 100);
  ro.setValueAtTime(f(R[10] + %d), 0);
  easeAll(ro);
  RL.inPoint = f(R[3]);
}
""" % F_FADE_LEN)

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
cp.setValueAtTime(f(%d), [CX + 75, CY - 40, -(CAMD - 110)]);
""" % (CAMD, F_FORM0 if FORM else DUR_F))
    if FORM:
        w("""
// The push has to come HOME for the closing act. At [CX, CY, -CAMD] the camera
// renders the z = 0 plane 1:1 and dead centre, which is the one view in which
// the packed figure is drawn exactly as it was packed - and the words are
// flying to z = 0 over the same window, so the two land together. Leaving the
// camera where the cloud left it would put the letter off-centre and shear the
// 10 px clearances the pack was checked against.
cp.setValueAtTime(f(%d), [CX, CY, -CAMD]);
// ...and then it stops. A camera still drifting under a settled sign-off frame
// makes the type crawl.
cp.setValueAtTime(f(END), [CX, CY, -CAMD]);
""" % F_FORM1)
    w("""
easeAll(cp);
straighten(cp);
""")

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

if FORM:
    w("""
// The figure needs the top of the frame: its highest word sits at y ~ 164 and
// the question's rule is at 258. So the question leaves, and it leaves BEFORE
// the first word departs rather than being pushed out by an arrival - the poll
// closes, then the answer is drawn. Both fade over 30 frames; a cut would be
// the only hard edit in a spot the brief asked to keep smooth.
STEP_ = "q-out";
qo.setValueAtTime(f(F_QOUT), 100);
qo.setValueAtTime(f(F_QOUT + 30), 0);
easeAll(qo);
var ruo = rule.property("Transform").property("Opacity");
ruo.setValueAtTime(f(F_QOUT), 100);
ruo.setValueAtTime(f(F_QOUT + 30), 0);
easeAll(ruo);
""")

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
// ---------- logo: up from the first frame ----------
// It is the sender, not the punchline. Holding it for the whole spot lets the
// cloud be the only thing that changes, and gives the question an owner while
// it is still being asked.
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

if FORM:
    w("""
// The corner lockup has been the sender for 40 s. It cannot stay for the end
// card: two logos in one frame makes the centre one look like a duplicate
// rather than the destination, and the eye has nowhere to settle. It leaves
// before the mark starts arriving, so there is a beat with no logo at all -
// which is what makes the centre one read as new.
STEP_ = "logo-out";
try {
  if (typeof lo !== "undefined" && lo){
    lo.setValueAtTime(f(%d), 100);
    lo.setValueAtTime(f(%d), 0);
    easeAll(lo);
  }
} catch (eLO) {}

// ---------- the mark: the figure resolves into the real thing ----------
// 2D on purpose. The camera is parked at [CX, CY, -CAMD] where it renders z = 0
// at 1:1, so a 3D mark would land in the same place - but only as long as the
// camera never moves again, and that is a dependency the end card should not
// carry. A 2D layer is drawn in comp coordinates by definition.
//
// The artwork is imported as PNG: After Effects will not import the WEBP the
// brand pack ships, and it fails at import rather than at render, so the layer
// is simply absent and the shot looks finished-but-empty.
STEP_ = "mark";
var markNote = "skipped";
try {
  var mf = new File("%s");
  if (mf.exists){
    var mit = app.project.importFile(new ImportOptions(mf));
    var mk = keep(comp.layers.add(mit));
    mk.name = "CLOUD MARK";
    var mw = mit.width, mh = mit.height;
    var k3 = %.1f / mw * 100;
    mk.property("Transform").property("Anchor Point").setValue([mw / 2, mh / 2]);
    mk.property("Transform").property("Position").setValue([CX, CY]);
    var ms = mk.property("Transform").property("Scale");
    // 105 -> 100 is the ring closing IN on the words, the same direction the
    // figure is travelling. An overshoot would have it spring back out, which
    // reads as a bounce - and the brand titles in this spot never bounce.
    ms.setValueAtTime(f(%d), [k3 * 1.05, k3 * 1.05]);
    ms.setValueAtTime(f(%d), [k3, k3]);
    // Scale is easeSym: the ring closing and the figure falling are one gesture
    // that finishes on one frame, and a front-loaded ease would have the ring
    // settled while the type was still coming down - two events that merely
    // overlap instead of one that resolves.
    easeSym(ms);
    // Opacity is NOT, and that is a correction. easeSym held it near zero across
    // the crossover: at f1032, 44%% into the beat, the render showed a ghost of a
    // ring around a dark block of type, with the disc - the entire mechanism of
    // this shot - not yet reading as a surface. easeAll's brisk departure gets the
    // disc established early and spends the rest of the beat settling it, so the
    // last third is type sinking into a mark that is already solid.
    var mo = mk.property("Transform").property("Opacity");
    mo.setValueAtTime(f(%d), 0);
    mo.setValueAtTime(f(%d), 100);
    easeAll(mo);
    mk.inPoint = f(%d);
    markNote = "ok " + mw + "x" + mh;
  } else { markNote = "missing"; }
} catch (eM) { markNote = "ERR " + eM.toString(); }
""" % (F_LOGOUT, F_LOGOUT + 30,
       js(os.path.join(HERE, "mark_ya.png")), MARK_D,
       F_MARK0, F_MARK1, F_MARK0, F_MARK1, F_MARK0))

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
                 mark: (typeof markNote === "undefined" ? "n/a" : markNote),
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
    print("last size change: f%.0f (%.1f s)   crossings hidden: %d"
          % (EV[-1][0], EV[-1][0] / FPS, crossings_hidden))
x0 = min(FINAL[i][0] - BOX[i]["wd"] / 2.0 for i in range(N))
x1 = max(FINAL[i][0] + BOX[i]["wd"] / 2.0 for i in range(N))
y0 = min(FINAL[i][1] - BOX[i]["ht"] / 2.0 for i in range(N))
y1 = max(FINAL[i][1] + BOX[i]["ht"] / 2.0 for i in range(N))
print("final bbox gaps  L%d R%d T%d B%d" % (x0, W - x1, y0 - TOPKEEP, H - BOTKEEP - y1))
