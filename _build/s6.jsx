// ===== GRID & RUPTURE — Scene 6 (Outro / Colophon) 25-30s =====
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) { throw new Error("no active comp"); }
var INK=[0.133,0.133,0.133], PAPER=[1.000,1.000,1.000];
var VERM=[0.149,0.816,0.486], GREY=[0.600,0.615,0.600];
var W=comp.width, H=comp.height, MARGIN=140, ST=25.0, EN=30.0;

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
  return {L:L, st:st, got:st.value.font};
}
function win(L,a,b){ L.inPoint=a; L.outPoint=b; }
function fadeIn(L,a){ var o=L.property("Opacity"); var base=o.value; o.setValueAtTime(a,0); o.setValueAtTime(a+0.4,base); reveal(o,1); }
function fadeInOut(L,a,b){ var o=L.property("Opacity"); var base=o.value; o.setValueAtTime(a,0); o.setValueAtTime(a+0.35,base); o.setValueAtTime(b-0.3,base); o.setValueAtTime(b,0); reveal(o,1); }

app.beginUndoGroup("GR — scene6");
try{
  var made=[];      // fade in + hold to end (no fade out)
  var madeIO=[];    // fade in + out

  var lab=mkText("S6-lab","FIG.06  /  COLOPHON",22,GREY,"SBSansInterface-Regular","L",180).L;
  lab.property("Position").setValue([MARGIN,152]); madeIO.push(lab);
  var idx=mkText("S6-idx","06 — 06",26,VERM,"SBSansInterface-Regular","R",220).L;
  idx.property("Position").setValue([W-MARGIN,120]); madeIO.push(idx);

  // hero wordmark — slam in with overshoot, echoing the chrome wordmark
  var hero=mkText("S6-hero","ae-motion-live",150,PAPER,"SBSansDisplay-Bold","L",-6,true);
  hero.L.property("Anchor Point").setValue([0,0]); hero.L.property("Position").setValue([MARGIN,540]); made.push(hero.L);
  var hp=hero.L.property("Position"); key(hp,ST+1.3,[MARGIN-86,540]); key(hp,ST+2.1,[MARGIN,540]); reveal(hp,2);
  var hs=hero.L.property("Scale"); key(hs,ST+1.3,[90,90]); key(hs,ST+2.1,[100,100]);
  setEase(hs,1,16,16,2); setEase(hs,2,88,88,2); hero.L.motionBlur=true;

  // PORTAL — brand signature, bookends the intro; frames the colophon lower-right
  var s6p=comp.layers.addShape(); s6p.name="S6-portal";
  var proot=s6p.property("ADBE Root Vectors Group");
  var pcount=4,pw=300,ph=300,poff=52;
  for(var pi=0;pi<pcount;pi++){
    var pg=proot.addProperty("ADBE Vector Group");
    var pcont=pg.property("ADBE Vectors Group");
    var prc=pcont.addProperty("ADBE Vector Shape - Rect");
    prc.property("ADBE Vector Rect Size").setValue([pw,ph]);
    prc.property("ADBE Vector Rect Position").setValue([0,0]);
    prc.property("ADBE Vector Rect Roundness").setValue(0);
    var pstk=pcont.addProperty("ADBE Vector Graphic - Stroke");
    pstk.property("ADBE Vector Stroke Color").setValue([VERM[0],VERM[1],VERM[2],1]);
    pstk.property("ADBE Vector Stroke Width").setValue(2);
    try{ pstk.property("ADBE Vector Stroke Line Cap").setValue(1); }catch(e){}
    var ptr=pg.property("ADBE Vector Transform Group");
    ptr.property("ADBE Vector Position").setValue([pi*poff, pi*poff]);
    ptr.property("ADBE Vector Group Opacity").setValue(100 - pi*16);
  }
  s6p.property("Position").setValue([W-MARGIN-pw/2-(pcount-1)*poff, H-MARGIN-ph/2-(pcount-1)*poff]);
  s6p.property("Opacity").setValue(42);
  var s6ps=s6p.property("Scale"); key(s6ps,ST+0.6,[72,72]); key(s6ps,ST+1.3,[100,100]); reveal(s6ps,2);
  var s6po=s6p.property("Opacity"); key(s6po,ST+0.6,0); key(s6po,ST+1.3,42); reveal(s6po,1);
  made.push(s6p);

  // vermillion accent block — wipes across from left, then exits right to reveal the wordmark
  var blk=comp.layers.addSolid(VERM,"S6-block",W,H,1);
  blk.property("Anchor Point").setValue([W/2,H/2]); blk.property("Position").setValue([W/2,H/2]);
  var bp=blk.property("Position");
  key(bp,ST+0.0,[-W/2,H/2]); key(bp,ST+0.55,[W/2,H/2]); key(bp,ST+1.3,[W/2,H/2]); key(bp,ST+1.85,[W*1.5,H/2]);
  setEase(bp,1,12,12,1); setEase(bp,2,90,20,1); setEase(bp,3,20,20,1); setEase(bp,4,90,12,1);
  blk.motionBlur=true; win(blk,ST,ST+2.0);

  // "MOTION SYSTEM" tag riding on the block while it covers the frame
  var blkTag=mkText("S6-blktag","MOTION SYSTEM",120,INK,"SBSansDisplay-Bold","L",-6,true);
  blkTag.L.property("Anchor Point").setValue([0,0]); blkTag.L.property("Position").setValue([MARGIN,H/2-40]);
  var btp=blkTag.L.property("Position");
  key(btp,ST+0.0,[MARGIN-W,H/2-40]); key(btp,ST+0.55,[MARGIN,H/2-40]); key(btp,ST+1.3,[MARGIN,H/2-40]); key(btp,ST+1.85,[MARGIN+W,H/2-40]);
  setEase(btp,1,12,12,2); setEase(btp,2,90,20,2); setEase(btp,3,20,20,2); setEase(btp,4,90,12,2);
  win(blkTag.L,ST,ST+2.0);

  // vermillion rule under the wordmark, wipes open
  var ul=comp.layers.addSolid(VERM,"S6-ul",760,8,1);
  ul.property("Anchor Point").setValue([0,0]); ul.property("Position").setValue([MARGIN,600]);
  var us=ul.property("Scale"); key(us,ST+2.1,[0,100]); key(us,ST+2.6,[100,100]); reveal(us,2); made.push(ul);

  // tagline — the capability list
  var tag=mkText("S6-tag","keyframes · expressions · choreography · physics · AI assets",30,GREY,"SBSansInterface-Regular","L",40).L;
  tag.property("Position").setValue([MARGIN,672]); made.push(tag);
  fadeIn(tag,ST+2.5);

  // right-column colophon detail — small technical footer
  var col1=mkText("S6-col1","LIVE EXTENDSCRIPT · CEP · CDP 8092",20,GREY,"CourierNewPSMT","R",30).L;
  col1.property("Position").setValue([W-MARGIN,900]); made.push(col1); fadeIn(col1,ST+2.9);
  var col2=mkText("S6-col2","06 FIGURES / 30.0 s / 30 fps",20,GREY,"CourierNewPSMT","R",30).L;
  col2.property("Position").setValue([W-MARGIN,936]); made.push(col2); fadeIn(col2,ST+3.1);

  // baseline rule bottom-left
  var base=comp.layers.addSolid(GREY,"S6-base",W-MARGIN*2,2,1);
  base.property("Anchor Point").setValue([0,0]); base.property("Position").setValue([MARGIN,940]);
  base.property("Opacity").setValue(40); made.push(base); fadeIn(base,ST+2.7);

  // windowing: madeIO fade in+out; made fade in and HOLD to comp end
  for(var i=0;i<madeIO.length;i++){ win(madeIO[i],ST,EN+0.02); fadeInOut(madeIO[i],ST,EN); }
  for(var i=0;i<made.length;i++){ win(made[i],ST,EN+0.5); }

  comp.time = ST+3.2;
}finally{ app.endUndoGroup(); }
JSON.stringify({ok:true, layers:comp.numLayers, heroFont:hero.got});
