var comp = app.project.activeItem;
var errs=[];
for(var i=1;i<=comp.numLayers;i++){
  var L=comp.layer(i);
  var props=["Position","Scale","Opacity","Rotation","Source Text"];
  for(var p=0;p<props.length;p++){
    try{ var pr=L.property(props[p]); if(pr && pr.expressionEnabled && pr.expressionError!=""){ errs.push({layer:L.name, prop:props[p], err:pr.expressionError}); } }catch(e){}
  }
}
comp.time=0;
JSON.stringify({layers:comp.numLayers, duration:comp.duration, fps:Math.round(1/comp.frameDuration), errs:errs});
