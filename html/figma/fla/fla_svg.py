"""fla_svg.py — SVG path data → XFL shape edges (twips): cubics split into quadratics, fill side from the nonzero winding."""
import math, re

TOK = re.compile(r'[MmLlHhVvCcSsQqTtZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')


def parse(d):
    """→ contours: lists of segments ('L', p0, p1) | ('C', p0, c1, c2, p1); absolute coordinates."""
    toks = TOK.findall(d)
    i, cmd, cur, start, prev_c = 0, None, (0.0, 0.0), (0.0, 0.0), None
    contours, segs = [], []

    def nums(n):
        nonlocal i
        v = [float(t) for t in toks[i:i + n]]; i += n
        return v
    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t):
            cmd = t; i += 1
            if cmd in 'Zz':
                if segs:
                    if math.dist(cur, start) > 1e-9: segs.append(('L', cur, start))
                    contours.append(segs); segs = []
                cur = start; prev_c = None
                continue
        rel = cmd.islower()
        c = cmd.upper()
        if c == 'M':
            x, y = nums(2)
            if rel: x, y = cur[0] + x, cur[1] + y
            if segs:
                if math.dist(cur, start) > 1e-9: segs.append(('L', cur, start))
                contours.append(segs); segs = []
            cur = start = (x, y); prev_c = None
            cmd = 'l' if rel else 'L'
        elif c == 'L':
            x, y = nums(2)
            if rel: x, y = cur[0] + x, cur[1] + y
            segs.append(('L', cur, (x, y))); cur = (x, y); prev_c = None
        elif c == 'H':
            x, = nums(1)
            if rel: x = cur[0] + x
            segs.append(('L', cur, (x, cur[1]))); cur = (x, cur[1]); prev_c = None
        elif c == 'V':
            y, = nums(1)
            if rel: y = cur[1] + y
            segs.append(('L', cur, (cur[0], y))); cur = (cur[0], y); prev_c = None
        elif c == 'C':
            v = nums(6)
            if rel: v = [v[j] + cur[j % 2] for j in range(6)]
            c1, c2, p = (v[0], v[1]), (v[2], v[3]), (v[4], v[5])
            segs.append(('C', cur, c1, c2, p)); cur = p; prev_c = c2
        elif c == 'S':
            v = nums(4)
            if rel: v = [v[j] + cur[j % 2] for j in range(4)]
            c1 = (2 * cur[0] - prev_c[0], 2 * cur[1] - prev_c[1]) if prev_c else cur
            c2, p = (v[0], v[1]), (v[2], v[3])
            segs.append(('C', cur, c1, c2, p)); cur = p; prev_c = c2
        elif c == 'Q':
            v = nums(4)
            if rel: v = [v[j] + cur[j % 2] for j in range(4)]
            q, p = (v[0], v[1]), (v[2], v[3])
            c1 = (cur[0] + 2 / 3 * (q[0] - cur[0]), cur[1] + 2 / 3 * (q[1] - cur[1]))
            c2 = (p[0] + 2 / 3 * (q[0] - p[0]), p[1] + 2 / 3 * (q[1] - p[1]))
            segs.append(('C', cur, c1, c2, p)); cur = p; prev_c = None
        else:
            raise ValueError('unsupported path command ' + cmd)
    if segs:
        if math.dist(cur, start) > 1e-9: segs.append(('L', cur, start))
        contours.append(segs)
    return contours


def transform(contours, fn):
    out = []
    for segs in contours:
        out.append([(s[0],) + tuple(fn(p) for p in s[1:]) for s in segs])
    return out


def _cubic_pt(p0, p1, p2, p3, t):
    u = 1 - t
    return (u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1])


def _split(p0, p1, p2, p3):
    m = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    a, b, c = m(p0, p1), m(p1, p2), m(p2, p3)
    d, e = m(a, b), m(b, c)
    f = m(d, e)
    return (p0, a, d, f), (f, e, c, p3)


