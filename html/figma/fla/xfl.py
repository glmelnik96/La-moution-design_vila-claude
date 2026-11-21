"""xfl.py — write Adobe Animate documents as uncompressed XFL (Animate opens the .xfl and saves the .fla itself).

Schema as Animate 2024 (24.0) writes it for an HTML5 Canvas document: coordinates of shape edges in twips (1/20 px),
instance matrices in px, layers listed top to bottom, a masked layer / folder child points at its parent with
parentLayerIndex, classic tweens are tweenType="motion" with CustomEase curves per property group.
"""
import os, random, time
from xml.sax.saxutils import escape, quoteattr

HTML5_CANVAS_GUID = '3CE50BB6-55CF-47A6-B591-01286DDDC64C'


def num(v, nd=4):
    """Shortest decimal for an attribute (Animate writes '0.5', '325', '0.16')."""
    s = ('%.' + str(nd) + 'f') % v
    s = s.rstrip('0').rstrip('.') if '.' in s else s
    return '0' if s in ('-0', '') else s


def tw(v):
    """px → integer twips for shape edges."""
    return int(round(v * 20))


def hexcol(c):
    if isinstance(c, str):
        c = c.lstrip('#')
        if len(c) == 3: c = ''.join(ch * 2 for ch in c)
        return '#' + c.upper()
    return '#%02X%02X%02X' % tuple(int(round(x)) for x in c[:3])


class Ids:
    def __init__(self):
        self.base = '%08x' % random.getrandbits(32)
        self.n = 0x100

    def next(self):
        self.n += 1
        return '%s-%08x' % (self.base, self.n)


# ───────── shapes ─────────
def fill_style(color, alpha=1.0, index=1):
    a = '' if alpha >= 0.9999 else ' alpha=%s' % quoteattr(num(alpha))
    return '<FillStyle index="%d"><SolidColor color="%s"%s/></FillStyle>' % (index, hexcol(color), a)


def rect_edges(x, y, w, h):
    x0, y0, x1, y1 = tw(x), tw(y), tw(x + w), tw(y + h)
    return '!%d %d|%d %d!%d %d|%d %d!%d %d|%d %d!%d %d|%d %d' % (x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0)


def shape_rects(rects, color, alpha=1.0):
    """One DOMShape with one fill: a list of NON-overlapping rects (x, y, w, h) drawn clockwise (fill on the right)."""
    edges = ''.join('<Edge fillStyle1="1" edges="%s"/>' % rect_edges(*r) for r in rects if r[2] > 0 and r[3] > 0)
    return '<DOMShape><fills>%s</fills><edges>%s</edges></DOMShape>' % (fill_style(color, alpha), edges)


def shape_union(rects, color, alpha=1.0):
    """ONE shape covering the union of axis-aligned rects (a mask layer only uses its first shape): coordinate
    compression, then the boundary between covered and empty cells, every edge with the fill on its right."""
    rs = [tuple(tw(v) for v in (x, y, x + w, y + h)) for x, y, w, h in rects if w > 0 and h > 0]
    if not rs: return ''
    xs = sorted({r[0] for r in rs} | {r[2] for r in rs}); ys = sorted({r[1] for r in rs} | {r[3] for r in rs})
    inside = [[any(r[0] <= xs[i] and xs[i + 1] <= r[2] and r[1] <= ys[j] and ys[j + 1] <= r[3] for r in rs)
               for j in range(len(ys) - 1)] for i in range(len(xs) - 1)]
    cell = lambda i, j: 0 <= i < len(xs) - 1 and 0 <= j < len(ys) - 1 and inside[i][j]
    segs = []
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            if not inside[i][j]: continue
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            if not cell(i, j - 1): segs.append('!%d %d|%d %d' % (x0, y0, x1, y0))
            if not cell(i + 1, j): segs.append('!%d %d|%d %d' % (x1, y0, x1, y1))
            if not cell(i, j + 1): segs.append('!%d %d|%d %d' % (x1, y1, x0, y1))
            if not cell(i - 1, j): segs.append('!%d %d|%d %d' % (x0, y1, x0, y0))
    return '<DOMShape><fills>%s</fills><edges><Edge fillStyle1="1" edges="%s"/></edges></DOMShape>' % (fill_style(color, alpha), ''.join(segs))


def shape_edges(edge_list, color, alpha=1.0):
    """edge_list: [(fill_left, fill_right, 'edges string'), …] with fill ids 0/1 — a prebuilt planar map (glyphs, logos)."""
    out = []
    for f0, f1, e in edge_list:
        a = ''
        if f0: a += ' fillStyle0="%d"' % f0
        if f1: a += ' fillStyle1="%d"' % f1
        out.append('<Edge%s edges="%s"/>' % (a, e))
    return '<DOMShape><fills>%s</fills><edges>%s</edges></DOMShape>' % (fill_style(color, alpha), ''.join(out))


