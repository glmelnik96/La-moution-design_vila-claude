// gfx-kit-cloudru.jsx — the Cloud.ru graphics kit: one TPL_<type> comp per graphic type, built by code
// into the film's own project (no binary .aep in the repo). Every template keeps the contract of
// reference/gfx-for-edit.md: TXT_<FIELD> text layers at the top level, BOX_<FIELD> guide boxes the
// text must fit, comp markers "in" (entrance done) and "out" (exit starts), no audio.
// Brand: straight corners, one green accent per frame, token eases, exits ~70 % of the entrance,
// SB Sans Display under its real PostScript names. Plates size themselves to the slot's text by
// expression, measured at the template's middle so a plate does not breathe while the text moves.
// Loaded after the lib (CR, M) and gfx.jsx (G). ES3.
var K = {};
K.FPS = 25;
K.GUIDE = [1, 0, 1];
K.TYPES = ["lower_third", "quote", "callout", "logo", "chapter", "intro", "outro"];
// every field a template can take, required or optional: the contract check uses these
K.FIELDS = { lower_third: ["name", "role"], quote: ["quote", "author"], callout: ["value", "caption"], logo: [],
  chapter: ["title", "subtitle", "number"], intro: ["title", "subtitle"], outro: ["title", "subtitle"] };

K.font = function (ps) {
  if (!G.fontOk(ps)) { throw new Error("font not installed, AE would substitute it: " + ps); }
  return ps;
};
K.start = function (type, frames, folder) {
  var c = M.ensureComp("TPL_" + type, "1080p", frames / K.FPS);
  c.duration = frames / K.FPS;
  if (folder) { c.parentFolder = folder; }
  M.clean();
  var mp = c.markerProperty;
  while (mp.numKeys > 0) { mp.removeKey(1); }
  return c;
};
K.marks = function (c, inMs, outMs) {
  c.markerProperty.setValueAtTime(M.f(inMs), new MarkerValue("in"));
  c.markerProperty.setValueAtTime(M.f(outMs), new MarkerValue("out"));
};
K.box = function (field, x, y, w, h) {
  var B = M.rect("BOX_" + field, x, y, w, h, K.GUIDE);
  B.guideLayer = true;
  return B;
};
K.txt = function (field, sample, o) {
  o.font = K.font(o.font);
  return M.text("TXT_" + field, sample, o);
};
// Expression prelude: lft/rgt/top/bot = the ink box of some text layers at the template's middle.
K.ink = function (names) {
  var q = [], i;
  for (i = 0; i < names.length; i++) { q.push("\"" + names[i] + "\""); }
  return "var t = thisComp.duration / 2, lft = 1e9, rgt = -1e9, top = 1e9, bot = -1e9, n = [" + q.join(",") + "];\n" +
    "for (var i = 0; i < n.length; i++) {\n" +
    "  var L = thisComp.layer(n[i]), b = L.sourceRectAtTime(t, false);\n" +
    "  if (b.width < 2) continue;\n" +
    "  var p = L.transform.position.valueAtTime(t), a = L.transform.anchorPoint.valueAtTime(t), s = L.transform.scale.valueAtTime(t);\n" +
    "  lft = Math.min(lft, p[0] + (b.left - a[0]) * s[0] / 100); rgt = Math.max(rgt, p[0] + (b.left + b.width - a[0]) * s[0] / 100);\n" +
    "  top = Math.min(top, p[1] + (b.top - a[1]) * s[1] / 100); bot = Math.max(bot, p[1] + (b.top + b.height - a[1]) * s[1] / 100);\n" +
    "}\n";
};
// A plate whose rectangle follows the text (the expressions end in the value they return). Create
// the text layers first: the expressions look them up by name.
K.plate = function (name, x, y, w, h, color, anchor, sizeExpr, posExpr) {
  var P = M.rule(name, x, y, w, h, color, anchor);
  var r = M.inner(M.groupByName(P, "rect")).property("ADBE Vector Shape - Rect");
  r.property("ADBE Vector Rect Size").expression = sizeExpr;
  r.property("ADBE Vector Rect Position").expression = posExpr;
  return P;
};
// Position the layer just under another text layer's ink (quote author, chapter/intro subtitle).
K.below = function (L, above, gap) {
  M.pos(L).expression = "var q = thisComp.layer(\"" + above + "\"), t = thisComp.duration / 2, b = q.sourceRectAtTime(t, false), p = q.transform.position.valueAtTime(t);\n" +
    "[value[0], p[1] + b.top + b.height + " + gap + "]";
};
// The logo as native shapes (paths parsed in node by lib/svgpath.js, passed in as data): one group
// per SVG path with its fill, scaled to h px tall, top-left at (x, y). Groups are re-resolved by
// name after every addProperty (quirk 3).
K.logoShape = function (name, data, x, y, h) {
  var S = M.shape(name), s = h / data.h, i, j, k;
  for (i = 0; i < data.paths.length; i++) {
    M.group(S, "p" + i);
    for (j = 0; j < data.paths[i].subpaths.length; j++) {
      var sp = data.paths[i].subpaths[j], sh = new Shape(), v = [], ti = [], to = [];
      for (k = 0; k < sp.vertices.length; k++) {
        v.push([x + sp.vertices[k][0] * s, y + sp.vertices[k][1] * s]);
        ti.push([sp.inTangents[k][0] * s, sp.inTangents[k][1] * s]);
        to.push([sp.outTangents[k][0] * s, sp.outTangents[k][1] * s]);
      }
      sh.vertices = v; sh.inTangents = ti; sh.outTangents = to; sh.closed = sp.closed;
      M.inner(M.groupByName(S, "p" + i)).addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(sh);
    }
    M.fill(M.inner(M.groupByName(S, "p" + i)), data.paths[i].color);
  }
  return S;
};
K.exit = function (layers, ms0) {
  M.stagger(layers, ms0, 40, function (L, ms) { M.fadeOut(L, ms, { dur: 280 }); });
};

