// ae-mock.js — a small, deliberately strict imitation of the After Effects scripting DOM.
//
// Used by lib.test.js to run scripts/lib/cloudru-motion.jsx WITHOUT After Effects. It models
// the parts of the DOM the library touches and reproduces the live-verified traps from
// reference/ae-quirks.md so that a regression in the lib fails here first:
//   #9  TextDocument is detached after setValue — mutate the live doc read back from .value
//   #12/#18 temporal-ease arity: spatial props take ONE ease, text Scale is 3-D, shape Scale 2-D
//   #5  spatial tangents must be 3-element vectors
//   #14 inPoint on a source-less layer SHIFTS (duration preserved); outPoint trims
//   #21 (not modelled — the lint covers it)
// It is NOT a renderer: sourceRectAtTime is a crude estimate from string length and font size.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function makeEnum(names) { const o = {}; names.forEach((n, i) => { o[n] = i + 1; }); return o; }

const KeyframeInterpolationType = makeEnum(['LINEAR', 'BEZIER', 'HOLD']);
const PropertyValueType = makeEnum(['NO_VALUE', 'ThreeD_SPATIAL', 'ThreeD', 'TwoD_SPATIAL', 'TwoD', 'OneD', 'COLOR', 'CUSTOM_VALUE', 'MARKER', 'LAYER_INDEX', 'MASK_INDEX', 'SHAPE', 'TEXT_DOCUMENT']);
const PropertyType = makeEnum(['PROPERTY', 'INDEXED_GROUP', 'NAMED_GROUP']);
const MaskMode = makeEnum(['NONE', 'ADD', 'SUBTRACT', 'INTERSECT', 'LIGHTEN', 'DARKEN', 'DIFFERENCE']);
const ParagraphJustification = makeEnum(['LEFT_JUSTIFY', 'RIGHT_JUSTIFY', 'CENTER_JUSTIFY', 'FULL_JUSTIFY_LASTLINE_LEFT']);
const TrackMatteType = makeEnum(['NO_TRACK_MATTE', 'ALPHA', 'ALPHA_INVERTED', 'LUMA', 'LUMA_INVERTED']);

class KeyframeEase { constructor(speed, influence) {
  if (influence < 0.1 || influence > 100) throw new Error('KeyframeEase influence out of range: ' + influence);
  this.speed = speed; this.influence = influence; } }
class Shape { constructor() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = false; } }

