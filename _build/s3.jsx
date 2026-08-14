// ===== GRID & RUPTURE — Scene 3 (Live Expressions) 10-15s =====
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) { throw new Error("no active comp"); }
var INK=[0.133,0.133,0.133], PAPER=[1.000,1.000,1.000];
var VERM=[0.149,0.816,0.486], GREY=[0.600,0.615,0.600], BLUE=[0.812,0.961,0.000];
var W=comp.width, H=comp.height, MARGIN=140, ST=10.0, EN=15.0;

function KE(inf){ return new KeyframeEase(0,inf); }
function setEase(prop,k,inInf,outInf,n){
  prop.setInterpolationTypeAtKey(k,KeyframeInterpolationType.BEZIER,KeyframeInterpolationType.BEZIER);
  var tries=[n,1,2,3];
  for(var a=0;a<tries.length;a++){var m=tries[a];var ein=[],eout=[];
    for(var i=0;i<m;i++){ein.push(KE(inInf));eout.push(KE(outInf));}
    try{prop.setTemporalEaseAtKey(k,ein,eout);return;}catch(e){if(a===tries.length-1)throw e;}}
}
function reveal(prop,n){ setEase(prop,1,12,12,n); setEase(prop,2,90,90,n); }
function key(prop,t,v){ prop.setValueAtTime(t,v); }
function floatP(prop,ax,ay,fx1,fy1){ prop.expression="value+[Math.sin(time*"+fx1+")*"+ax+",Math.sin(time*"+fy1+"+1.3)*"+ay+"]"; }
function mkText(name,str,size,col,font,justify,tracking,faux){
  var L=comp.layers.addText(str); L.name=name;
  var st=L.property("Source Text"); var d=st.value;
  d.resetCharStyle(); d.fontSize=size; d.fillColor=col; d.applyFill=true; d.strokeOver=false;
  if(justify=="R") d.justification=ParagraphJustification.RIGHT_JUSTIFY;
  else if(justify=="C") d.justification=ParagraphJustification.CENTER_JUSTIFY;
  else d.justification=ParagraphJustification.LEFT_JUSTIFY;
  if(tracking!=null) d.tracking=tracking; if(faux) d.fauxBold=true;
  st.setValue(d); var live=st.value; live.font=font; st.setValue(live);
  return {L:L, got:st.value.font};
}
function makeDot(name,col,dia){
  var L=comp.layers.addShape(); L.name=name; L.property("Anchor Point").setValue([0,0]);
  var vg=L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  var vgc=vg.property("ADBE Vectors Group");
  var el=vgc.addProperty("ADBE Vector Shape - Ellipse");
  el.property("ADBE Vector Ellipse Size").setValue([dia,dia]);
  vgc=vg.property("ADBE Vectors Group");
  var fl=vgc.addProperty("ADBE Vector Graphic - Fill");
  fl.property("ADBE Vector Fill Color").setValue([col[0],col[1],col[2],1]);
  return L;
}
function makeSquare(name,col,s){
  var L=comp.layers.addShape(); L.name=name; L.property("Anchor Point").setValue([0,0]);
  var vg=L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  var vgc=vg.property("ADBE Vectors Group");
  var r=vgc.addProperty("ADBE Vector Shape - Rect"); r.property("ADBE Vector Rect Size").setValue([s,s]);
  vgc=vg.property("ADBE Vectors Group");
  var fl=vgc.addProperty("ADBE Vector Graphic - Fill");
  fl.property("ADBE Vector Fill Color").setValue([col[0],col[1],col[2],1]);
  return L;
}
function ruleLine(y){
  var L=comp.layers.addSolid(GREY,"S3-rule",W-MARGIN*2,1,1);
  L.property("Anchor Point").setValue([0,0]); L.property("Position").setValue([MARGIN,y]);
  L.property("Opacity").setValue(30); return L;
}
function win(L,a,b){ L.inPoint=a; L.outPoint=b; }
function fadeInOut(L,a,b){ var o=L.property("Opacity"); var base=o.value; o.setValueAtTime(a,0); o.setValueAtTime(a+0.35,base); o.setValueAtTime(b-0.3,base); o.setValueAtTime(b,0); reveal(o,1); }