K.lower_third = function (folder) {
  var c = K.start("lower_third", 100, folder);
  // baselines 878/930: 30 px of plate above the name's caps and below the role (art pass 2026-09-25)
  var role = K.txt("ROLE", "Роль, компания", { size: 32, font: CR.FONT.REGULAR, color: CR.COLOR.GRAY, x: 168, y: 930 });
  var nm = K.txt("NAME", "Имя Фамилия", { size: 52, font: CR.FONT.SEMIBOLD, color: CR.COLOR.WHITE, x: 168, y: 878 });
  K.box("NAME", 168, 830, 1000, 64);
  K.box("ROLE", 168, 902, 1000, 40);
  var ink = K.ink(["TXT_NAME", "TXT_ROLE"]);
  var P = K.plate("PLATE", 120, 812, 600, 148, CR.COLOR.BLACK, "left",
    ink + "[Math.max(360, rgt + 48 - 120), value[1]]",
    ink + "var w = Math.max(360, rgt + 48 - 120);\n[120 + w / 2, value[1]]");
  P.moveToEnd();
  var bar = M.rule("BAR", 120, 812, 8, 148, CR.COLOR.GREEN, "top");
  bar.moveBefore(P);
  M.tween(M.scale(bar), 0, 320, [100, 0], [100, 100], "enter");
  M.tween(M.scale(P), 80, 520, [0, 100], [100, 100], "wipe");
  M.slideIn(nm, 240, { dx: 24, dy: 0 });
  M.slideIn(role, 320, { dx: 24, dy: 0 });
  K.exit([role, nm, P, bar], 3400);
  K.marks(c, 800, 3400);
  return c;
};