# ───────── text ─────────
FACES = {('display', 400): 'SBSansDisplay-Regular', ('display', 600): 'SBSansDisplay-Semibold',
         ('text', 400): 'SBSansText-Regular', ('text', 500): 'SBSansText-Medium', ('text', 600): 'SBSansText-Semibold'}


def static_text(tx, ty, s, face, size, color='#222222', ls=0.0, width=None, align='left', line_height=None, alpha=1.0):
    """Static text field. (tx, ty) = the text area's top-left (Animate adds its 2 px gutter outside it).
    width None → auto-expanding single line."""
    attrs = ['aliasText="false"']
    if align != 'left': attrs.append('alignment="%s"' % align)
    if ls: attrs.append('letterSpacing="%s"' % num(ls, 2))
    if line_height: attrs.append('lineHeight="%s"' % num(line_height, 2))
    attrs.append('size="%s"' % num(size, 2))
    attrs.append('bitmapSize="%d"' % int(round(size * 20)))
    attrs.append('face="%s"' % face)
    attrs.append('fillColor="%s"' % hexcol(color))
    if alpha < 0.9999: attrs.append('alpha="%s"' % num(alpha))
    w = width if width is not None else 0
    auto = 'true' if width is None else 'false'
    wattr = (' width="%s"' % num(w, 2)) if width is not None else ''
    return ('<DOMStaticText%s autoExpand="%s" isSelectable="false"><matrix><Matrix tx="%s" ty="%s"/></matrix>'
            '<textRuns><DOMTextRun><characters>%s</characters><textAttrs><DOMTextAttrs %s/></textAttrs></DOMTextRun>'
            '</textRuns></DOMStaticText>') % (wattr, auto, num(tx, 3), num(ty, 3), escape(s), ' '.join(attrs))


# ───────── instances / frames / layers ─────────
def matrix_xml(a=1.0, d=1.0, tx=0.0, ty=0.0):
    at = []
    if abs(a - 1) > 1e-7: at.append('a="%s"' % num(a, 6))
    if abs(d - 1) > 1e-7: at.append('d="%s"' % num(d, 6))
    if abs(tx) > 1e-7: at.append('tx="%s"' % num(tx, 3))
    if abs(ty) > 1e-7: at.append('ty="%s"' % num(ty, 3))
    return '<matrix><Matrix %s/></matrix>' % ' '.join(at)


def instance(lib, a=1.0, d=1.0, tx=0.0, ty=0.0, alpha=1.0, blur=None, cache=False, name=None, graphic=False):
    attrs = ' libraryItemName=%s' % quoteattr(lib)
    if name: attrs += ' name=%s' % quoteattr(name)
    if graphic: attrs += ' symbolType="graphic" loop="loop"'
    if cache: attrs += ' cacheAsBitmap="true"'
    inner = matrix_xml(a, d, tx, ty) + '<transformationPoint><Point/></transformationPoint>'
    if blur is not None:
        inner += '<filters><BlurFilter blurX="%s" blurY="0" quality="3"/></filters>' % num(blur, 2)
    if alpha < 0.99995:
        inner += '<color><Color alphaMultiplier="%s"/></color>' % num(max(0.0, alpha), 4)
    return '<DOMSymbolInstance%s>%s</DOMSymbolInstance>' % (attrs, inner)


def ease_points(curves):
    """curves: {'position': [(x, y)…], 'scale': …, 'color': …, 'filters': …} → <tweens> XML."""
    out = []
    for target, pts in curves.items():
        ps = []
        for x, y in pts:
            at = []
            if abs(x) > 1e-9: at.append('x="%s"' % num(x, 6))
            if abs(y) > 1e-9: at.append('y="%s"' % num(y, 6))
            ps.append('<Point %s/>' % ' '.join(at) if at else '<Point/>')
        out.append('<CustomEase target="%s">%s</CustomEase>' % (target, ''.join(ps)))
    return '<tweens>%s</tweens>' % ''.join(out)


def frame(index, duration, elements='', curves=None, name=None):
    attrs = 'index="%d"' % index
    if duration > 1: attrs += ' duration="%d"' % duration
    if name: attrs += ' name=%s labelType="name"' % quoteattr(name)
    body = ''
    if curves is not None:
        attrs += ' tweenType="motion" motionTweenSnap="true" keyMode="17921"'
        if curves:
            attrs += ' useSingleEaseCurve="false" hasCustomEase="true"'
            body += ease_points(curves)
    else:
        attrs += ' keyMode="9728"'
    return '<DOMFrame %s>%s<elements>%s</elements></DOMFrame>' % (attrs, body, elements)


LAYER_COLORS = ['#4F80FF', '#FF4F4F', '#4FFF4F', '#FF9933', '#9933CC', '#00FFFF', '#FF00FF', '#FFCC00']