app.beginUndoGroup("GR — scene3");
try{
  var made=[];
  var lab=mkText("S3-lab","FIG.03  /  LIVE EXPRESSIONS",22,GREY,"SBSansInterface-Regular","L",180).L;
  lab.property("Position").setValue([MARGIN,152]); made.push(lab);
  var idx=mkText("S3-idx","03 — 06",26,VERM,"SBSansInterface-Regular","R",220).L;
  idx.property("Position").setValue([W-MARGIN,120]); made.push(idx);

  var hero=mkText("S3-hero","EXPRESSIONS",128,PAPER,"SBSansDisplay-Bold","L",-10,true);
  hero.L.property("Anchor Point").setValue([0,0]); hero.L.property("Position").setValue([MARGIN,290]); made.push(hero.L);
  var hp=hero.L.property("Position"); key(hp,ST+0.2,[MARGIN-60,290]); key(hp,ST+1.0,[MARGIN,290]); reveal(hp,2);

  var probe = mkText("S3-probe","x",10,GREY,"CourierNewPSMT","L",0); var codeFont = probe.got; probe.L.remove();

  var rows=[
    {y:520, code:"wiggle(6, 50)",         tag:"ORGANIC JITTER"},
    {y:690, code:"loopOut('pingpong')",   tag:"CYCLIC MOTION"},
    {y:860, code:"spring · overshoot",    tag:"DECAYING BOUNCE"}
  ];
  for(var i=0;i<rows.length;i++){
    made.push(ruleLine(rows[i].y+52));
    var cl=mkText("S3-code",rows[i].code,42,PAPER,codeFont,"L",10).L;
    cl.property("Position").setValue([MARGIN,rows[i].y]); made.push(cl);
    var tg=mkText("S3-tag",rows[i].tag,20,GREY,"SBSansInterface-Regular","R",160).L;
    tg.property("Position").setValue([W-MARGIN,rows[i].y-8]); made.push(tg);
  }

  var eX=1230;
  var A=makeDot("S3-A",PAPER,40); A.property("Position").setValue([eX,510]);
  A.property("Position").expression="wiggle(6,50)"; A.motionBlur=true; made.push(A);

  var B=makeDot("S3-B",VERM,40); B.motionBlur=true;
  var bp=B.property("Position"); key(bp,ST+0.0,[eX-40,680]); key(bp,ST+0.9,[eX+120,680]);
  bp.setInterpolationTypeAtKey(1,KeyframeInterpolationType.BEZIER,KeyframeInterpolationType.BEZIER);
  bp.setInterpolationTypeAtKey(2,KeyframeInterpolationType.BEZIER,KeyframeInterpolationType.BEZIER);
  bp.expression="loopOut('pingpong')"; made.push(B);

  var C=makeSquare("S3-C",BLUE,52); C.property("Anchor Point").setValue([26,26]); C.property("Position").setValue([eX+20,850]);
  var cs=C.property("Scale"); key(cs,ST+0.3,[40,40]); key(cs,ST+0.7,[100,100]); key(cs,ST+2.8,[100,100]); reveal(cs,2);
  cs.expression="freq=3; decay=4.5;\nif(numKeys>0){\n n=nearestKey(time).index;\n if(key(n).time>time){n--;}\n if(n>0){\n  t=time-key(n).time;\n  amp=22;\n  d=amp*Math.sin(freq*t*2*Math.PI)/Math.exp(decay*t);\n  [value[0]+d, value[1]+d];\n } else { value }\n} else { value }";
  C.motionBlur=true; made.push(C);

  for(var i=0;i<made.length;i++){ win(made[i],ST,EN+0.02); fadeInOut(made[i],ST,EN); }
  comp.time = ST+2.4;
}finally{ app.endUndoGroup(); }
JSON.stringify({ok:true, layers:comp.numLayers, codeFont:codeFont});
