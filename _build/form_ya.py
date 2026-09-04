# -*- coding: utf-8 -*-
"""Pack the answer words into the silhouette of the letter "Ya".

This is the offline prototype for the closing formation. It is deliberately a
separate script: the shape pack either reads as the letter or it does not, and
that is a question about pixels, not about After Effects. Getting the answer
here costs seconds; getting it from a rebuilt comp costs minutes and a render.

The brief, from the client's reference: the silhouette is carried by the WORDS
ALONE - no ring, no glyph behind them, no ornament. Which forces two things the
first version got wrong:

  * The preview must draw the words on bare background. Pasting the mask behind
    them flatters the result - the eye reads the silhouette off the tinted
    shape, not off the type, so a sparse pack still looks like a letter. On the
    real frame there is nothing behind the words.
  * 41 words cannot fill a letter on their own. The reference repeats: PEREDOVOY,
    SOVREMENNYY, TRADITSII and INNOVATSIONNOST' each appear two or three times.
    So the pack runs the 41 at their rank sizes first, then keeps setting
    repeats at descending sizes until the figure stops accepting them.

Measured geometry of the mark (probe on its alpha channel, not eyeballed), as
fractions of its own diameter:

    ring          radius 0.90 .. 1.00
    gap           radius 0.82 .. 0.90      transparent
    inner disc    radius 0.00 .. 0.82      with the letter knocked out
    letter        radius < 0.75, bbox 0.473 x 0.447 D, area 0.1615 D^2

The letterform is the knock-out, so the mask is the INVERSE of the alpha clipped
at 0.75 R. Clipping at the full disc instead leaves the transparent 0.82..0.90
gap in the mask and words fly out onto it, reading as debris in orbit.
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))

MARK = ("C:\\Users\\\u0413\u043b\u0435\u0431\\Downloads\\"
        "\u043e\u0431\u043b\u0430\u043a\u043e \u0442\u0435\u0433\u043e\u0432\\"
        "\u041b\u043e\u0433\u043e\\IMG_1492.WEBP")
FONT = "C:/Windows/Fonts/arialbd.ttf"

W, H = 4096, 2160
CXM, CYM = 2048, 1080                           # where the figure is centred
PAD = int(os.environ.get("YA_PAD", 5))          # clearance around each ink box

# The letter is 0.447 of the nominal diameter tall, so a letter that stands
# 1930 px in a 2160 px frame needs D ~ 4320. The circle it came from is long
# gone by then - only the knock-out survives.
DIAM = int(os.environ.get("YA_DIAM", 4320))

# Resting sizes span 63..370 pt. Inside the figure that range is far too wide -
# the hero would be a slab across the whole letter. Compress it, keeping the
# rank order so the eye still finds KOLLEKTIV first.
REMAP = {370: 150, 240: 112, 168: 88, 102: 64, 63: 48}
SCALE = float(os.environ.get("YA_SCALE", 1.0))   # global size trim, tuned to fill

# Sizes for the repeat pass, descending. The last rungs are deliberately tiny:
# in the reference the smallest type is what actually draws the outline, since
# only a small word can sit in the taper of the leg or the notch of the bowl.
FILL = [78, 60, 46, 36, 29, 23, 19]
MAXREP = int(os.environ.get("YA_MAXREP", 5))     # instances of one word, total

# Two copies of the same word next to each other read as a typo, not as a
# device. The reference repeats words freely but always spreads them across the
# figure, so repeats are barred from landing within this distance of a sibling.
MINSEP = float(os.environ.get("YA_MINSEP", 620))

SX, SY = 8, 7                                    # candidate grid step, px


def load_mask():
    """Boolean mask of the region the words must land on, at comp scale.

    The paste offset is solved from the mask's own bounding box, not from the
    mark's centre: the letterform sits off-centre inside the mark, and centring
    the mark would leave the letter visibly high and left in frame.
    """
    im = Image.open(MARK).convert("RGBA")
    a = im.split()[3]
    a = a.crop(a.getbbox())                     # drop the file's padding
    a = a.resize((DIAM, DIAM), Image.LANCZOS)

    r = int(DIAM * 0.75 / 2)
    disc = Image.new("L", (DIAM, DIAM), 0)
    ImageDraw.Draw(disc).ellipse((DIAM // 2 - r, DIAM // 2 - r,
                                  DIAM // 2 + r, DIAM // 2 + r), fill=255)
    inv = a.point(lambda v: 255 if v < 60 else 0)
    a = Image.composite(inv, Image.new("L", (DIAM, DIAM), 0), disc)

    bx = a.getbbox()
    ox = CXM - (bx[0] + bx[2]) // 2
    oy = CYM - (bx[1] + bx[3]) // 2
    full = Image.new("L", (W, H), 0)
    full.paste(a, (ox, oy))
    return full, (bx[0] + ox, bx[1] + oy, bx[2] + ox, bx[3] + oy)


def integral(a):
    """Summed-area table, for O(1) 'what is the total over this box'."""
    return np.pad(a.cumsum(0).cumsum(1), ((1, 0), (1, 0)))


def win(ii, r0, c0, r1, c1):
    """Vectorised window sums over an integral image, with clipping."""
    ny, nx = ii.shape[0] - 1, ii.shape[1] - 1
    r0 = np.clip(r0, 0, ny - 1); r1 = np.clip(r1, 0, ny - 1)
    c0 = np.clip(c0, 0, nx - 1); c1 = np.clip(c1, 0, nx - 1)
    return (ii[r1 + 1, c1 + 1] - ii[r0, c1 + 1]
            - ii[r1 + 1, c0] + ii[r0, c0]), (r1 - r0 + 1) * (c1 - c0 + 1)


class Field(object):
    """The figure, plus what has been set into it so far.

    Both tests are window sums over an integral image, which is what makes it
    affordable to score EVERY candidate slot rather than walking a spiral and
    taking the first hit. Sampling the box on a grid instead - the obvious
    approach - is both slower and WRONG: the letter has notches, so a box can
    have every sample point on ink and still straddle a hole between them.
    """

    def __init__(self, mask, bounds):
        gx0, gy0, gx1, gy1 = bounds
        self.xs = np.arange(gx0, gx1, SX)
        self.ys = np.arange(gy0, gy1, SY)
        self.CX, self.CY = np.meshgrid(self.xs, self.ys)
        ny, nx = len(self.ys), len(self.xs)
        m = (np.asarray(mask, dtype=np.uint8) > 200)
        self.ink = integral(m[np.ix_(self.ys, self.xs)].astype(np.int32))
        self.occ = np.zeros((ny, nx), np.int32)
        self.occ_ii = integral(self.occ)
        self.rr, self.cc = np.mgrid[0:ny, 0:nx]

    def legal(self, hw, hh):
        """True where a box of this half-size is on ink and clear of neighbours.

        Overlap is tested as 'does the candidate's own footprint contain any
        already-set ink'. Two axis-aligned rectangles intersect exactly when one
        contains a point of the other, so with the placed boxes rasterised into
        the grid this is the same predicate - and it costs one window sum
        instead of a loop over every box placed so far.
        """
        # CEIL, not int(). Truncating rounds the tested window INWARD by up to
        # one grid step per side, so the box the packer checks is smaller than
        # the box that gets drawn - and with PAD=5 against SX=8 that quietly
        # eats the whole clearance and lets neighbours touch. Round outward and
        # the test is conservative: it can refuse a legal slot, never accept an
        # illegal one.
        dx, dy = -(-int(hw) // SX), -(-int(hh) // SY)
        r0, r1 = self.rr - dy, self.rr + dy
        c0, c1 = self.cc - dx, self.cc + dx
        got, need = win(self.ink, r0, c0, r1, c1)
        hit, _ = win(self.occ_ii, r0, c0, r1, c1)
        return (got == need) & (hit == 0)

    def take(self, cx, cy, hw, hh):
        # Mark OUTWARD - the cells marked must cover the box, not be covered by
        # it. searchsorted's default rounds the low edge inward, which leaves a
        # sliver of the box unmarked and invites the next word to sit in it.
        c0 = max(0, int(np.searchsorted(self.xs, cx - hw, "right")) - 1)
        r0 = max(0, int(np.searchsorted(self.ys, cy - hh, "right")) - 1)
        c1 = min(len(self.xs) - 1, int(np.searchsorted(self.xs, cx + hw, "left")))
        r1 = min(len(self.ys) - 1, int(np.searchsorted(self.ys, cy + hh, "left")))
        self.occ[r0:r1 + 1, c0:c1 + 1] = 1
        self.occ_ii = integral(self.occ)


def main():
    G = {"__name__": "__gen__", "__file__": os.path.join(HERE, "gen_cloud.py")}
    sys.argv = [sys.argv[0], "--v5"]
    buf, sys.stdout = sys.stdout, io.StringIO()
    exec(compile(open(G["__file__"], encoding="utf-8").read(),
                 G["__file__"], "exec"), G)
    sys.stdout = buf

    WORDS, BOX, STATES, N = G["WORDS"], G["BOX"], G["STATES"], G["N"]
    mask, bounds = load_mask()
    F = Field(mask, bounds)

    def half(i, size):
        r = size / float(WORDS[i][2])
        return BOX[i]["wd"] * r / 2.0 + PAD, BOX[i]["ht"] * r / 2.0 + PAD

    # Rank size per word, from its resting size. Order by INK AREA, not by point
    # size: the long words (OSNOVOPOLAGAYUSHCHIY, PROFESSIONALY) are small-type
    # but wide, and sorting by size alone left them until last, when every long
    # horizontal run in the figure had already been broken up. They then failed
    # at every shrink step and dropped out of the shot entirely.
    rank = []
    for i in range(N):
        rest = STATES[i][-1][2] * WORDS[i][2]
        s = REMAP[min(REMAP, key=lambda k: abs(k - rest))] * SCALE
        hw, hh = half(i, s)
        rank.append((hw * hh, s, i))
    rank.sort(reverse=True)

    area = float(np.asarray(mask).astype(bool).sum())
    print("figure %.2f Mpx   %d words at rank size ask %.0f%% of it"
          % (area / 1e6, N, 100.0 * sum(r[0] * 4 for r in rank) / area))

    set_words, used = [], [0] * N
    at = [[] for _ in range(N)]                  # where each word already sits

    # Pass 1: every word once, at the size its vote count earned.
    for _, size, i in rank:
        use = size
        for _attempt in range(5):
            hw, hh = half(i, use)
            ok = F.legal(hw, hh)
            if ok.any():
                # Nearest LEGAL slot to where the word already rests, so the
                # migration is short and the cloud's own arrangement survives
                # into the letter. Taking the first hit of an outward spiral
                # instead is what starved the earlier version.
                ax, ay = STATES[i][-1][1]
                dist = np.where(ok, (F.CX - ax) ** 2 + (F.CY - ay) ** 2, np.inf)
                k = np.unravel_index(np.argmin(dist), dist.shape)
                cx, cy = float(F.CX[k]), float(F.CY[k])
                F.take(cx, cy, hw, hh)
                set_words.append((i, use, cx, cy))
                used[i] += 1
                at[i].append((cx, cy))
                break
            use *= 0.86
        else:
            print("  BAIL %s" % WORDS[i][0])

    print("pass 1: %d / %d set" % (len(set_words), N))

    # Pass 2: repeats, largest fill size first, scanning row-major and taking
    # every legal slot as it comes. Row-major greedy is how type is set on a
    # page and it fills far more evenly here than 'nearest to anchor' would -
    # the anchors all point at the middle of the cloud, so an anchored fill
    # packs the centre and starves the leg and the taper, which are exactly the
    # parts that carry the letter.
    order = sorted(range(N), key=lambda i: BOX[i]["wd"])
    for _round in range(8):
        before = len(set_words)
        for size in FILL:
            size *= SCALE
            for i in order:
                if used[i] >= MAXREP:
                    continue
                hw, hh = half(i, size)
                ok = F.legal(hw, hh)
                for sx_, sy_ in at[i]:
                    ok &= ((F.CX - sx_) ** 2 + (F.CY - sy_) ** 2) > MINSEP ** 2
                if not ok.any():
                    continue
                k = np.unravel_index(np.argmax(ok), ok.shape)
                cx, cy = float(F.CX[k]), float(F.CY[k])
                F.take(cx, cy, hw, hh)
                set_words.append((i, size, cx, cy))
                used[i] += 1
                at[i].append((cx, cy))
        if len(set_words) == before:
            break

    fill = 100.0 * F.occ.sum() / max(1, (F.ink[-1, -1]))
    print("total %d instances (%d repeats)   figure %.0f%% covered"
          % (len(set_words), len(set_words) - N, fill))

    # Preview on BARE background - the silhouette has to be carried by the type
    # alone, because on the real frame there is nothing behind it.
    prev = Image.new("RGB", (W, H), (3, 14, 26))
    d = ImageDraw.Draw(prev)
    big = max(s for _, s, _, _ in set_words)
    for i, size, cx, cy in set_words:
        want = BOX[i]["wd"] * size / float(WORDS[i][2])
        probe = ImageFont.truetype(FONT, 100)
        wd100 = d.textbbox((0, 0), WORDS[i][0], font=probe)[2]
        f = ImageFont.truetype(FONT, max(8, int(100.0 * want / max(wd100, 1))))
        bb = d.textbbox((0, 0), WORDS[i][0], font=f)
        t = size / big
        col = ((255, 255, 255) if t > 0.55 else
               (96, 176, 240) if t > 0.30 else (58, 118, 178))
        d.text((cx - (bb[2] - bb[0]) / 2 - bb[0],
                cy - (bb[3] - bb[1]) / 2 - bb[1]), WORDS[i][0], font=f, fill=col)
    out = "C:/dev/temp/ya_letter.jpg"
    prev.resize((1600, 844), Image.LANCZOS).save(out, quality=92)
    print("preview -> %s" % out)

    # Freeze the accepted layout. The generator reads THIS, it does not re-run
    # the pack: the search is greedy over a numpy grid and a one-line change
    # here would silently reshuffle a layout the client has already signed off.
    # The file is the contract.
    rec = [{"i": i, "w": WORDS[i][0], "pt": round(sz, 2),
            "x": round(cx, 1), "y": round(cy, 1)}
           for i, sz, cx, cy in set_words]
    with open(os.path.join(HERE, "ya_layout.json"), "w", encoding="utf-8") as fh:
        json.dump({"diam": DIAM, "pad": PAD, "scale": SCALE,
                   "n_words": N, "slots": rec}, fh, ensure_ascii=False, indent=1)
    print("layout -> ya_layout.json  (%d slots)" % len(rec))


main()