// ---- Property ----
class Property {
  constructor(name, matchName, value, valueType) {
    this.name = name; this.matchName = matchName; this._value = value; this.propertyValueType = valueType;
    this.propertyType = PropertyType.PROPERTY;
    this.keys = []; this.expression = ''; this.expressionEnabled = false; this.expressionError = '';
    this.numProperties = 0;
  }
  get value() { return this._clone(this._value); }
  get numKeys() { return this.keys.length; }
  _clone(v) { return Array.isArray(v) ? v.slice() : (v && typeof v === 'object' && !(v instanceof Shape) ? Object.assign({}, v) : v); }
  _dims() {
    if (this.propertyValueType === PropertyValueType.TwoD_SPATIAL || this.propertyValueType === PropertyValueType.ThreeD_SPATIAL) return 1;
    return Array.isArray(this._value) ? this._value.length : 1;
  }
  _isSpatial() { return this.propertyValueType === PropertyValueType.TwoD_SPATIAL || this.propertyValueType === PropertyValueType.ThreeD_SPATIAL; }
  setValue(v) {
    if (this.propertyValueType === PropertyValueType.COLOR) {
      if (!Array.isArray(v) || (v.length !== 3 && v.length !== 4)) throw new Error('Color needs 3 or 4 components (' + this.name + ')');
      this._value = v.length === 3 ? v.concat([1]) : v.slice(); return;
    }
    if (Array.isArray(this._value) && Array.isArray(v) && v.length !== this._value.length && this.propertyValueType !== PropertyValueType.CUSTOM_VALUE) {
      throw new Error('Value array does not have ' + this._value.length + ' elements (' + this.name + ')');
    }
    this._value = this._clone(v);
  }
  setValueAtTime(t, v) {
    if (this.propertyValueType === PropertyValueType.COLOR && Array.isArray(v) && v.length === 3) v = v.concat([1]);
    if (Array.isArray(this._value) && Array.isArray(v) && v.length !== this._value.length) {
      throw new Error('Value array does not have ' + this._value.length + ' elements (' + this.name + ')');
    }
    const existing = this.keys.find(k => Math.abs(k.time - t) < 1e-6);
    const d = this._dims();
    const mk = () => { const a = []; for (let i = 0; i < d; i++) a.push(new KeyframeEase(0, 16.666666)); return a; };
    if (existing) { existing.value = this._clone(v); return; }
    this.keys.push({ time: t, value: this._clone(v), inType: KeyframeInterpolationType.LINEAR, outType: KeyframeInterpolationType.LINEAR,
      inEase: mk(), outEase: mk(), inTan: [0, 0, 0], outTan: [0, 0, 0], autoBezier: this._isSpatial() });
    this.keys.sort((a, b) => a.time - b.time);
  }
  _k(i) { if (i < 1 || i > this.keys.length) throw new Error('key index out of range: ' + i); return this.keys[i - 1]; }
  keyTime(i) { return this._k(i).time; }
  keyValue(i) { return this._clone(this._k(i).value); }
  nearestKeyIndex(t) {
    let best = 1, bd = Infinity;
    this.keys.forEach((k, i) => { const d = Math.abs(k.time - t); if (d < bd) { bd = d; best = i + 1; } });
    return best;
  }
  setInterpolationTypeAtKey(i, inT, outT) { const k = this._k(i); k.inType = inT; k.outType = outT === undefined ? inT : outT; }
  keyInInterpolationType(i) { return this._k(i).inType; }
  keyOutInterpolationType(i) { return this._k(i).outType; }
  setTemporalEaseAtKey(i, inE, outE) {
    const d = this._dims();
    if (!Array.isArray(inE) || inE.length !== d) throw new Error('Unable to call "setTemporalEaseAtKey" because of parameter 2. Value array does not have ' + d + ' elements.');
    if (!Array.isArray(outE) || outE.length !== d) throw new Error('Unable to call "setTemporalEaseAtKey" because of parameter 3. Value array does not have ' + d + ' elements.');
    const k = this._k(i); k.inEase = inE.slice(); k.outEase = outE.slice();
  }
  keyInTemporalEase(i) { return this._k(i).inEase.slice(); }
  keyOutTemporalEase(i) { return this._k(i).outEase.slice(); }
  setSpatialAutoBezierAtKey(i, b) { if (!this._isSpatial()) throw new Error('not spatial'); this._k(i).autoBezier = b; }
  setSpatialTangentsAtKey(i, inT, outT) {
    if (!this._isSpatial()) throw new Error('not spatial');
    if (inT.length !== 3 || outT.length !== 3) throw new Error('Value array does not have 3 elements.');
    const k = this._k(i); k.inTan = inT.slice(); k.outTan = outT.slice();
  }
  keyInSpatialTangent(i) { return this._k(i).inTan.slice(); }
  keyOutSpatialTangent(i) { return this._k(i).outTan.slice(); }
  valueAtTime(t) {
    if (!this.keys.length) return this.value;
    if (t <= this.keys[0].time) return this._clone(this.keys[0].value);
    for (let i = 0; i < this.keys.length - 1; i++) {
      const a = this.keys[i], b = this.keys[i + 1];
      if (t >= a.time && t <= b.time) {
        if (a.outType === KeyframeInterpolationType.HOLD) return this._clone(a.value);
        const u = (t - a.time) / (b.time - a.time);
        if (Array.isArray(a.value)) return a.value.map((x, j) => x + (b.value[j] - x) * u);
        if (typeof a.value === 'number') return a.value + (b.value - a.value) * u;
        return this._clone(a.value);
      }
    }
    return this._clone(this.keys[this.keys.length - 1].value);
  }
}

