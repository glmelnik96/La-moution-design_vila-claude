// svgpath.js — the few SVG path commands a logo uses (M L H V C Z, absolute) as AE shape data: per
// sub-path the vertices plus in/out tangents RELATIVE to each vertex, which is what AE's Shape takes.
// No transforms, arcs or relative commands: parseSvg throws on them, so a logo that needs more
// fails loudly instead of drawing garbage.
function tokenize(d) {
  const re = /([MLHVCZmlhvcz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const out = [];
  let m;
  while ((m = re.exec(d))) out.push(m[1] ? m[1] : Number(m[2]));
  return out;
}

function parsePath(d) {
  const t = tokenize(d), subs = [];
  let cur = null, x = 0, y = 0, i = 0, cmd = null;
  const num = () => {
    const v = t[i++];
    if (typeof v !== 'number') throw new Error('svgpath: a number was expected at token ' + (i - 1));
    return v;
  };
  const start = (px, py) => { cur = { vertices: [[px, py]], inTangents: [[0, 0]], outTangents: [[0, 0]], closed: false }; subs.push(cur); x = px; y = py; };
  const lineTo = (px, py) => { cur.vertices.push([px, py]); cur.inTangents.push([0, 0]); cur.outTangents.push([0, 0]); x = px; y = py; };
  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++];
    else if (cmd === 'M') cmd = 'L';                       // numbers after a moveto are linetos
    if (/[mlhvcz]/.test(cmd)) throw new Error('svgpath: relative command ' + cmd + ' is not supported');
    switch (cmd) {
      case 'M': start(num(), num()); break;
      case 'L': lineTo(num(), num()); break;
      case 'H': lineTo(num(), y); break;
      case 'V': lineTo(x, num()); break;
      case 'C': {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), px = num(), py = num();
        cur.outTangents[cur.vertices.length - 1] = [x1 - x, y1 - y];
        cur.vertices.push([px, py]); cur.inTangents.push([x2 - px, y2 - py]); cur.outTangents.push([0, 0]);
        x = px; y = py;
        break;
      }
      case 'Z': {
        cur.closed = true;
        const n = cur.vertices.length - 1, v0 = cur.vertices[0], vn = cur.vertices[n];
        if (n > 0 && Math.abs(v0[0] - vn[0]) < 1e-6 && Math.abs(v0[1] - vn[1]) < 1e-6) {
          cur.inTangents[0] = cur.inTangents[n];            // the closing vertex repeats the first
          cur.vertices.pop(); cur.inTangents.pop(); cur.outTangents.pop();
        }
        x = v0[0]; y = v0[1];
        break;
      }
      default: throw new Error('svgpath: unsupported command ' + cmd);
    }
  }
  return subs;
}

function parseSvg(src) {
  const vb = /viewBox="([^"]+)"/.exec(src);
  const box = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : null;
  if (!box || box.length !== 4) throw new Error('svgpath: a viewBox is required');
  const paths = [], re = /<path\b([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    const a = m[1];
    if (/\stransform=/.test(a)) throw new Error('svgpath: a transform on a path is not supported');
    const d = /\sd="([^"]+)"/.exec(a), fill = /\sfill="([^"]+)"/.exec(a);
    if (d) paths.push({ fill: fill ? fill[1] : '#000000', subpaths: parsePath(d[1]) });
  }
  return { viewBox: box, paths };
}

module.exports = { tokenize, parsePath, parseSvg };