def layer(name, frames_xml, kind='normal', parent=None, color=None, visible=True, locked=False, open_=True):
    attrs = 'name=%s color="%s" autoNamed="false"' % (quoteattr(name), color or LAYER_COLORS[sum(map(ord, name.split(' — ')[0])) % len(LAYER_COLORS)])
    if kind != 'normal': attrs += ' layerType="%s"' % kind
    if kind == 'folder' and not open_: attrs += ' open="false"'
    if parent is not None: attrs += ' parentLayerIndex="%d"' % parent
    if locked: attrs += ' locked="true"'
    if not visible: attrs += ' visible="false"'
    if kind == 'folder':
        return '<DOMLayer %s/>' % attrs
    return '<DOMLayer %s><frames>%s</frames></DOMLayer>' % (attrs, ''.join(frames_xml))


def symbol_item(name, item_id, layers_xml, graphic=False):
    st = ' symbolType="graphic"' if graphic else ''
    return ('<DOMSymbolItem xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://ns.adobe.com/xfl/2008/" '
            'name=%s itemID="%s"%s lastModified="%d"><timeline><DOMTimeline name=%s>'
            '<layers>%s</layers></DOMTimeline></timeline></DOMSymbolItem>') % (
        quoteattr(name), item_id, st, int(time.time()), quoteattr(name.split('/')[-1]), ''.join(layers_xml))


class Document:
    def __init__(self, width, height, fps, name, background='#FFFFFF'):
        self.w, self.h, self.fps, self.name, self.bg = width, height, fps, name, background
        self.ids = Ids()
        self.symbols = []          # (name, item_id, xml)
        self.folders = []
        self.layers = []           # main timeline layer xml, top to bottom

    def add_symbol(self, name, layers_xml, graphic=False):
        iid = self.ids.next()
        self.symbols.append((name, iid, symbol_item(name, iid, layers_xml, graphic)))
        if '/' in name:
            f = name.rsplit('/', 1)[0]
            if f not in self.folders: self.folders.append(f)
        return name

    def write(self, outdir, publish_settings):
        os.makedirs(os.path.join(outdir, 'LIBRARY'), exist_ok=True)
        os.makedirs(os.path.join(outdir, 'META-INF'), exist_ok=True)
        os.makedirs(os.path.join(outdir, 'bin'), exist_ok=True)
        inc = []
        for name, iid, xml in self.symbols:
            p = os.path.join(outdir, 'LIBRARY', *name.split('/')) + '.xml'
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, 'w', encoding='utf-8', newline='\n').write(xml)
            inc.append('<Include href=%s loadImmediate="false" itemID="%s" lastModified="%d"/>' % (quoteattr(name + '.xml'), iid, int(time.time())))
        folders = ''.join('<DOMFolderItem name=%s itemID="%s"/>' % (quoteattr(f), self.ids.next()) for f in self.folders)
        doc = ('<DOMDocument xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://ns.adobe.com/xfl/2008/" '
               'backgroundColor="%s" width="%s" height="%s" frameRate="%s" currentTimeline="1" xflVersion="23.0" creatorInfo="Adobe Animate" '
               'platform="Windows" versionInfo="Saved by Animate Windows 24.0 build 5" majorVersion="24" buildNumber="5" '
               'nextSceneIdentifier="2" playOptionsPlayLoop="false" playOptionsPlayPages="false" playOptionsPlayFrameActions="false" '
               'filetypeGUID="%s" fileGUID="%032X">'
               '%s<symbols>%s</symbols><timelines><DOMTimeline name="Scene 1" layerDepthEnabled="true"><layers>%s</layers>'
               '</DOMTimeline></timelines><scripts><GlobalScripts language="Javascript"/></scripts><PrinterSettings/><publishHistory/>'
               '</DOMDocument>') % (hexcol(self.bg), num(self.w), num(self.h), num(self.fps), HTML5_CANVAS_GUID, random.getrandbits(128),
                                    ('<folders>%s</folders>' % folders) if folders else '', ''.join(inc), ''.join(self.layers))
        open(os.path.join(outdir, 'DOMDocument.xml'), 'w', encoding='utf-8', newline='\n').write(doc)
        open(os.path.join(outdir, 'PublishSettings.xml'), 'w', encoding='utf-8', newline='\n').write(publish_settings)
        open(os.path.join(outdir, 'META-INF', 'metadata.xml'), 'w').close()
        open(os.path.join(outdir, 'MobileSettings.xml'), 'w').close()
        open(os.path.join(outdir, self.name + '.xfl'), 'w').write('PROXY-CS5')
        open(os.path.join(outdir, 'mimetype'), 'w').write('application/vnd.adobe.xfl')
        return os.path.join(outdir, self.name + '.xfl')