// ---- PropertyGroup ----
class PropertyGroup {
  constructor(name, matchName, type) {
    this.name = name; this.matchName = matchName; this.propertyType = type || PropertyType.NAMED_GROUP; this.children = [];
  }
  get numProperties() { return this.children.length; }
  property(x) {
    if (typeof x === 'number') return this.children[x - 1] || null;
    return this.children.find(c => c.matchName === x || c.name === x) || null;
  }
  _add(child) { this.children.push(child); return child; }
  addProperty(matchName) {
    const f = FACTORY[matchName];
    if (!f) throw new Error('addProperty: unknown matchName ' + matchName);
    return this._add(f());
  }
}

const P = (n, m, v, t) => new Property(n, m, v, t);
const FACTORY = {
  'ADBE Vector Group': () => {
    const g = new PropertyGroup('Group', 'ADBE Vector Group');
    g._add(new PropertyGroup('Contents', 'ADBE Vectors Group', PropertyType.INDEXED_GROUP));
    const tr = g._add(new PropertyGroup('Transform', 'ADBE Vector Transform Group'));
    tr._add(P('Anchor Point', 'ADBE Vector Anchor', [0, 0], PropertyValueType.TwoD));
    tr._add(P('Position', 'ADBE Vector Position', [0, 0], PropertyValueType.TwoD));
    tr._add(P('Scale', 'ADBE Vector Scale', [100, 100], PropertyValueType.TwoD));
    tr._add(P('Rotation', 'ADBE Vector Rotation', 0, PropertyValueType.OneD));
    tr._add(P('Opacity', 'ADBE Vector Group Opacity', 100, PropertyValueType.OneD));
    return g;
  },
  'ADBE Vector Shape - Rect': () => {
    const g = new PropertyGroup('Rectangle Path', 'ADBE Vector Shape - Rect');
    g._add(P('Size', 'ADBE Vector Rect Size', [100, 100], PropertyValueType.TwoD));
    g._add(P('Position', 'ADBE Vector Rect Position', [0, 0], PropertyValueType.TwoD));
    g._add(P('Roundness', 'ADBE Vector Rect Roundness', 0, PropertyValueType.OneD));
    return g;
  },
  'ADBE Vector Shape - Group': () => {
    const g = new PropertyGroup('Path', 'ADBE Vector Shape - Group');
    g._add(P('Path', 'ADBE Vector Shape', new Shape(), PropertyValueType.SHAPE));
    return g;
  },
  'ADBE Vector Graphic - Fill': () => {
    const g = new PropertyGroup('Fill', 'ADBE Vector Graphic - Fill');
    g._add(P('Color', 'ADBE Vector Fill Color', [1, 1, 1, 1], PropertyValueType.COLOR));
    g._add(P('Opacity', 'ADBE Vector Fill Opacity', 100, PropertyValueType.OneD));
    return g;
  },
  'ADBE Vector Graphic - Stroke': () => {
    const g = new PropertyGroup('Stroke', 'ADBE Vector Graphic - Stroke');
    g._add(P('Color', 'ADBE Vector Stroke Color', [1, 1, 1, 1], PropertyValueType.COLOR));
    g._add(P('Stroke Width', 'ADBE Vector Stroke Width', 2, PropertyValueType.OneD));
    g._add(P('Line Cap', 'ADBE Vector Stroke Line Cap', 1, PropertyValueType.OneD));
    g._add(P('Line Join', 'ADBE Vector Stroke Line Join', 1, PropertyValueType.OneD));
    return g;
  },
  'ADBE Vector Filter - Repeater': () => {
    const g = new PropertyGroup('Repeater', 'ADBE Vector Filter - Repeater');
    g._add(P('Copies', 'ADBE Vector Repeater Copies', 3, PropertyValueType.OneD));
    const tr = g._add(new PropertyGroup('Transform', 'ADBE Vector Repeater Transform'));
    tr._add(P('Position', 'ADBE Vector Repeater Position', [100, 0], PropertyValueType.TwoD));
    return g;
  },
  'ADBE Vector Filter - Trim': () => {
    const g = new PropertyGroup('Trim Paths', 'ADBE Vector Filter - Trim');
    g._add(P('Start', 'ADBE Vector Trim Start', 0, PropertyValueType.OneD));
    g._add(P('End', 'ADBE Vector Trim End', 100, PropertyValueType.OneD));
    g._add(P('Offset', 'ADBE Vector Trim Offset', 0, PropertyValueType.OneD));
    return g;
  },
  'ADBE Mask Atom': () => {
    const g = new PropertyGroup('Mask 1', 'ADBE Mask Atom');
    g.maskMode = MaskMode.ADD;
    g._add(P('Mask Path', 'ADBE Mask Shape', new Shape(), PropertyValueType.SHAPE));
    return g;
  },
  'ADBE Slider Control': () => {
    const g = new PropertyGroup('Slider Control', 'ADBE Slider Control');
    g._add(P('Slider', 'ADBE Slider Control-0001', 0, PropertyValueType.OneD));
    return g;
  },
  'ADBE Fill': () => {
    const g = new PropertyGroup('Fill', 'ADBE Fill');
    g._add(P('Fill Mask', 'ADBE Fill-0001', 0, PropertyValueType.OneD));
    g._add(P('Color', 'ADBE Fill-0002', [1, 0, 0, 1], PropertyValueType.COLOR));
    return g;
  },
  'ADBE Text Animator': () => {
    const g = new PropertyGroup('Animator 1', 'ADBE Text Animator');
    g._add(new PropertyGroup('Range Selectors', 'ADBE Text Selectors', PropertyType.INDEXED_GROUP));
    g._add(new PropertyGroup('Properties', 'ADBE Text Animator Properties'));
    return g;
  },
  'ADBE Text Selector': () => {
    const g = new PropertyGroup('Range Selector 1', 'ADBE Text Selector');
    g._add(P('Start', 'ADBE Text Percent Start', 0, PropertyValueType.OneD));
    g._add(P('End', 'ADBE Text Percent End', 100, PropertyValueType.OneD));
    g._add(P('Offset', 'ADBE Text Percent Offset', 0, PropertyValueType.OneD));
    return g;
  },
  'ADBE Text Position 3D': () => P('Position', 'ADBE Text Position 3D', [0, 0, 0], PropertyValueType.ThreeD),
  'ADBE Text Opacity': () => P('Opacity', 'ADBE Text Opacity', 100, PropertyValueType.OneD)
};

