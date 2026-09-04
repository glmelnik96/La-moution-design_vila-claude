// Same invented brief as html/templates/ab-test.html, built twice in AE so the two
// engines can be compared on identical content. Layout is identical in both comps;
// only the choreography differs.
//   AB NAIVE - one linear opacity fade, every layer starting on frame 0, 2 s each,
//              no movement, no stagger, no exit.
//   AB LIB   - the library: wordCascade, growRule, premiumIn with a spring, counter
//              on the count ease, followThrough offsets, cameraPush, exitOut.
JSON.stringify(M.run("ab-build", function () {

  var HEAD = "\u0420\u0435\u0437\u0435\u0440\u0432\u043D\u0430\u044F \u043A\u043E\u043F\u0438\u044F \u0437\u0430 8 \u0441\u0435\u043A\u0443\u043D\u0434";
  var UNIT = "\u043A\u043E\u043F\u0438\u0439 \u0432 \u0447\u0430\u0441";
  var CAP  = "\u0411\u0435\u0437 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438 \u043F\u0440\u043E\u0434\u0430\u043A\u0448\u0435\u043D\u0430";
  var MG = 80, out = {};

  // ---- layout, identical in both comps ------------------------------------
  function layout() {
    var o = {};
    o.head = M.text("HEAD", HEAD, { size: 96, font: CR.FONT.BOLD, color: CR.COLOR.BLACK, x: MG, y: 340 });
    o.rule = M.rule("RULE", MG, 400, 1240, 4, CR.COLOR.GREEN, "left");
    o.kpi  = M.text("KPI", "0", { size: CR.TYPE.KPI_HERO, font: CR.FONT.BOLD, color: CR.COLOR.BLACK, tracking: CR.TRACKING.KPI, x: MG, y: 700 });
    o.unit = M.text("UNIT", UNIT, { size: CR.TYPE.KPI_DESC, font: CR.FONT.MEDIUM, color: CR.COLOR.GRAPHITE, tracking: CR.TRACKING.LABEL, x: MG, y: 760 });
    o.cap  = M.text("CAP", CAP, { size: CR.TYPE.SUBTITLE, font: CR.FONT.REGULAR, color: CR.COLOR.GRAPHITE, x: MG, y: 860 });
    o.bg   = M.solid("BG", CR.COLOR.WHITE, M.W, M.H);
    o.bg.moveToEnd();
    return o;
  }

  // ================= NAIVE =================
  M.ensureComp("AB NAIVE", "1080p", 5);
  M.clean();
  var n = layout();
  var nl = [n.head, n.rule, n.kpi, n.unit, n.cap];
  for (var i = 0; i < nl.length; i++) {
    M.tween(M.opacity(nl[i]), 0, 2000, 0, 100, "linear");   // one property, linear, all at once
  }
  M.counter(n.kpi, 0, 2000, 0, 12500, { ease: "linear" });
  out.naive = { layers: M.comp.numLayers, dur: M.comp.duration };

  // ================= LIB =================
  M.ensureComp("AB LIB", "1080p", 5);
  M.clean();
  var g = layout();

  // hero: the headline arrives word by word
  M.wordCascade(g.head, 200, { words: 5, rise: M.px(30), dur: 550 });

  // support: rule wipes, KPI lands on a spring, its labels follow 60 ms apart
  M.growRule(g.rule, 1300, { dur: 500, ease: "wipe" });
  M.premiumIn(g.kpi, 1520, { rise: M.px(30), scale: 0.94, spring: "M3_STANDARD" });
  M.counter(g.kpi, 1520, 2920, 0, 12500, { ease: "count" });
  M.followThrough([g.unit, g.cap], 1900, function (L, ms) {
    M.premiumIn(L, ms, { rise: M.px(22), scale: 1, blur: M.px(3), dur: 420 });
  }, 60);

  // a 2 % push keeps the held frame alive; the beat ends on a designed exit
  M.cameraPush([g.head, g.rule, g.kpi, g.unit, g.cap], 200, 5000, 1.02);
  var ex = [g.cap, g.unit, g.kpi, g.rule, g.head];
  M.followThrough(ex, 4150, function (L, ms) { M.exitOut(L, ms, { drop: -M.px(26) }); }, 50);
  out.lib = { layers: M.comp.numLayers, dur: M.comp.duration };

  out.exprErrors = M.exprErrors();
  return out;
}));
