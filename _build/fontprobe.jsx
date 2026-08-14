var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) { throw new Error("no active comp"); }
var tests = ["SBSansDisplay-SemiBold","SBSansDisplay-Regular","SBSansText-Regular",
  "SBSansInterface-Regular","SBSansDisplay","SBSansText","Verdana","Verdana-Bold",
  "Arial-Black","ArialMT"];
var res = {};
for (var i=0;i<tests.length;i++){
  try {
    var L = comp.layers.addText("x");
    var st = L.property("Source Text");
    var d = st.value; d.font = tests[i]; st.setValue(d);
    res[tests[i]] = String(st.value.font);
    L.remove();
  } catch(e){ res[tests[i]] = "ERR:"+e.toString(); }
}
JSON.stringify(res);
