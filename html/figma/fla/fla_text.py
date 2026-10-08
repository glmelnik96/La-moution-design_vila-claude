"""fla_text.py — SB Sans line layout the way Figma does it (advances + GPOS pair kerning), for static text in Animate.

Animate 2024 ignores GPOS kerning (these OTFs have no legacy kern table), so the kerning goes into per-character
letter spacing. It puts the first glyph origin at the text matrix tx and the first baseline at ty + round(ascent * size)
(measured on every face/size the banners use).
"""
import os
from fontTools.ttLib import TTFont

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts')
FILES = {'SBSansDisplay-Regular': 'SBSansDisplay-Regular.otf', 'SBSansDisplay-Semibold': 'SBSansDisplay-SemiBold.otf',
         'SBSansText-Medium': 'SBSansText-Medium.otf', 'SBSansText-Regular': 'SBSansText-Regular.otf',
         'SBSansText-Semibold': 'SBSansText-Semibold.otf'}
ASC = {'SBSansDisplay-Regular': 0.96, 'SBSansDisplay-Semibold': 0.96, 'SBSansText-Medium': 0.982,
       'SBSansText-Regular': 0.982, 'SBSansText-Semibold': 0.982}
_cache = {}


def _load(face):
    if face not in _cache:
        f = TTFont(os.path.join(FONT_DIR, FILES[face]))
        subs = [st for lk in f['GPOS'].table.LookupList.Lookup if lk.LookupType == 2 for st in lk.SubTable]
        _cache[face] = (f.getBestCmap(), f['hmtx'], f['head'].unitsPerEm, subs)
    return _cache[face]


def _kern(subs, g1, g2):
    for st in subs:
        cov = st.Coverage.glyphs
        if g1 not in cov: continue
        if st.Format == 1:
            for r in st.PairSet[cov.index(g1)].PairValueRecord:
                if r.SecondGlyph == g2:
                    return (getattr(r.Value1, 'XAdvance', 0) or 0) if r.Value1 else 0
        elif st.Format == 2:
            rec = st.Class1Record[st.ClassDef1.classDefs.get(g1, 0)].Class2Record[st.ClassDef2.classDefs.get(g2, 0)]
            return (getattr(rec.Value1, 'XAdvance', 0) or 0) if rec.Value1 else 0
    return 0


def layout(face, s, size, ls=0.0):
    """→ (spacing after each char in px incl. kerning (last = 0), line width as Figma lays it out — no trailing spacing)."""
    cmap, hm, upm, subs = _load(face)
    gs = [cmap.get(ord(ch), cmap.get(ord('?'))) for ch in s]
    sp, x = [], 0.0
    for i, g in enumerate(gs):
        x += hm[g][0] * size / upm
        if i + 1 < len(gs):
            d = ls + _kern(subs, g, gs[i + 1]) * size / upm
            sp.append(d); x += d
        else:
            sp.append(0.0)
    return sp, x


def baseline_offset(face, size):
    return round(ASC[face] * size)