// ---- TextDocument (quirk #9) ----
class TextDocument {
  constructor(text) { this.text = text; this.font = 'ArialMT'; this.fontSize = 36; this.fillColor = [0, 0, 0]; this.applyFill = true; this.applyStroke = false; this.tracking = 0; this.justification = ParagraphJustification.LEFT_JUSTIFY; this.autoLeading = true; this.leading = 0; this._attached = false; }
}
const AVAILABLE_FONTS = ['ArialMT', 'Arial-BoldMT', 'SBSansDisplay-Regular', 'SBSansDisplay-SemiBold', 'SBSansDisplay-Medium', 'SBSansDisplay-Bold', 'Verdana', 'Verdana-Bold'];

class TextProperty extends Property {
  constructor() { super('Source Text', 'ADBE Text Document', null, PropertyValueType.TEXT_DOCUMENT); this._doc = new TextDocument(''); }
  get value() { const live = Object.assign(new TextDocument(''), this._doc); live._attached = true; return live; }
  setValue(doc) {
    if (this._doc._attached === false && doc._attached === false && doc !== this._doc && this._doc.text !== '') {
      throw new Error('Unable to set value as it is not associated with a layer');
    }
    const font = AVAILABLE_FONTS.indexOf(doc.font) !== -1 ? doc.font : 'ArialMT';   // silent fallback
    this._doc = Object.assign(new TextDocument(''), doc, { font, _attached: true });
  }
}

