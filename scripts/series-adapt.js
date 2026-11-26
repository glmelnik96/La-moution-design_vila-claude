'use strict';
const fs = require('node:fs');
const path = require('node:path');

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw Error('Invalid ' + name);
  return value;
}

function frameRate(value) {
  const parts = String(value).split('/');
  if (parts.length > 2 || parts.some(p => !/^\d+$/.test(p))) throw Error('Use an FPS fraction, e.g. 30000/1001');
  const n = integer(Number(parts[0]), 'fps numerator', 1);
  const d = integer(Number(parts[1] ?? 1), 'fps denominator', 1);
  return n / d;
}

function named(obj, key, kind) {
  if (!obj || typeof key !== 'string' || !Object.hasOwn(obj, key)) throw Error('Missing ' + kind + ': ' + key);
  return obj[key];
}

function point(value) {
  return Array.isArray(value) && value.length === 2 &&
    value.every(n => Number.isFinite(n) && n >= 0 && n <= 1);
}

function frameSize(value) {
  return Array.isArray(value) && value.length === 2 &&
    value.every(n => Number.isSafeInteger(n) && n > 0);
}

function nativeTextLayout(recipe, slot, episode, row, content, issues) {
  const spec = slot.textLayout;
  const key = row.layout;
  const variant = typeof key === 'string' && spec?.variants && Object.hasOwn(spec.variants, key)
    ? spec.variants[key] : undefined;
  content.cardId = row.cardId ?? slot.id;
  content.textLayout = {
    variant: key ?? null, space: spec?.space, template: recipe.template,
    templatePosition: spec?.templatePosition, frameSize: variant?.frameSize,
    episodeFrameSize: episode.frameSize, lines: variant?.lines,
    timelinePosition: variant?.position, evidence: variant?.evidence
  };
  if (!variant) {
    issues.push('text_layout_unknown');
    return;
  }
  if (spec.space !== 'normalized-sequence' || typeof recipe.template !== 'string' || !recipe.template.trim() ||
      !point(spec.templatePosition) || !point(variant.position) ||
      !frameSize(variant.frameSize) || !frameSize(episode.frameSize) ||
      typeof variant.evidence !== 'string' || !variant.evidence.trim() ||
      !Number.isSafeInteger(variant.lines) || variant.lines < 1) {
    issues.push('text_layout_unmeasured');
    return;
  }
  const linesMatch = variant.lines === row.lines.length;
  const [w, h] = variant.frameSize;
  const shapeMatches = w * episode.frameSize[1] === h * episode.frameSize[0];
  if (!linesMatch) issues.push('text_layout_lines');
  if (!shapeMatches) issues.push('text_layout_aspect');
  if (linesMatch && shapeMatches) content.textPosition = variant.position;
}

