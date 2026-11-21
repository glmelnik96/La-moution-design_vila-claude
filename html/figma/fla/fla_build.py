"""fla_build.py — model JSON (tools/fla_extract.js) → an Animate HTML5 Canvas document as uncompressed XFL.

    python tools/fla_build.py fla/model-9x16.json OUTDIR 450 800 banner_450x800

Every component becomes one or more symbol instances on the main timeline (stage px = Figma units × k), grouped in a
layer folder per component; clips become mask layers. Each element's per-frame state (matrix scale/position, alpha)
is rebuilt as keyframes + classic tweens: a tween's custom ease is the exact sub-curve of the HTML version's cubic
Bézier (or a cubic polynomial), checked against every frame; where nothing fits, the span is split by a keyframe.
Animate then opens the XFL and saves the .fla itself (tools/fla_finish.jsfl).
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xfl, fla_text, fla_svg

METRICS = {'display': (0.96, 0.22, 0.70), 'text': (0.982, 0.272, 0.70)}
FACES = {('display', 400): 'SBSansDisplay-Regular', ('display', 600): 'SBSansDisplay-Semibold',
         ('text', 400): 'SBSansText-Regular', ('text', 500): 'SBSansText-Medium', ('text', 600): 'SBSansText-Semibold'}
TILE = 20 * 0.8584216833114624
PITCH, DOT = TILE * 1.8, 4 * 0.8584216833114624
GREEN = '#26D07C'
U = 100.0                                   # size of the unit mask rectangle (px)

# ───────── easing: cubic Bézier eases as control points, sub-curves, fits ─────────
def bez(p, s):
    u = 1 - s
    return (3 * u * u * s * p[0] + 3 * u * s * s * p[2] + s * s * s, 3 * u * u * s * p[1] + 3 * u * s * s * p[3] + s * s * s)


def s_for_x(p, x):
    lo, hi = 0.0, 1.0
    for _ in range(60):
        m = (lo + hi) / 2
        if bez(p, m)[0] < x: lo = m
        else: hi = m
    return (lo + hi) / 2


def ease_y(p, x):
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    return bez(p, s_for_x(p, x))[1]


def subcurve(p, x0, x1):
    """Normalized control points of the ease between x0 and x1 (None if flat)."""
    P = [(0.0, 0.0), (p[0], p[1]), (p[2], p[3]), (1.0, 1.0)]
    def split(Q, t):
        m = lambda a, b: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        a, b, c = m(Q[0], Q[1]), m(Q[1], Q[2]), m(Q[2], Q[3])
        d, e = m(a, b), m(b, c)
        f = m(d, e)
        return [Q[0], a, d, f], [f, e, c, Q[3]]
    s0, s1 = s_for_x(p, x0), s_for_x(p, x1)
    left, _ = split(P, s1)
    _, seg = split(left, s0 / s1 if s1 > 0 else 0)
    (ax, ay), (bx, by) = seg[0], seg[3]
    if abs(by - ay) < 1e-9 or abs(bx - ax) < 1e-12: return None
    n = [((qx - ax) / (bx - ax), (qy - ay) / (by - ay)) for qx, qy in seg]
    return (n[1][0], n[1][1], n[2][0], n[2][1])


def ease_ctrl(e):
    """Recorded ease → control points (x1, y1, x2, y2) or None."""
    if isinstance(e, list): return tuple(e)
    if e == 'linear' or e is None: return (1 / 3, 1 / 3, 2 / 3, 2 / 3)
    if isinstance(e, dict) and 'samples' in e:          # a function: exact if it is a cubic polynomial in x
        ys = e['samples']; n = len(ys) - 1
        b = poly_fit([(i / n, ys[i]) for i in range(n + 1)])
        if b and max(abs(ease_y(b, i / n) - ys[i]) for i in range(n + 1)) < 1e-5: return b
        return None
    named = {'enter': (0.16, 1, 0.3, 1), 'exit': (0.7, 0, 0.84, 0), 'move': (0.65, 0, 0.35, 1)}
    return named.get(e)


def poly_fit(pts):
    """Least squares y = 3(1-x)²x·b1 + 3(1-x)x²·b2 + x³ (x-controls at 1/3, 2/3: x(s) = s) → control points."""
    s11 = s12 = s22 = r1 = r2 = 0.0
    for x, y in pts:
        f1, f2 = 3 * (1 - x) ** 2 * x, 3 * (1 - x) * x * x
        t = y - x ** 3
        s11 += f1 * f1; s12 += f1 * f2; s22 += f2 * f2; r1 += f1 * t; r2 += f2 * t
    det = s11 * s22 - s12 * s12
    if abs(det) < 1e-14: return None
    return (1 / 3, (r1 * s22 - r2 * s12) / det, 2 / 3, (s11 * r2 - s12 * r1) / det)


GROUPS = (('position', (2, 3), 0.015), ('scale', (0, 1), 0.0004), ('color', (4,), 0.002))


class Fitter:
    def __init__(self, tweens, fps, N):
        self.fps, self.N = fps, N
        self.tw = []
        bounds = set()
        for t in tweens:
            c = ease_ctrl(t['ease'])
            if t['dur'] > 0 and c: self.tw.append((t['t'], t['dur'], c))
            for v in (t['t'], t['t'] + t['dur']):
                f = v * fps
                for g in (math.floor(f + 1e-6), math.ceil(f - 1e-6)):
                    if 0 < g < N - 1: bounds.add(g)
        self.bounds = sorted(bounds)
        self._cand = {}

    def candidates(self, fa, fb):
        key = (fa, fb)
        if key in self._cand: return self._cand[key]
        ta, tb = fa / self.fps, fb / self.fps
        out, seen = [(1 / 3, 1 / 3, 2 / 3, 2 / 3)], set()
        for t0, d, c in self.tw:
            if t0 - 1e-6 <= ta and tb <= t0 + d + 1e-6:
                sc = subcurve(c, max(0.0, (ta - t0) / d), min(1.0, (tb - t0) / d))
                if sc:
                    k = tuple(round(v, 6) for v in sc)
                    if k not in seen: seen.add(k); out.append(sc)
        self._cand[key] = out
        return out

    def fit(self, S, fa, fb):
        """→ (curves dict, None) or (None, split frame)."""
        curves = {}
        L = fb - fa
        xs = [(n - fa) / L for n in range(fa, fb + 1)]
        for g, idx, tol in GROUPS:
            comps = []
            for i in idx:
                v = [S[n][i] for n in range(fa, fb + 1)]
                if max(v) - min(v) <= tol: continue
                dv = v[-1] - v[0]
                if abs(dv) <= tol:                       # leaves and comes back: needs a key at the extreme
                    j = max(range(len(v)), key=lambda q: abs(v[q] - v[0]))
                    return None, self.split_at(fa, fb, fa + j)
                comps.append((v, dv))
            if not comps: continue
            def err(c):
                worst, at = 0.0, fa
                for v, dv in comps:
                    for q, x in enumerate(xs):
                        e = abs(v[0] + dv * ease_y(c, x) - v[q])
                        if e > worst: worst, at = e, fa + q
                return worst, at
            found = None
            for c in self.candidates(fa, fb):
                if err(c)[0] <= tol: found = c; break
            if not found:
                c = poly_fit([(x, (v[q] - v[0]) / dv) for v, dv in comps for q, x in enumerate(xs)])
                if c and err(c)[0] <= tol: found = c
            if not found:
                worst, at = err(c) if c else (1, (fa + fb) // 2)
                return None, self.split_at(fa, fb, at)
            curves[g] = found
        return curves, None

    def split_at(self, fa, fb, at):
        inside = [b for b in self.bounds if fa < b < fb]
        if inside: return min(inside, key=lambda b: abs(b - at))
        return min(max(at, fa + 1), fb - 1)


def same(s1, s2):
    for g, idx, tol in GROUPS:
        for i in idx:
            if abs(s1[i] - s2[i]) > tol: return False
    return True


def keyframes(S, fit):
    """S: per-frame states (a, d, tx, ty, alpha) → [(frame, curves or None)] with the last frame implicit."""
    N = len(S)
    moving = [False] + [not same(S[n], S[n - 1]) for n in range(1, N)]
    keys = {0, N - 1}
    for n in range(1, N):
        if moving[n] and not moving[n - 1]: keys.add(n - 1)
        if moving[n] and (n == N - 1 or not moving[n + 1]): keys.add(n)
    keys = sorted(keys)
    out = []
    stack = list(zip(keys[:-1], keys[1:]))[::-1]
    while stack:
        a, b = stack.pop()
        if not any(moving[n] for n in range(a + 1, b + 1)):
            out.append((a, b, None)); continue
        if b - a == 1:                                   # the next key carries the new state
            out.append((a, b, None)); continue
        curves, split = fit.fit(S, a, b)
        if curves is not None: out.append((a, b, curves))
        else: stack.extend([(split, b), (a, split)])
    out.sort()
    return out


def bezier_points(c):
    return [(0, 0), (c[0], c[1]), (c[2], c[3]), (1, 1)]


# ───────── the build ─────────
class Build:
    def __init__(self, model, sw, sh, name):
        self.m = model
        self.k = sw / model['frame']['w']
        self.W, self.H = sw, sh
        self.N, self.fps = model['N'], model['fps']
        self.F = model['frames']
        self.doc = xfl.Document(sw, sh, self.fps, name, background=GREEN)
        self.fit = Fitter(model['tweens'], self.fps, self.N)
        self.syms = {}
        self.layers = []            # bottom → top: dicts
        self.uid = 0

    # ── library ──
    def symbol(self, name, elements_xml):
        if name not in self.syms:
            self.syms[name] = self.doc.add_symbol(name, [xfl.layer('art', [xfl.frame(0, 1, ''.join(elements_xml))])])
        return name

    def rect_shape(self, x, y, w, h, color, alpha=1.0):
        return xfl.shape_rects([(x, y, w, h)], color, alpha).replace('<DOMShape>', '<DOMShape isDrawingObject="true">', 1)

    def text_xml(self, o, dx=0.0, dy=0.0):
        k = self.k
        font = o.get('font') or 'display'; w8 = o.get('w8') or 400
        face = FACES[(font, w8)]
        asc, desc, cap = METRICS[font]
        S = o['size']; L = o['lh'] if o.get('lh') is not None else S * 1.1
        lines = str(o['s']).split('\n'); n = o.get('n') or len(lines)
        bo = (L - (asc + desc) * S) / 2 + asc * S
        if o.get('trim') == 'CAP': base = cap * S
        elif o.get('vbox') is not None: base = (o['vbox'] - n * L) / 2 + bo
        else: base = bo
        base += o.get('dy') or 0
        col = o.get('color') or [34, 34, 34]
        a = o.get('a') if o.get('a') is not None else 1.0
        size = S * k; ls = (o.get('ls') or 0) * S * k
        out = []
        for i, line in enumerate(lines):
            sp, width = fla_text.layout(face, line, size, ls)
            align = o.get('align') or 'L'
            x0 = 0.0 if align == 'L' else ((o['bw'] * k - width) / (2 if align == 'C' else 1))
            ty = (base + i * L) * k - fla_text.baseline_offset(face, size)
            runs, cur, curls = [], '', None
            for ch, s_ in zip(line, sp):
                v = round(s_, 1)
                if curls is None or abs(v - curls) < 1e-9: cur += ch; curls = v if curls is None else curls
                else: runs.append((cur, curls)); cur, curls = ch, v
            if cur: runs.append((cur, curls))
            rx = []
            for chars, v in runs:
                attrs = ['aliasText="false"']
                if abs(v) > 1e-9: attrs.append('letterSpacing="%s"' % xfl.num(v, 1))
                attrs += ['size="%s"' % xfl.num(size, 2), 'bitmapSize="%d"' % int(round(size * 20)), 'face="%s"' % face,
                          'fillColor="%s"' % xfl.hexcol(col)]
                if a < 0.9999: attrs.append('alpha="%s"' % xfl.num(a))
                rx.append('<DOMTextRun><characters>%s</characters><textAttrs><DOMTextAttrs %s/></textAttrs></DOMTextRun>'
                          % (xfl.escape(chars), ' '.join(attrs)))
            out.append('<DOMStaticText autoExpand="true" isSelectable="false"><matrix><Matrix tx="%s" ty="%s"/></matrix>'
                       '<textRuns>%s</textRuns></DOMStaticText>' % (xfl.num(dx + x0, 3), xfl.num(dy + ty, 3), ''.join(rx)))
        return out

    def logo_xml(self, prim, dx=0.0, dy=0.0):
        k, o = self.k, prim['o']
        out = []
        for p in prim['paths']:
            fn = fla_svg.parse_transform(p['transform'])
            cs = fla_svg.transform(fla_svg.parse(p['d']), lambda q: ((fn(q)[0] + o['x']) * k + dx, (fn(q)[1] + o['y']) * k + dy))
            out.append(xfl.shape_edges(fla_svg.edges(cs), p['fill']).replace('<DOMShape>', '<DOMShape isDrawingObject="true">', 1))
        return out

    def rect_xml(self, o, dx=0.0, dy=0.0):
        k = self.k
        x, y, w, h = o['x'] * k + dx, o['y'] * k + dy, o['w'] * k, o['h'] * k
        out = []
        if o.get('fill') and o['fill'] != 'none': out.append(self.rect_shape(x, y, w, h, o['fill']))
        if o.get('stroke') and o['stroke'] != o.get('fill'):
            sw = (o.get('sw') or 1) * k
            for r in ((x, y, w, sw), (x, y + h - sw, w, sw), (x, y + sw, sw, h - 2 * sw), (x + w - sw, y + sw, sw, h - 2 * sw)):
                out.append(self.rect_shape(*r, o['stroke']))
        return out

    def group_xml(self, comp, only=None, dx=0.0, dy=0.0):
        out = []
        for p in comp['prims']:
            if only and not only(p): continue
            if p['kind'] == 'rect': out += self.rect_xml(p['o'], dx, dy)
            elif p['kind'] == 'text': out += self.text_xml(p['o'], dx + p['o'].get('x', 0) * self.k, dy + p['o'].get('y', 0) * self.k)
            elif p['kind'] == 'logo': out += self.logo_xml(p, dx, dy)
        return out

    def unit_mask(self):
        return self.symbol('Masks/unit', [self.rect_shape(0, 0, U, U, '#FF00FF')])

    # ── tracks ──
    def add(self, folder, name, sym, states, kind='normal', mask_of=None, shapes=None):
        self.uid += 1
        L = {'id': self.uid, 'folder': folder, 'name': name, 'sym': sym, 'S': states, 'kind': kind, 'shapes': shapes}
        self.layers.append(L)
        return L

    def mask_state(self, L, R, T, B, vis):
        return (max(R - L, 0.01) / U, max(B - T, 0.01) / U, L, T, 1.0 if vis else 0.0)

    def clip_track(self, folder, name, getter):
        """getter(n) → (L, R, T, B, visible) in stage px."""
        return self.add(folder, name, self.unit_mask(), [self.mask_state(*getter(n)) for n in range(self.N)], kind='mask')

    def conv_text(self, c, folder):
        k, o = self.k, c['prims'][0]['o']
        sym = self.symbol('Text/' + c['id'], self.text_xml(o))
        S, clips = [], False
        for n in range(self.N):
            p = self.F[n][c['id']]
            alpha = max(0.0, min(1.0, p.get('op', 1))) * (p.get('a') if p.get('a') is not None else 1)
            S.append((1.0, 1.0, p['x'] * k, (p['y'] + (p.get('ry') or 0)) * k, alpha))
            if alpha > 0 and self.clip_of(p) is not None: clips = True
        word = self.add(folder, folder, sym, S)
        if clips:
            def g(n):
                p = self.F[n][c['id']]
                cl = self.clip_of(p) or (None, None, None, None)
                Lx = cl[0] * k if cl[0] is not None else -10
                Rx = cl[1] * k if cl[1] is not None else self.W + 10
                T = cl[2] * k if cl[2] is not None else -10
                B = cl[3] * k if cl[3] is not None else self.H + 10
                return Lx, Rx, T, B, S[n][4] > 0
            m = self.clip_track(folder, folder + ' — маска', g)
            word['masked_by'] = m['id']

    @staticmethod
    def clip_of(p):
        on = lambda v, lo: v is not None and (v > -9e4 if lo else v < 9e4)
        cL, cR, cT, cB = p.get('cL'), p.get('cR'), p.get('cT'), p.get('cB')
        if not (on(cL, 1) or on(cR, 0) or on(cT, 1) or on(cB, 0)): return None
        return (cL if on(cL, 1) else None, cR if on(cR, 0) else None, cT if on(cT, 1) else None, cB if on(cB, 0) else None)

    def conv_rect(self, c, folder):
        k, o = self.k, c['prims'][0]['o']
        W0, H0 = o['w'], o['h']
        fill = o.get('fill') or 'none'
        id_ = c['id']
        vis = lambda p: p['w'] > 0.01 and p['h'] > 0.01
        op = lambda p: max(0.0, min(1.0, p.get('op', 1)))
        cl = lambda v: max(v, 1e-4)
        if fill != 'none':
            sym = self.symbol('Shapes/%s_fill' % id_, [self.rect_shape(0, 0, W0 * k, H0 * k, fill)])
            S = [(cl(p['w'] / W0), cl(p['h'] / H0), p['x'] * k, p['y'] * k, op(p) if vis(p) else 0.0)
                 for p in (self.F[n][id_] for n in range(self.N))]
            self.add(folder, folder if not (o.get('stroke') or o.get('handles')) else folder + ' — заливка', sym, S)
        st = o.get('stroke')
        if st and st != fill:
            sw = o.get('sw') or 1
            hs = self.symbol('Shapes/%s_hline' % id_, [self.rect_shape(0, 0, W0 * k, sw * k, st)])
            vs = self.symbol('Shapes/%s_vline' % id_, [self.rect_shape(0, 0, sw * k, H0 * k, st)])
            sv = lambda p: p['w'] > sw and p['h'] > sw
            for nm, sym, fn in (('верх', hs, lambda p: (cl(p['w'] / W0), 1.0, p['x'] * k, p['y'] * k)),
                                ('низ', hs, lambda p: (cl(p['w'] / W0), 1.0, p['x'] * k, (p['y'] + p['h'] - sw) * k)),
                                ('лево', vs, lambda p: (1.0, cl(p['h'] / H0), p['x'] * k, p['y'] * k)),
                                ('право', vs, lambda p: (1.0, cl(p['h'] / H0), (p['x'] + p['w'] - sw) * k, p['y'] * k))):
                S = []
                for n in range(self.N):
                    p = self.F[n][id_]
                    S.append(fn(p) + ((op(p) if sv(p) else 0.0),))
                self.add(folder, folder + ' — обводка ' + nm, sym, S)
        hd = o.get('handles')
        if hd:
            Sz = hd['size']
            hsym = self.symbol('Shapes/handle_%s' % xfl.num(Sz * k, 3).replace('.', '_'),
                               [self.rect_shape(-Sz * k / 2, -Sz * k / 2, Sz * k, Sz * k, hd.get('fill') or '#222222')])
            for i, nm in enumerate(('маркер ЛВ', 'маркер ПВ', 'маркер ЛН', 'маркер ПН')):
                S = []
                for n in range(self.N):
                    p = self.F[n][id_]
                    kk = max(0.0, min(1.0, p.get('ht', 1) if i < 2 else p.get('hb', 1)))
                    hx = hd['dl'] if i % 2 == 0 else p['w'] + hd['dr']
                    hy = hd['dt'] if i < 2 else p['h'] + hd['db']
                    v = vis(p) and kk > 0.001
                    S.append((cl(kk), cl(kk), (p['x'] + hx + Sz / 2) * k, (p['y'] + hy + Sz / 2) * k, op(p) if v else 0.0))
                self.add(folder, folder + ' — ' + nm, hsym, S)

    def conv_group(self, c, folder):
        k = self.k
        xml = self.group_xml(c, only=lambda q: q['kind'] == 'rect')
        if c['id'] == 'hdr' and self.m.get('layout'):           # the grey «barcode» lines are plain SVG in the HTML
            ln = self.m['layout']['header']['lines']
            x = ln['x']
            while x < ln['clipX1'] - 1e-6:
                w = min(ln['w'], ln['clipX1'] - x)
                xml.append(self.rect_shape(x * k, ln['y'] * k, w * k, ln['h'] * k, ln['color']))
                x += ln['pitch']
        xml += self.group_xml(c, only=lambda q: q['kind'] != 'rect')
        sym = self.symbol('Chrome/' + c['id'], xml)
        S = [(1.0, 1.0, p['x'] * k, p['y'] * k, max(0.0, min(1.0, p.get('op', 1)))) for p in (self.F[n][c['id']] for n in range(self.N))]
        self.add(folder, folder, sym, S)

    def conv_dots(self, c, folder):
        k = self.k
        id_ = c['id']
        P = self.F
        live = [P[n][id_] for n in range(self.N) if P[n][id_].get('op', 1) > 0]
        min_ax = min(p['ax'] for p in live); max_ax2 = max(p['ax'] + p['aw'] for p in live)
        min_ay = min(p['ay'] for p in live); max_ay2 = max(p['ay'] + p['ah'] for p in live)
        max_ox = max(p['ox'] for p in live); max_oy = max(p['oy'] for p in live)
        min_ox = min(p['ox'] for p in live); min_oy = min(p['oy'] for p in live)
        mx = math.ceil((max_ox - min_ax) / PITCH) + 1; my = math.ceil((max_oy - min_ay) / PITCH) + 1
        nx = math.ceil((max_ax2 - (min_ox - mx * PITCH)) / PITCH) + 2
        ny = math.ceil((max_ay2 - (min_oy - my * PITCH)) / PITCH) + 2
        row = self.symbol('Dots/row_%d_%s' % (nx, xfl.num(self.k, 4).replace('.', '_')),
                          [xfl.shape_rects([(i * PITCH * k, 0, DOT * k, DOT * k) for i in range(nx)], '#FFFFFF')
                           .replace('<DOMShape>', '<DOMShape isDrawingObject="true">', 1)])
        grid = self.symbol('Dots/grid_%s' % id_, [xfl.instance(row, ty=j * PITCH * k) for j in range(ny)])
        S, R = [], []
        for n in range(self.N):
            p = P[n][id_]
            alpha = max(0.0, min(1.0, p.get('op', 1))) * (p.get('da') if p.get('da') is not None else 1)
            S.append((1.0, 1.0, (p['ox'] - mx * PITCH) * k, (p['oy'] - my * PITCH) * k, alpha))
            area = (p['ax'], p['ay'], p['ax'] + p['aw'], p['ay'] + p['ah'])
            rects = []
            masks = c['prims'][0]['o'].get('masks') or []
            src = masks if (p.get('mask', 0) >= 0.5 and masks) else [[p['ax'], p['ay'], p['aw'], p['ah']]]
            for mr in src:
                x0, y0 = max(mr[0], area[0]), max(mr[1], area[1])
                x1, y1 = min(mr[0] + mr[2], area[2]), min(mr[1] + mr[3], area[3])
                if x1 > x0 and y1 > y0: rects.append((round(x0 * k, 3), round(y0 * k, 3), round((x1 - x0) * k, 3), round((y1 - y0) * k, 3)))
            R.append(tuple(rects) if alpha > 0 else None)
        gl = self.add(folder, folder, grid, S)
        m = self.add(folder, folder + ' — область', None, None, kind='mask', shapes=R)
        gl['masked_by'] = m['id']

    def conv_brandbox(self, c, folder):
        k = self.k
        prims = c['prims']
        stacked = any(p['path'] == [0] for p in prims)
        P = self.F
        op = lambda p: max(0.0, min(1.0, p.get('op', 1)))
        um = self.unit_mask()
        if stacked:
            rule = next(p for p in prims if p['path'] == [0])['o']
            top = next(p for p in prims if p['kind'] == 'rect' and p['path'][:1] == [1])['o']
            bot = next(p for p in prims if p['kind'] == 'rect' and p['path'][:1] == [2])['o']
            Wt, ht, rh, by, hb = rule['w'], top['h'], rule['h'], bot['y'], bot['h']
            rsym = self.symbol('Lock/rule', [self.rect_shape(0, 0, Wt * k, rh * k, rule['fill'])])
            S = []
            for n in range(self.N):
                p = P[n][c['id']]; rk = max(0.0, min(1.0, p.get('rule', 1)))
                S.append((max(rk, 1e-4), 1.0, (p['x'] + Wt * (1 - rk) / 2) * k, (p['y'] + ht) * k, op(p) if rk > 0 else 0.0))
            self.add(folder, folder + ' — линия', rsym, S)
            halves = (('верх', 1, lambda p, kk: (p['y'] + ht * (1 - kk), p['y'] + ht)),
                      ('низ', 2, lambda p, kk: (p['y'] + by, p['y'] + by + hb * kk)))
            for nm, idx, tb in halves:
                sym = self.symbol('Lock/' + ('top' if idx == 1 else 'bottom'), self.group_xml(c, only=lambda q, i=idx: q['path'][:1] == [i]))
                S, M = [], []
                for n in range(self.N):
                    p = P[n][c['id']]; kk = max(0.0, min(1.0, p.get('open', 1)))
                    v = op(p) if kk > 0 else 0.0
                    S.append((1.0, 1.0, p['x'] * k, p['y'] * k, v))
                    T, B = tb(p, kk)
                    M.append(self.mask_state((p['x'] - 10) * k, (p['x'] + Wt + 10) * k, T * k, B * k, v > 0))
                half = self.add(folder, folder + ' — ' + nm, sym, S)
                m = self.add(folder, folder + ' — ' + nm + ' — маска', um, M, kind='mask')
                half['masked_by'] = m['id']
        else:
            left = next(p for p in prims if p['kind'] == 'rect' and p['path'][:1] == [0])['o']
            right = next(p for p in prims if p['kind'] == 'rect' and p['path'][:1] == [1])['o']
            wL, rx, wR, Hh = left['w'], right['x'], right['w'], max(left['h'], right['h'])
            halves = (('лево', 0, lambda p, kk: (p['x'] + wL * (1 - kk), p['x'] + wL)),
                      ('право', 1, lambda p, kk: (p['x'] + rx, p['x'] + rx + wR * kk)))
            for nm, idx, lr in halves:
                sym = self.symbol('Lock/' + ('left' if idx == 0 else 'right'), self.group_xml(c, only=lambda q, i=idx: q['path'][:1] == [i]))
                S, M = [], []
                for n in range(self.N):
                    p = P[n][c['id']]; kk = max(0.0, min(1.0, p.get('open', 1)))
                    v = op(p) if kk > 0 else 0.0
                    S.append((1.0, 1.0, p['x'] * k, p['y'] * k, v))
                    Lx, Rx = lr(p, kk)
                    M.append(self.mask_state(Lx * k, Rx * k, (p['y'] - 10) * k, (p['y'] + Hh + 10) * k, v > 0))
                half = self.add(folder, folder + ' — ' + nm, sym, S)
                m = self.add(folder, folder + ' — ' + nm + ' — маска', um, M, kind='mask')
                half['masked_by'] = m['id']

    # ── assemble ──
    def frames_xml(self, L):
        N = self.N
        if L['kind'] == 'mask' and L['shapes'] is not None:          # static region shapes, changing by keys
            out, R, n = [], L['shapes'], 0
            while n < N:
                m = n
                while m + 1 < N and R[m + 1] == R[n]: m += 1
                el = xfl.shape_union(list(R[n]), '#FF00FF') if R[n] else ''
                out.append(xfl.frame(n, m - n + 1, el))
                n = m + 1
            return out
        S = L['S']
        ivs = keyframes(S, self.fit)
        inst = lambda st: xfl.instance(L['sym'], a=st[0], d=st[1], tx=st[2], ty=st[3], alpha=st[4])
        out, prev_tween = [], False
        for a, b, curves in ivs:
            last = b == N - 1
            span = (N - a) if (curves is None and last) else (b - a)
            hidden = all(S[n][4] <= 0 for n in range(a, min(N, a + span + (0 if curves is None else 1))))
            if curves is None or hidden:
                if hidden and prev_tween:                     # a tween ended here: its end key needs the instance
                    out.append(xfl.frame(a, 1, inst(S[a])))
                    if span > 1: out.append(xfl.frame(a + 1, span - 1, ''))
                elif hidden:
                    out.append(xfl.frame(a, span, ''))
                else:
                    out.append(xfl.frame(a, span, inst(S[a])))
                prev_tween = False
                if curves is not None and last: out.append(xfl.frame(b, 1, ''))
            else:
                out.append(xfl.frame(a, span, inst(S[a]), curves={g: bezier_points(c) for g, c in curves.items()}))
                prev_tween = True
                if last: out.append(xfl.frame(b, 1, inst(S[b])))
        return out

    def assemble(self, names, marks):
        k = self.k
        bg = self.symbol('Chrome/background', [self.rect_shape(0, 0, self.W, self.H, GREEN)])
        conv = {'text': self.conv_text, 'rect': self.conv_rect, 'group': self.conv_group, 'dots': self.conv_dots,
                'brandBox': self.conv_brandbox}
        self.add('Фон', 'Фон', bg, [(1.0, 1.0, 0.0, 0.0, 1.0)] * self.N)
        for c in self.m['comps']:
            conv[c['kind']](c, names.get(c['id'], c['id']))
        # main timeline, top → bottom; one folder per component with more than one layer
        order = self.layers[::-1]
        out, index, i = [], {}, 0
        labels = sorted({int(round(t * self.fps)): name for name, t in marks.items() if name != 'END' and t is not None}.items())
        lx = []
        for j, (f, nm) in enumerate(labels):
            if j == 0 and f > 0: lx.append(xfl.frame(0, f, ''))
            end = labels[j + 1][0] if j + 1 < len(labels) else self.N
            lx.append(xfl.frame(f, end - f, '', name=nm))
        out.append(xfl.layer('Состояния Figma', lx, color='#FF0000'))
        i = 1
        while i - 1 < len(order):
            L = order[i - 1]
            group = [q for q in order if q['folder'] == L['folder']]
            start = len(out)
            if len(group) > 1:
                out.append(xfl.layer(L['folder'], [], kind='folder', open_=False))
                fidx = start
            else:
                fidx = None
            for q in group:
                index[q['id']] = len(out)
                parent = fidx
                if q.get('masked_by'): parent = index[q['masked_by']]
                kind = 'mask' if q['kind'] == 'mask' else ('masked' if q.get('masked_by') else 'normal')
                lay = xfl.layer(q['name'], self.frames_xml(q), kind='normal' if kind == 'masked' else kind, parent=parent,
                                locked=(kind in ('mask', 'masked') or q['name'] == 'Фон'))
                out.append(lay)
            i += len(group)
        self.doc.layers = out


NAMES = {
    'dots': 'Точки', 'dots_full': 'Точки — весь кадр', 'dots_body': 'Точки — тело', 'dots_end': 'Точки — финал',
    'dots_A': 'Точки — F1', 'dots_B': 'Точки — F2–F4', 'dots_C': 'Точки — F5',
    'vyb': 'Выбери', 'big0': 'Есть где', 'big1': 'развернуться', 'ph': 'Есть где развернуться',
    'caret': 'Курсор', 'mk': 'Заплатка', 'm0': 'Заплатка 1', 'm1': 'Заплатка 2', 'm2': 'Заплатка 3',
    'lock': 'Бренд-блок', 'cta': 'Кнопка «Выбрать»', 'legal': 'Реклама', 'zero': '0+', 'hdr': 'Шапка', 'hrule': 'Линия под шапкой',
}
for i in range(9): NAMES['pat%d' % i] = 'ВЫБЕРИ %d' % (i + 1)
for i in range(3):
    NAMES['row%d' % i] = 'ВЫБЕРИ %d' % (i + 1)
    NAMES['dk%d' % i] = 'Тёмная плашка %d' % (i + 1); NAMES['dkT%d' % i] = 'Ответ %d' % (i + 1)
    NAMES['bx%d' % i] = 'Рамка %d' % (i + 1); NAMES['bxT%d' % i] = 'Вариант %d' % (i + 1)


def main():
    src, outdir, sw, sh, name = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
    model = json.load(open(src, encoding='utf-8'))
    b = Build(model, sw, sh, name)
    b.assemble(NAMES, model.get('marks') or {})
    here = os.path.dirname(os.path.abspath(__file__))
    pub = open(os.path.join(here, 'fla_publish.xml'), encoding='utf-8').read().replace('{NAME}', name)
    pub = pub.replace('<Width>450</Width>', '<Width>%d</Width>' % sw).replace('<Height>800</Height>', '<Height>%d</Height>' % sh)
    path = b.doc.write(outdir, pub)
    nkeys = sum(xml.count('<DOMFrame') for xml in b.doc.layers)
    print(path, '%d layers, %d symbols, %d frames, %d keyframes' % (len(b.doc.layers), len(b.doc.symbols), b.N, nkeys))


if __name__ == '__main__':
    main()