// ---- Layers ----
let layerSerial = 0;
class Layer {
  constructor(comp, name, kind) {
    this.comp = comp; this.name = name; this.kind = kind; this.comment = ''; this.enabled = true; this.parent = null;
    this.threeDLayer = false; this.motionBlur = false; this.adjustmentLayer = false; this.trackMatteType = TrackMatteType.NO_TRACK_MATTE;
    this._in = 0; this._out = comp.duration; this.startTime = 0; this.id = ++layerSerial;
    this.groups = [];
    const tr = this._add(new PropertyGroup('Transform', 'ADBE Transform Group'));
    tr._add(P('Anchor Point', 'ADBE Anchor Point', [0, 0], PropertyValueType.TwoD));
    tr._add(P('Position', 'ADBE Position', [0, 0], PropertyValueType.TwoD_SPATIAL));
    tr._add(P('Scale', 'ADBE Scale', kind === 'text' ? [100, 100, 100] : [100, 100], kind === 'text' ? PropertyValueType.ThreeD : PropertyValueType.TwoD));
    tr._add(P('Rotation', 'ADBE Rotate Z', 0, PropertyValueType.OneD));
    tr._add(P('Opacity', 'ADBE Opacity', 100, PropertyValueType.OneD));
    this._add(new PropertyGroup('Effects', 'ADBE Effect Parade', PropertyType.INDEXED_GROUP));
    this._add(new PropertyGroup('Masks', 'ADBE Mask Parade', PropertyType.INDEXED_GROUP));
    if (kind === 'shape') this._add(new PropertyGroup('Contents', 'ADBE Root Vectors Group', PropertyType.INDEXED_GROUP));
    if (kind === 'text') {
      const tp = this._add(new PropertyGroup('Text', 'ADBE Text Properties'));
      tp._add(new TextProperty());
      tp._add(new PropertyGroup('Animators', 'ADBE Text Animators', PropertyType.INDEXED_GROUP));
    }
  }
  _add(g) { this.groups.push(g); return g; }
  get numProperties() { return this.groups.length; }
  property(x) { if (typeof x === 'number') return this.groups[x - 1]; return this.groups.find(g => g.matchName === x || g.name === x) || null; }
  get index() { return this.comp._layers.indexOf(this) + 1; }
  get inPoint() { return this._in; }
  // quirk #14: for source-less layers the inPoint setter SHIFTS the layer, preserving duration
  set inPoint(t) { const d = this._out - this._in; this._in = t; this._out = t + d; }
  get outPoint() { return this._out; }
  set outPoint(t) { this._out = t; }
  remove() { this.comp._layers.splice(this.comp._layers.indexOf(this), 1); }
  moveBefore(L) { this.remove(); this.comp._layers.splice(this.comp._layers.indexOf(L), 0, this); }
  moveAfter(L) { this.remove(); this.comp._layers.splice(this.comp._layers.indexOf(L) + 1, 0, this); }
  moveToBeginning() { this.remove(); this.comp._layers.unshift(this); }
  moveToEnd() { this.remove(); this.comp._layers.push(this); }
  setTrackMatte(L, type) { this.trackMatteType = type; this._matte = L; }
  sourceRectAtTime() {
    if (this.kind === 'text') {
      const d = this.property('ADBE Text Properties').property('ADBE Text Document')._doc;
      const w = d.text.length * d.fontSize * 0.58, h = d.fontSize * 1.0;
      return { left: 0, top: -d.fontSize * 0.75, width: w, height: h };
    }
    if (this.kind === 'solid') return { left: 0, top: 0, width: this.w, height: this.h };
    // shape: bounding box of all rect/path contents (crude)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (g) => {
      for (let i = 1; i <= g.numProperties; i++) {
        const c = g.property(i);
        if (c.matchName === 'ADBE Vector Shape - Rect') {
          const s = c.property('ADBE Vector Rect Size').value, p = c.property('ADBE Vector Rect Position').value;
          minX = Math.min(minX, p[0] - s[0] / 2); maxX = Math.max(maxX, p[0] + s[0] / 2);
          minY = Math.min(minY, p[1] - s[1] / 2); maxY = Math.max(maxY, p[1] + s[1] / 2);
        } else if (c.matchName === 'ADBE Vector Shape - Group') {
          c.property('ADBE Vector Shape').value.vertices.forEach(v => { minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]); minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]); });
        } else if (c instanceof PropertyGroup) walk(c);
      }
    };
    walk(this.property('ADBE Root Vectors Group'));
    if (minX === Infinity) return { left: 0, top: 0, width: 0, height: 0 };
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  }
}