def cubic_to_quads(p0, p1, p2, p3, tol, depth=0):
    """[(control, end)] — midpoint approximation, error sqrt(3)/36 * |p3 - 3p2 + 3p1 - p0| ≤ tol."""
    ex = p3[0] - 3 * p2[0] + 3 * p1[0] - p0[0]; ey = p3[1] - 3 * p2[1] + 3 * p1[1] - p0[1]
    if math.hypot(ex, ey) * math.sqrt(3) / 36 <= tol or depth > 12:
        q = ((3 * (p1[0] + p2[0]) - p0[0] - p3[0]) / 4, (3 * (p1[1] + p2[1]) - p0[1] - p3[1]) / 4)
        return [(q, p3)]
    a, b = _split(p0, p1, p2, p3)
    return cubic_to_quads(*a, tol, depth + 1) + cubic_to_quads(*b, tol, depth + 1)


def _polyline(contours):
    polys = []
    for segs in contours:
        pts = []
        for s in segs:
            if s[0] == 'L': pts.append(s[1])
            else:
                for k in range(16): pts.append(_cubic_pt(s[1], s[2], s[3], s[4], k / 16))
        polys.append(pts)
    return polys


def _winding(polys, x, y):
    w = 0
    for pts in polys:
        n = len(pts)
        for i in range(n):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
            if y0 <= y < y1 or y1 <= y < y0:
                xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
                if xi > x: w += 1 if y1 > y0 else -1
    return w


def edges(contours, tol_px=0.02, rule='nonzero'):
    """Contours in px (already transformed) → [(fill0, fill1, edges_string)] with coordinates in twips."""
    polys = _polyline(contours)
    inside = (lambda w: w != 0) if rule == 'nonzero' else (lambda w: w % 2 != 0)
    groups = {}
    for segs in contours:
        for s in segs:
            if s[0] == 'L':
                p0, p1 = s[1], s[2]; mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2); d = (p1[0] - p0[0], p1[1] - p0[1])
                pieces = [('L', p0, p1)]
            else:
                p0, c1, c2, p1 = s[1:]
                mid = _cubic_pt(p0, c1, c2, p1, 0.5)
                a = _cubic_pt(p0, c1, c2, p1, 0.49); b = _cubic_pt(p0, c1, c2, p1, 0.51); d = (b[0] - a[0], b[1] - a[1])
                pieces = [('Q', None, q, e) for q, e in cubic_to_quads(p0, c1, c2, p1, tol_px)]
                pieces[0] = ('Q', p0, pieces[0][2], pieces[0][3])
            L = math.hypot(*d)
            if L < 1e-9: continue
            nx, ny = -d[1] / L, d[0] / L                      # right-hand normal (screen coordinates, y down)
            eps = 0.01
            right = inside(_winding(polys, mid[0] + nx * eps, mid[1] + ny * eps))
            left = inside(_winding(polys, mid[0] - nx * eps, mid[1] - ny * eps))
            if right == left: continue                       # interior or exterior on both sides: no edge
            key = (1 if left else 0, 1 if right else 0)
            g = groups.setdefault(key, [])
            if s[0] == 'L':
                g.append(('L', p0, p1))
            else:
                start = p0
                for _, _, q, e in pieces:
                    g.append(('Q', start, q, e)); start = e
    out = []
    T = lambda p: (int(round(p[0] * 20)), int(round(p[1] * 20)))
    for key, segs in groups.items():
        s, last = [], None
        for seg in segs:
            a = T(seg[1])
            if seg[0] == 'L':
                b = T(seg[2])
                if a == b: continue
                if a != last: s.append('!%d %d' % a)
                s.append('|%d %d' % b); last = b
            else:
                q, b = T(seg[2]), T(seg[3])
                if a == b: continue
                if a != last: s.append('!%d %d' % a)
                s.append('[%d %d %d %d' % (q[0], q[1], b[0], b[1])); last = b
        if s: out.append((key[0], key[1], ''.join(s)))
    return out


def parse_transform(tr):
    """'translate(a b) scale(k)' → fn(p) (the only forms fig.js writes)."""
    tx = ty = 0.0; k = 1.0
    if tr:
        m = re.search(r'translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)', tr)
        if m: tx, ty = float(m.group(1)), float(m.group(2))
        m = re.search(r'scale\(([-\d.e]+)\)', tr)
        if m: k = float(m.group(1))
    return lambda p: (p[0] * k + tx, p[1] * k + ty)
