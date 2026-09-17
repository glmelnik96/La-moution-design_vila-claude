# -*- coding: utf-8 -*-
"""Ink measurement shared by the builder (deck.py: where Figma put a text) and the verifier
(verify_deck.py: where AE put it). Both must apply the same rule, so it lives here.

A text's ink is the set of connected glyph components that touch its *core* - the dense
rectangle (rows and columns holding at least 8 % of the peak ink count, i.e. the cap-height
band across the glyph stems) - plus the small detached marks that belong to it (the breve of
a short i, the dots of yo, dots and commas), which are components no taller than 0.28 x the
font size lying inside the text's horizontal span and within half a size of the core.
Sparse extremes (an ascender of a lowercase be, a descender of a u) stay connected to their
glyph, so they are part of the bbox even when the measurement rect is generous; the glyphs
of a neighbouring element never touch the core, so they are left out.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

S8 = np.ones((3, 3), int)


def colour_mask(sub, key=None, thr=100, tol=40):
    """Pixels within tol of the key colour (or any colour of a list), else above thr luminance."""
    if key is not None:
        cols = key if isinstance(key[0], (list, tuple)) else [key]
        m = np.zeros(sub.shape[:2], bool)
        for c in cols:
            m |= np.abs(sub - np.array([int(round(v * 255)) for v in c])).max(axis=2) < tol
        return m
    return sub.max(axis=2) > thr


def own_mask(m, core, size):
    """m: bool ink mask over the rect; core: (x0, y0, x1, y1) rect-local half-open; size: font px."""
    lab, n = ndimage.label(m, structure=S8)
    if n == 0:
        return m
    x0, y0, x1, y1 = core
    ids = np.unique(lab[max(0, y0):max(0, y1), max(0, x0):max(0, x1)])
    ids = ids[ids > 0]
    if len(ids) == 0:
        return m
    own = np.isin(lab, ids)
    ys, xs = np.where(own)
    sx0, sx1 = int(xs.min()), int(xs.max())
    extra = []
    H, W = m.shape
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None or (i + 1) in ids:
            continue
        if sl[0].start == 0 or sl[0].stop == H or sl[1].start == 0 or sl[1].stop == W:
            continue                                  # clipped by the rect: a neighbour's fragment, not a mark
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if (h <= 0.28 * size and w <= 0.6 * size and sl[1].start >= sx0 - 2 and sl[1].stop <= sx1 + 3
                and sl[0].start >= y0 - 0.4 * size and sl[0].stop <= y1 + 0.15 * size):   # marks above; only hanging punctuation below
            extra.append(i + 1)
        elif (h <= 0.2 * size and w <= 1.1 * size and sl[0].start >= y0 and sl[0].stop <= y1
              and sl[1].start >= sx0 - 1.3 * size and sl[1].stop <= sx1 + 1.3 * size):    # a dash hanging past the block's edge
            extra.append(i + 1)
    if extra:
        own |= np.isin(lab, extra)
    return own


def bbox_of(m):
    if not m.any():
        return None
    ys, xs = np.where(m)
    return [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]


def _runs(on):
    out, cur = [], None
    for i, v in enumerate(on):
        if v and cur is None:
            cur = i
        if not v and cur is not None:
            out.append((cur, i - 1)); cur = None
    if cur is not None:
        out.append((cur, len(on) - 1))
    return out


def bands_of(m, min_h):
    """Line bands (top, bottom), rect-local: coarse runs of inked rows (>= 3 % of the peak row, >= 2 px),
    each split into the rows holding >= 8 % of that run's own peak - so a short label line beside
    long body lines keeps its band, and two lines whose descenders touch the next ascenders part."""
    rows = m.sum(axis=1)
    if rows.size == 0 or rows.max() == 0:
        return []
    out = []
    for a, b in _runs(rows >= max(2, 0.03 * rows.max())):
        seg = rows[a:b + 1]
        for c, d in _runs(seg >= max(2, 0.08 * seg.max())):     # 8 % of the run itself, not of the element
            if d - c + 1 >= min_h:
                out.append((a + c, a + d))
    return out


def dense_rect(m, min_h):
    """Core of a text inside its mask: the union of its line bands x the dense columns."""
    bs = bands_of(m, min_h)
    if not bs:
        return None
    top, bot = bs[0][0], bs[-1][1]
    cols = m[top:bot + 1].sum(axis=0)
    on = np.where(cols >= max(1, 0.08 * cols.max()))[0]
    return [int(on.min()), int(top), int(on.max() - on.min() + 1), int(bot - top + 1)]


def measure(img, rect, key=None, thr=100, tol=40, core=None, size=None):
    """Ink bbox (frame px) of the element inside rect; with a core, only its own components."""
    x, y, w, h = [int(v) for v in rect]
    x, y = max(0, x), max(0, y)
    sub = img[y:y + h, x:x + w]
    m = colour_mask(sub, key, thr, tol)
    if core is not None:
        cx, cy, cw, ch = [int(v) for v in core]
        m = own_mask(m, (cx - x, cy - y, cx - x + cw, cy - y + ch), size)
    b = bbox_of(m)
    return (None if b is None else [b[0] + x, b[1] + y, b[2], b[3]]), m, x, y