class LayerCollection {
  constructor(comp) { this.comp = comp; }
  _push(L) { this.comp._layers.unshift(L); return L; }   // new layers go on TOP (index 1) — quirk #23
  addText(str) { const L = this._push(new Layer(this.comp, str, 'text')); L.property('ADBE Text Properties').property('ADBE Text Document').setValue(Object.assign(new TextDocument(str), { _attached: true })); return L; }
  addBoxText(size, str) { const L = this.addText(str); L.boxText = size; return L; }
  addShape() { return this._push(new Layer(this.comp, 'Shape Layer', 'shape')); }
  addSolid(color, name, w, h) { const L = this._push(new Layer(this.comp, name, 'solid')); L.w = w; L.h = h; L.color = color; return L; }
  addNull() { return this._push(new Layer(this.comp, 'Null', 'null')); }
}

class CompItem {
  constructor(name, w, h, par, dur, fps) {
    this.name = name; this.width = w; this.height = h; this.duration = dur; this.frameRate = fps; this.frameDuration = 1 / fps;
    this._layers = []; this.layers = new LayerCollection(this); this.resolutionFactor = [1, 1]; this.time = 0; this.saved = [];
  }
  get numLayers() { return this._layers.length; }
  layer(i) { if (typeof i === 'string') return this._layers.find(l => l.name === i); return this._layers[i - 1]; }
  saveFrameToPng(t, file) { this.saved.push({ t, path: file.fsName, res: this.resolutionFactor.slice() }); }
}

class File { constructor(p) { this.fsName = p; this.exists = false; } }
class Folder { constructor(p) { this.fsName = p; } }
Folder.temp = new Folder('/tmp/ae-mock');

function makeApp() {
  const items = [];
  const app = {
    undo: [],
    beginUndoGroup(l) { this.undo.push(['begin', l]); },
    endUndoGroup() { this.undo.push(['end']); },
    project: {
      activeItem: null,
      get numItems() { return items.length; },
      item(i) { return items[i - 1]; },
      items: { addComp(name, w, h, par, dur, fps) { const c = new CompItem(name, w, h, par, dur, fps); items.push(c); return c; } }
    }
  };
  return app;
}

// Build a sandbox with the mock globals and the lib prelude loaded.
function sandbox() {
  const app = makeApp();
  const ctx = {
    app, CompItem, File, Folder, KeyframeEase, KeyframeInterpolationType, PropertyValueType, PropertyType,
    MaskMode, ParagraphJustification, TrackMatteType, Shape, console
  };
  vm.createContext(ctx);
  const prelude = ['es-json.jsx', 'lib/tokens.jsx', 'lib/cloudru-motion.jsx']
    .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  vm.runInContext(prelude, ctx, { filename: 'prelude.jsx' });
  ctx.run = (src) => vm.runInContext(src, ctx, { filename: 'payload.jsx' });
  return ctx;
}

module.exports = { sandbox, CompItem, Layer, Property, PropertyGroup, KeyframeEase, KeyframeInterpolationType, PropertyValueType };
