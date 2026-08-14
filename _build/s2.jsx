// ===== GRID & RUPTURE — Scene 2 (Keyframes + Spatial Easing) 5-10s =====
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) { throw new Error("no active comp"); }
// Cloud.ru 2.0 palette (names kept, values rebranded)
var INK=[0.133,0.133,0.133], INK2=[0.090,0.090,0.090], PAPER=[1.000,1.000,1.000];
var VERM=[0.149,0.816,0.486], GREY=[0.600,0.615,0.600];
var YELLOW=[0.812,0.961,0.000];
var W=comp.width, H=comp.height, MARGIN=140, ST=5.0, EN=10.0;

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
  return L;
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
function win(L,a,b){ L.inPoint=a; L.outPoint=b; }
function fadeInOut(L,a,b){ var o=L.property("Opacity"); var base=o.value; o.setValueAtTime(a,0); o.setValueAtTime(a+0.35,base); o.setValueAtTime(b-0.3,base); o.setValueAtTime(b,0); reveal(o,1); }

app.beginUndoGroup("GR — scene2");
try{
  var made=[];
  var lab=mkText("S2-lab","FIG.02  /  KEYFRAMES · SPATIAL EASING",22,GREY,"SBSansInterface-Regular","L",180);
  lab.property("Position").setValue([MARGIN,152]); made.push(lab);
  var idx=mkText("S2-idx","02 — 06",26,VERM,"SBSansInterface-Regular","R",220);
  idx.property("Position").setValue([W-MARGIN,120]); made.push(idx);

  var hero=mkText("S2-hero","EASING",190,PAPER,"SBSansDisplay-Bold","L",-12,true);
  hero.property("Anchor Point").setValue([0,0]);
  hero.property("Position").setValue([MARGIN,300]); made.push(hero);
  var hp=hero.property("Position");
  key(hp,ST+0.2,[MARGIN-76,300]); key(hp,ST+1.0,[MARGIN,300]); reveal(hp,2);

  // motion path (bezier arc) drawn with trim
  var p0=[MARGIN+70,780], p1=[W-MARGIN-70,780];
  var pathL=comp.layers.addShape(); pathL.name="S2-path";
  pathL.property("Anchor Point").setValue([0,0]); pathL.property("Position").setValue([0,0]);
  var pg=pathL.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  var pgc=pg.property("ADBE Vectors Group");
  var shp=pgc.addProperty("ADBE Vector Shape - Group");
  var S=new Shape(); S.vertices=[p0,p1]; S.inTangents=[[0,0],[-430,-300]]; S.outTangents=[[430,-300],[0,0]]; S.closed=false;
  shp.property("ADBE Vector Shape").setValue(S);
  pgc=pg.property("ADBE Vectors Group");
  var strk=pgc.addProperty("ADBE Vector Graphic - Stroke");
  strk.property("ADBE Vector Stroke Color").setValue([PAPER[0],PAPER[1],PAPER[2],1]);
  strk.property("ADBE Vector Stroke Width").setValue(2.5);
  pgc=pg.property("ADBE Vectors Group");
  var trim=pgc.addProperty("ADBE Vector Filter - Trim");
  var te=trim.property("ADBE Vector Trim End");
  key(te,ST+0.3,0); key(te,ST+1.7,100); reveal(te,1);
  pathL.property("Opacity").setValue(55); made.push(pathL);

  // travelling dot on matching spatial path
  var dot=makeDot("S2-dot",VERM,44); dot.motionBlur=true;
  var dp=dot.property("Position");
  key(dp,ST+0.3,p0); key(dp,ST+1.7,p1);
  // SECOND BEAT (~2.9s): a little eased hop settles the dot at KEY 02
  key(dp,ST+2.9,[p1[0],p1[1]-96]); key(dp,ST+3.55,[p1[0],p1[1]]);
  dp.setSpatialTangentsAtKey(1,[0,0,0],[430,-300,0]);
  dp.setSpatialTangentsAtKey(2,[-430,-300,0],[0,0,0]);
  reveal(dp,1); setEase(dp,3,20,85,1); setEase(dp,4,85,20,1);
  dot.property("ADBE Effect Parade").addProperty("ADBE Glo2");
  made.push(dot);

  function tick(px,py,lbl){
    var t=comp.layers.addShape(); t.name="S2-tick"; t.property("Anchor Point").setValue([0,0]); t.property("Position").setValue([0,0]);
    var g=t.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group"); var gc=g.property("ADBE Vectors Group");
    var r=gc.addProperty("ADBE Vector Shape - Rect"); r.property("ADBE Vector Rect Size").setValue([2,22]); r.property("ADBE Vector Rect Position").setValue([px,py]);
    gc=g.property("ADBE Vectors Group"); var f=gc.addProperty("ADBE Vector Graphic - Fill"); f.property("ADBE Vector Fill Color").setValue([GREY[0],GREY[1],GREY[2],1]);
    made.push(t);
    var lt=mkText("S2-kl",lbl,20,GREY,"SBSansInterface-Regular","C",120); lt.property("Position").setValue([px,py+44]); made.push(lt);
  }
  tick(p0[0],p0[1],"KEY 01"); tick(p1[0],p1[1],"KEY 02");
  var note=mkText("S2-note","spatial tangents · setSpatialTangentsAtKey()",22,GREY,"SBSansInterface-Regular","C",60);
  note.property("Position").setValue([W/2, 430]); made.push(note);

  for(var i=0;i<made.length;i++){ win(made[i],ST,EN+0.02); fadeInOut(made[i],ST,EN); }

  comp.time = ST+2.2;
}finally{ app.endUndoGroup(); }
JSON.stringify({ok:true, layers:comp.numLayers});
