var c = app.project.activeItem;
var out = { name:c.name, w:c.width, h:c.height, fps:c.frameRate, dur:c.duration, n:c.numLayers, layers:[] };
for (var i=1;i<=c.numLayers;i++){
  var L = c.layer(i);
  var o = { i:i, name:L.name, type:(L instanceof TextLayer)?"text":((L instanceof ShapeLayer)?"shape":((L instanceof AVLayer)?"av":"other")),
            inP:L.inPoint, outP:L.outPoint, en:L.enabled, par:(L.parent?L.parent.name:null) };
  try { o.pos = L.property("Transform").property("Position").value; } catch(e){}
  try { o.anch = L.property("Transform").property("Anchor Point").value; } catch(e){}
  try { o.scl = L.property("Transform").property("Scale").value; } catch(e){}
  if (L instanceof TextLayer){
    var td = L.property("Source Text").value;
    o.txt = td.text;
    o.font = td.font;
    o.size = td.fontSize;
    try { o.fill = [td.fillColor[0], td.fillColor[1], td.fillColor[2]]; } catch(e){ o.fill=null; }
    try { o.applyFill = td.applyFill; } catch(e){}
    try { o.just = td.justification.toString(); } catch(e){}
    try { var r = L.sourceRectAtTime(Math.max(L.inPoint+0.05, 0), false); o.rect=[r.left,r.top,r.width,r.height]; } catch(e){ o.rect=null; }
  }
  out.layers.push(o);
}
JSON.stringify(out);