function resolve(recipe, episode) {
  const fps = frameRate(recipe.fps);
  if (frameRate(episode.fps) !== fps) throw Error('Use the same delivery frame rate for recipe and episode');
  const frames = integer(episode.frames, 'episode frames', 1);
  if (!Array.isArray(recipe.slots) || !recipe.slots.length) throw Error('No slots in recipe');
  const seen = new Set();
  const slots = recipe.slots.map(slot => {
    if (typeof slot.id !== 'string' || !slot.id || seen.has(slot.id)) throw Error('Missing or duplicate slot ID');
    seen.add(slot.id);
    const at = edge => {
      const cue = named(episode.cues, edge.cue, 'cue');
      const frame = integer(cue.frame, 'cue frame');
      if (frame > frames) throw Error('Source cue outside episode');
      const offset = integer(edge.offset ?? 0, 'cue offset', Number.MIN_SAFE_INTEGER);
      return frame + offset;
    };
    const start = at(slot.in), stop = at(slot.out);
    if (!(start >= 0 && start < stop && stop <= frames)) throw Error(slot.id + ': slot outside episode or reversed');
    const enter = integer(slot.enterFrames ?? 0, 'enterFrames');
    const exit = integer(slot.exitFrames ?? 0, 'exitFrames');
    const holdStart = start + enter, holdEnd = stop - exit;
    if (holdStart >= holdEnd) throw Error(slot.id + ': entry and exit consume the reading hold');
    const row = named(episode.values, slot.id, 'values');
    const issues = [];
    const content = {};
    const kind = slot.kind ?? 'text';
    if (kind === 'visual') {
      if (typeof row.asset !== 'string' || !row.asset.trim()) throw Error(slot.id + ': specify the visual asset or layer');
      content.asset = row.asset;
      const minimum = integer(slot.minHoldFrames ?? 1, 'minHoldFrames', 1);
      if (holdEnd - holdStart < minimum) issues.push('visual_hold');
    } else if (kind === 'text') {
      const lineLimit = integer(slot.maxLines, 'maxLines', 1);
      if (!Array.isArray(row.lines) || !row.lines.length || !row.lines.every(x => typeof x === 'string' && x.trim() && !/[\r\n]/.test(x))) {
        throw Error(slot.id + ': provide one nonempty string per rendered line');
      }
      const maxRate = slot.maxCharsPerSecond;
      if (!Number.isFinite(maxRate) || maxRate <= 0) throw Error('Invalid maxCharsPerSecond');
      const chars = Array.from(row.lines.join(' ').normalize('NFC')).length;
      const duration = (holdEnd - holdStart) / fps;
      if (slot.maxWidthPx !== undefined) {
        if (!Number.isFinite(slot.maxWidthPx) || slot.maxWidthPx <= 0) throw Error('Invalid maxWidthPx');
        if (!Array.isArray(row.widthsPx) || row.widthsPx.length !== row.lines.length ||
            row.widthsPx.some(width => !Number.isFinite(width) || width <= 0)) throw Error('Supply width in rendered pixels for each line');
        if (row.widthsPx.some(width => width > slot.maxWidthPx)) issues.push('text_width');
      }
      if (row.lines.length > lineLimit) issues.push('line_limit');
      if (chars / duration > maxRate) issues.push('reading_time');
      content.lines = row.lines;
      content.chars = chars;
      content.charsPerSecond = Number((chars / duration).toFixed(3));
      if (Object.hasOwn(slot, 'textLayout')) nativeTextLayout(recipe, slot, episode, row, content, issues);
    } else throw Error('Unknown slot kind: ' + kind);
    const cueChecks = (slot.checkCues ?? []).map(check => {
      if (!['in', 'out'].includes(check.edge) || !Array.isArray(check.window) || check.window.length !== 2) throw Error('Invalid cue check');
      const [min, max] = check.window.map(v => integer(v, 'cue tolerance', Number.MIN_SAFE_INTEGER));
      if (min > max) throw Error('Reversed cue tolerance');
      const frame = integer(named(episode.cues, check.cue, 'cue').frame, 'cue frame');
      if (frame >= frames) throw Error('Review cue outside episode');
      const delta = frame - (check.edge === 'in' ? start : stop);
      if (delta < min || delta > max) issues.push('cue_alignment:' + check.cue);
      return { cue: check.cue, frame, delta };
    });
    const review = [...new Set([start - 1, start, holdStart, Math.floor((holdStart + holdEnd - 1) / 2), holdEnd - 1, stop - 1, stop, ...cueChecks.map(c => c.frame)])]
      .filter(f => f >= 0 && f < frames).sort((a, b) => a - b);
    return { id: slot.id, kind, ...content, range: [start, stop], hold: [holdStart, holdEnd], checkFrames: review, cueChecks, issues };
  });
  return { series: recipe.series, episode: episode.id, fps: recipe.fps, slots, status: slots.some(s => s.issues.length) ? 'review' : 'ready-for-render' };
}

function mogrtCards(output) {
  const ids = new Set();
  const cards = output.slots.filter(s => s.textPosition).map(slot => {
    const id = slot.cardId;
    if (typeof id !== 'string' || !id.trim() || /[<>:"/\\|?*\x00-\x1f]|[. ]$/u.test(id) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/iu.test(id)) throw Error('Invalid card filename: ' + id);
    if (ids.has(id.toLowerCase())) throw Error('Duplicate card filename: ' + id);
    ids.add(id.toLowerCase());
    return { id, text: slot.lines.join('\n'), textPosition: slot.textPosition };
  });
  if (!cards.length) throw Error('--cards-out requires a text slot with a measured textLayout');
  return cards;
}

if (require.main === module) {
  try {
    const [recipe, episode, ...args] = process.argv.slice(2);
    const files = new Map();
    const destinations = new Set();
    const usage = 'Usage: node scripts/series-adapt.js recipe.json episode.json [--out resolved.json] [--cards-out cards.json]';
    if (!recipe || !episode) throw Error(usage);
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i], file = args[i + 1];
      if (!['--out', '--cards-out'].includes(flag) || !file || file.startsWith('--') || files.has(flag)) throw Error(usage);
      const absolute = path.resolve(file);
      const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
      if (destinations.has(key)) throw Error('Use distinct paths for the report and the cards');
      if (fs.existsSync(file)) throw Error('Output already exists: ' + file);
      destinations.add(key);
      files.set(flag, file);
    }
    const load = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    const output = resolve(load(recipe), load(episode));
    const serialize = data => JSON.stringify(data, null, 2) + '\n';
    const cards = files.has('--cards-out') && output.status === 'ready-for-render' ? mogrtCards(output) : null;
    if (files.has('--out')) fs.writeFileSync(files.get('--out'), serialize(output), { flag: 'wx' });
    else process.stdout.write(serialize(output));
    if (cards) fs.writeFileSync(files.get('--cards-out'), serialize(cards), { flag: 'wx' });
    if (output.status === 'review') process.exitCode = 1;
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}

module.exports = { resolve };
