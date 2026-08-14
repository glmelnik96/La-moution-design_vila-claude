// ===== GRID & RUPTURE — Scene 4 (Choreography / staggered bars) 15-20s =====
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) { throw new Error("no active comp"); }
var INK=[0.133,0.133,0.133], PAPER=[1.000,1.000,1.000];
var VERM=[0.149,0.816,0.486], GREY=[0.600,0.615,0.600];
var W=comp.width, H=comp.height, MARGIN=140, ST=15.0, EN=20.0;

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
function makeBar(x,w,H0,col,phase,startT){
  var L=comp.layers.addShape(); L.name="S4-bar";
  L.property("Anchor Point").setValue([0,0]); L.property("Position").setValue([x,820]);
  var vg=L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  var vgc=vg.property("ADBE Vectors Group");
  var r=vgc.addProperty("ADBE Vector Shape - Rect");
  r.property("ADBE Vector Rect Size").setValue([w,H0]);
  r.property("ADBE Vector Rect Position").setValue([0,-H0/2]);
  vgc=vg.property("ADBE Vectors Group");
  var f=vgc.addProperty("ADBE Vector Graphic - Fill");
  f.property("ADBE Vector Fill Color").setValue([col[0],col[1],col[2],1]);
  var sc=L.property("Scale");
  sc.expression="ph="+phase+"; st="+startT+"; a=(time<st)?0:Math.min(1,(time-st)/0.4); v=15+85*(0.5+0.5*Math.sin(time*4.2+ph)); [100, v*a]";
  L.motionBlur=true;
  return L;
}
function win(L,a,b){ L.inPoint=a; L.outPoint=b; }
function fadeInOut(L,a,b){ var o=L.property("Opacity"); var base=o.value; o.setValueAtTime(a,0); o.setValueAtTime(a+0.35,base); o.setValueAtTime(b-0.3,base); o.setValueAtTime(b,0); reveal(o,1); }

app.beginUndoGroup("GR — scene4");
try{
  var made=[];
  var lab=mkText("S4-lab","FIG.04  /  CHOREOGRAPHY",22,GREY,"SBSansInterface-Regular","L",180);
  lab.property("Position").setValue([MARGIN,152]); made.push(lab);
  var idx=mkText("S4-idx","04 — 06",26,VERM,"SBSansInterface-Regular","R",220);
  idx.property("Position").setValue([W-MARGIN,120]); made.push(idx);

  var hero=mkText("S4-hero","STAGGER",190,PAPER,"SBSansDisplay-Bold","L",-14,true);
  hero.property("Anchor Point").setValue([0,0]); hero.property("Position").setValue([MARGIN,300]); made.push(hero);
  var hp=hero.property("Position"); key(hp,ST+0.2,[MARGIN-70,300]); key(hp,ST+1.0,[MARGIN,300]); reveal(hp,2);

  // bars
  var N=24, pitch=60, w=34, H0=280, accent=16;
  for(var i=0;i<N;i++){
    var col = (i==accent)? VERM : PAPER;
    var x = MARGIN + i*pitch + w/2;
    var bar = makeBar(x, w, H0, col, i*0.5, ST + i*0.03);
    made.push(bar);
  }
  // baseline rule
  var base=comp.layers.addSolid(GREY,"S4-base",N*pitch,2,1);
  base.property("Anchor Point").setValue([0,0]); base.property("Position").setValue([MARGIN,821]);
  base.property("Opacity").setValue(45); made.push(base);

  var read=mkText("S4-read","24 BARS · INDEX-PHASED sin() · STAGGERED ENTRANCE",22,GREY,"SBSansInterface-Regular","L",80);
  read.property("Position").setValue([MARGIN,880]); made.push(read);

  for(var i=0;i<made.length;i++){ win(made[i],ST,EN+0.02); fadeInOut(made[i],ST,EN); }
  comp.time = ST+3.0;
}finally{ app.endUndoGroup(); }
JSON.stringify({ok:true, layers:comp.numLayers});