K.quote = function (folder) {
  var c = K.start("quote", 125, folder);
  var au = K.txt("AUTHOR", "Автор", { size: 30, font: CR.FONT.REGULAR, color: CR.COLOR.GRAY, x: 168, y: 990 });
  var q = K.txt("QUOTE", "Ключевая мысль\rв две строки", { size: 54, font: CR.FONT.BOLD, color: CR.COLOR.WHITE, x: 168, y: 850, leading: 64 });
  K.below(au, "TXT_QUOTE", 44);
  K.box("QUOTE", 168, 800, 1584, 200);
  K.box("AUTHOR", 168, 860, 1584, 190);
  var ink = K.ink(["TXT_QUOTE", "TXT_AUTHOR"]);
  var P = K.plate("PLATE", 120, 772, 1000, 240, CR.COLOR.BLACK, "left",
    ink + "[Math.max(480, rgt + 56 - 120), Math.max(140, bot + 40 - 772)]",
    ink + "var w = Math.max(480, rgt + 56 - 120), h = Math.max(140, bot + 40 - 772);\n[120 + w / 2, 772 + h / 2]");
  P.moveToEnd();
  var rule = M.rule("RULE", 120, 766, 96, 6, CR.COLOR.GREEN, "left");
  rule.moveBefore(P);
  M.tween(M.scale(P), 0, 480, [0, 100], [100, 100], "wipe");
  M.tween(M.scale(rule), 160, 560, [0, 100], [100, 100], "enter");
  M.slideIn(q, 240, { dx: 0, dy: 32, dur: CR.MS.SLOW });
  M.fadeIn(au, 700, { dur: 400 });
  K.exit([au, q, rule, P], 4400);
  K.marks(c, 1200, 4400);
  return c;
};

K.callout = function (folder) {
  var c = K.start("callout", 75, folder);
  // top at 136: at 96 the plate sat right under the logo bug (art pass 2026-09-25)
  var cap = K.txt("CAPTION", "подпись к цифре", { size: 30, font: CR.FONT.REGULAR, color: CR.COLOR.WHITE, x: 1760, y: 302, justify: "right" });
  var val = K.txt("VALUE", "42%", { size: 96, font: CR.FONT.BOLD, color: CR.COLOR.GREEN, x: 1760, y: 250, justify: "right" });
  K.box("VALUE", 1000, 156, 760, 110);
  K.box("CAPTION", 1000, 272, 760, 44);
  var ink = K.ink(["TXT_VALUE", "TXT_CAPTION"]);
  var P = K.plate("PLATE", 1300, 136, 500, 200, CR.COLOR.BLACK, "right",
    ink + "[Math.max(200, 1800 - lft + 40), Math.max(120, bot + 32 - 136)]",
    ink + "var w = Math.max(200, 1800 - lft + 40), h = Math.max(120, bot + 32 - 136);\n[1800 - w / 2, 136 + h / 2]");
  P.moveToEnd();
  M.tween(M.scale(P), 0, 400, [0, 100], [100, 100], "wipe");
  M.slideIn(val, 120, { dx: 0, dy: 24 });
  M.fadeIn(cap, 280, { dur: 280 });
  K.exit([cap, val, P], 2400);
  K.marks(c, 600, 2400);
  return c;
};

K.logo = function (folder, logo) {
  var c = K.start("logo", 75, folder);
  var h = 40, w = logo.w * h / logo.h;
  var L = K.logoShape("LOGO", logo, 1800 - w, 64, h);
  M.fadeIn(L, 0, { dur: 400 });
  M.fadeOut(L, 2400, { dur: 280 });
  K.marks(c, 600, 2400);
  return c;
};

