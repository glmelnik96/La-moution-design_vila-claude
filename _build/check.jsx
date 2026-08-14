var c = app.project.activeItem;
var res = { layers: c.numLayers, errs: [] };
var names = ["Position", "Scale", "Opacity", "Rotation", "Source Text"];
for (var i = 1; i <= c.numLayers; i++) {
  var L = c.layer(i);
  for (var p = 0; p < names.length; p++) {
    var pr = null;
    try { pr = L.property(names[p]); } catch (e) { pr = null; }
    if (pr) {
      var enabled = false;
      try { enabled = pr.expressionEnabled; } catch (e) { enabled = false; }
      if (enabled) {
        var er = "";
        try { er = pr.expressionError; } catch (e) { er = "(read fail)"; }
        if (er && er !== "") res.errs.push(L.name + "." + names[p] + ": " + er.replace(/[\r\n]+/g, " "));
      }
    }
  }
}
JSON.stringify(res);