K.chapter = function (folder) {
  var c = K.start("chapter", 75, folder);
  var sub = K.txt("SUBTITLE", "Подзаголовок главы", { size: 42, font: CR.FONT.REGULAR, color: CR.COLOR.GRAY, x: 160, y: 700 });
  var ttl = K.txt("TITLE", "Название главы", { size: 110, font: CR.FONT.BOLD, color: CR.COLOR.WHITE, x: 160, y: 580, leading: 124 });
  var num = K.txt("NUMBER", "Глава 2", { size: 36, font: CR.FONT.REGULAR, color: CR.COLOR.GREEN, x: 160, y: 440 });
  K.below(sub, "TXT_TITLE", 88);   // 64 read as glued to a 110 px title (art pass 2026-09-25)
  K.box("NUMBER", 160, 400, 1600, 56);
  K.box("TITLE", 160, 480, 1600, 270);
  K.box("SUBTITLE", 160, 560, 1600, 380);
  var bg = M.solid("BG", CR.COLOR.BLACK);
  bg.moveToEnd();
  M.fadeIn(bg, 0, { dur: CR.MS.FAST });
  M.slideIn(ttl, 100, { dx: 0, dy: 40, dur: CR.MS.SLOW });
  M.fadeIn(num, 200, { dur: 400 });
  M.fadeIn(sub, 300, { dur: 400 });
  K.exit([sub, ttl, num], 2480);
  M.fadeOut(bg, 2760, { dur: 240 });
  K.marks(c, 800, 2480);
  return c;
};

K.intro = function (folder, logo) {
  var c = K.start("intro", 100, folder);
  var sub = K.txt("SUBTITLE", "Подзаголовок", { size: 42, font: CR.FONT.REGULAR, color: CR.COLOR.GRAY, x: 160, y: 760 });
  var ttl = K.txt("TITLE", "Название ролика", { size: 132, font: CR.FONT.BOLD, color: CR.COLOR.WHITE, x: 160, y: 640, leading: 144 });
  K.below(sub, "TXT_TITLE", 96);
  K.box("TITLE", 160, 520, 1600, 300);
  K.box("SUBTITLE", 160, 600, 1600, 380);
  var lg = K.logoShape("LOGO", logo, 160, 140, 48);
  var bg = M.solid("BG", CR.COLOR.BLACK);
  bg.moveToEnd();
  M.fadeIn(lg, 0, { dur: 400 });
  M.slideIn(ttl, 300, { dx: 0, dy: 40, dur: CR.MS.SLOW });
  M.fadeIn(sub, 700, { dur: 400 });
  K.exit([sub, ttl, lg], 3400);
  M.fadeOut(bg, 3760, { dur: 240 });
  K.marks(c, 1200, 3400);
  return c;
};

K.outro = function (folder, logo) {
  var c = K.start("outro", 100, folder);
  var sub = K.txt("SUBTITLE", "cloud.ru", { size: 30, font: CR.FONT.REGULAR, color: CR.COLOR.GRAY, x: 960, y: 672, justify: "center" });
  var ttl = K.txt("TITLE", "Спасибо за внимание", { size: 42, font: CR.FONT.REGULAR, color: CR.COLOR.WHITE, x: 960, y: 620, justify: "center" });
  K.box("TITLE", 360, 580, 1200, 56);
  K.box("SUBTITLE", 360, 644, 1200, 40);
  var h = 72, w = logo.w * h / logo.h;
  var lg = K.logoShape("LOGO", logo, 960 - w / 2, 434, h);
  var bg = M.solid("BG", CR.COLOR.BLACK);
  bg.moveToEnd();
  M.fadeIn(bg, 0, { dur: CR.MS.FAST });
  M.slideIn(lg, 0, { dx: 0, dy: 24, dur: CR.MS.SLOW });
  M.fadeIn(ttl, 500, { dur: 400 });
  M.fadeIn(sub, 700, { dur: 400 });
  K.exit([sub, ttl, lg], 3400);
  K.marks(c, 1200, 3400);
  return c;
};

K.BUILD = { lower_third: K.lower_third, quote: K.quote, callout: K.callout, logo: K.logo,
  chapter: K.chapter, intro: K.intro, outro: K.outro };
// Build the templates that are missing (all of them with force). Returns the types built.
K.ensure = function (folder, logo, force) {
  var built = [], i;
  for (i = 0; i < K.TYPES.length; i++) {
    var t = K.TYPES[i];
    if (force || !G.find("TPL_" + t, CompItem)) { K.BUILD[t](folder, logo); built.push(t); }
  }
  return built;
};
