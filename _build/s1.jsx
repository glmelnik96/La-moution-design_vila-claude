// ===== Cloud.ru MOTION — shared style system + Scene 1 (Intro) =====
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) { throw new Error("no active comp"); }

// ---- Cloud.ru 2.0 palette (core four + support) ----
var BLACK = [0.133,0.133,0.133];   // #222222 background
var BLACK2= [0.090,0.090,0.090];   // deep vignette
var WHITE = [1.000,1.000,1.000];
var GREEN = [0.149,0.816,0.486];   // #26D07C primary accent
var YELLOW= [0.812,0.961,0.000];   // #CFF500 secondary accent
var GRAY  = [0.949,0.949,0.949];   // #F2F2F2
var MUTE  = [0.600,0.615,0.600];   // derived mid-gray for muted text on dark

// ---- brand fonts (verified installed) ----
var F_DISPLAY = "SBSansDisplay-Bold";
var F_SEMI    = "SBSansDisplay-Semibold";
var F_MED     = "SBSansText-Medium";
var F_REG     = "SBSansText-Regular";
var F_UI      = "SBSansInterface-Regular";

var W = comp.width, H = comp.height;
// brand grid: edge margins ×10, internal spacing ×2 micromodule
var EDGE = 140;      // 14×10
var GUTTER = 70;     // accent rule lives here, 70px clear of content column

// ---- helpers ----
function KE(inf){ return new KeyframeEase(0, inf); }
function setEase(prop,k,inInf,outInf,n){
  prop.setInterpolationTypeAtKey(k,KeyframeInterpolationType.BEZIER,KeyframeInterpolationType.BEZIER);
  var tries=[n,1,2,3];
  for(var a=0;a<tries.length;a++){var m=tries[a];var ein=[],eout=[];
    for(var i=0;i<m;i++){ein.push(KE(inInf));eout.push(KE(outInf));}
    try{prop.setTemporalEaseAtKey(k,ein,eout);return;}catch(e){if(a===tries.length-1)throw e;}}
}
// decisive ease-out entrance (expressive-entrance ~0,0,0.3,1) — decelerate into place, no overshoot
function reveal(prop,n){ setEase(prop,1,16,16,n); setEase(prop,2,88,88,n); }
function key(prop,t,v){ prop.setValueAtTime(t,v); }

function mkText(name,str,size,col,font,justify,tracking,faux){
  var L=comp.layers.addText(str); L.name=name;
  var st=L.property("Source Text"); var d=st.value;
  d.resetCharStyle(); d.fontSize=size; d.fillColor=col; d.applyFill=true; d.strokeOver=false;
  if(justify=="R") d.justification=ParagraphJustification.RIGHT_JUSTIFY;
  else if(justify=="C") d.justification=ParagraphJustification.CENTER_JUSTIFY;
  else d.justification=ParagraphJustification.LEFT_JUSTIFY;
  if(tracking!=null) d.tracking=tracking;
  if(faux) d.fauxBold=true;
  st.setValue(d);
  var live=st.value; live.font=font; st.setValue(live);
  return {L:L, got:st.value.font, want:font};
}
function mkSolid(name,col,w,h){ return comp.layers.addSolid(col,name,w,h,1); }
function fx(L,mn){ return L.property("ADBE Effect Parade").addProperty(mn); }

// ---- CLEAR + rebuild ----
app.beginUndoGroup("Cloud.ru motion — reset + scene1");
try{
  while(comp.numLayers>0){ comp.layer(1).remove(); }
  comp.motionBlur = true;

  // ---- background: flat black field with subtle radial lift ----
  var bg = mkSolid("FIELD", BLACK, W, H);
  var ramp = fx(bg,"ADBE Ramp");
  ramp.property("ADBE Ramp-0001").setValue([W*0.28, H*0.16]);
  ramp.property("ADBE Ramp-0002").setValue(BLACK);
  ramp.property("ADBE Ramp-0003").setValue([W*0.90, H*1.08]);
  ramp.property("ADBE Ramp-0004").setValue(BLACK2);
  ramp.property("ADBE Ramp-0005").setValue(2);

  var grain = mkSolid("GRAIN", [1,1,1], W, H);
  var nz = fx(grain,"ADBE Noise");
  nz.property("ADBE Noise-0001").setValue(24);
  grain.property("Opacity").setValue(3.5);
  grain.blendingMode = BlendingMode.OVERLAY;

  // ---- PORTAL signature: nested offset rectangle outlines (brand device), bottom-right ----
  var portal = comp.layers.addShape(); portal.name="PORTAL";
  var proot = portal.property("ADBE Root Vectors Group");
  var pcount = 4, pw=300, ph=300, poff=52;
  for(var pi=0;pi<pcount;pi++){
    var g = proot.addProperty("ADBE Vector Group"); g.name="p"+pi;
    var cont = g.property("ADBE Vectors Group");
    var rc = cont.addProperty("ADBE Vector Shape - Rect");
    rc.property("ADBE Vector Rect Size").setValue([pw,ph]);
    rc.property("ADBE Vector Rect Position").setValue([0,0]);
    rc.property("ADBE Vector Rect Roundness").setValue(0);
    var stk = cont.addProperty("ADBE Vector Graphic - Stroke");
    stk.property("ADBE Vector Stroke Color").setValue([GREEN[0],GREEN[1],GREEN[2],1]);
    stk.property("ADBE Vector Stroke Width").setValue(2);
    try{ stk.property("ADBE Vector Stroke Line Cap").setValue(1); }catch(e){}
    var tr = g.property("ADBE Vector Transform Group");
    tr.property("ADBE Vector Position").setValue([pi*poff, pi*poff]);
    tr.property("ADBE Vector Group Opacity").setValue(100 - pi*16);
  }
  // keep the whole offset stack inside the ×10 edge margin: outermost edge at (W-EDGE, H-EDGE)
  portal.property("Position").setValue([W-EDGE-pw/2-(pcount-1)*poff, H-EDGE-ph/2-(pcount-1)*poff]);
  portal.property("Opacity").setValue(46);
  // staggered stroke reveal via scale, then hold (chrome)
  var pscl=portal.property("Scale"); key(pscl,0.6,[70,70]); key(pscl,1.3,[100,100]); reveal(pscl,2);
  var popa=portal.property("Opacity"); key(popa,0.6,0); key(popa,1.3,46); key(popa,4.7,46); key(popa,5.0,0); reveal(popa,1);
  portal.inPoint=0; portal.outPoint=5.02;   // intro signature only — avoids colliding with scene content

  // ---- ambient green scan-line : the only idle motion, background texture ----
  var scan = mkSolid("SCAN", GREEN, W, 2);
  scan.property("Anchor Point").setValue([W/2,1]);
  scan.property("Position").expression = "y=((time*140)%"+(H+160)+")-80; [thisComp.width/2, y]";
  scan.property("Opacity").setValue(12);
  scan.blendingMode = BlendingMode.ADD;

  // ---- left accent rule (green) : wipes down, sits in gutter, clear of content ----
  var rule = mkSolid("RULE", GREEN, 6, H);
  rule.property("Anchor Point").setValue([3,0]);
  rule.property("Position").setValue([GUTTER, 0]);
  var rs = rule.property("Scale");
  key(rs,0.2,[100,0]); key(rs,0.9,[100,100]); reveal(rs,2);
  rule.property("Opacity").setValue(90);

  // ---- corner reference markers ----
  var m1 = mkText("MK-tl","cloud.ru",26,MUTE,F_UI,"L",60).L;
  m1.property("Position").setValue([EDGE, 120]);
  var m2 = mkText("MK-tl2","FIG.01  /  MOTION SYSTEM",22,MUTE,F_UI,"L",120).L;
  m2.property("Position").setValue([EDGE, 154]);
  var idx = mkText("MK-idx","01 — 06",26,GREEN,F_UI,"R",120).L;
  idx.property("Position").setValue([W-EDGE, 120]);

  var mk=[m1,m2,idx];
  for(var i=0;i<mk.length;i++){ var op=mk[i].property("Opacity");
    key(op,0.15+i*0.08,0); key(op,0.55+i*0.08,100); reveal(op,1); }

  // ---- HERO : "MOTION" giant, decisive rise + fade, no overshoot ----
  var hero = mkText("HERO","MOTION",320,WHITE,F_DISPLAY,"L",-30,false);
  var HL = hero.L; HL.motionBlur = true;
  HL.property("Anchor Point").setValue([0,0]);
  HL.property("Position").setValue([EDGE, 640]);
  var hp=HL.property("Position");
  key(hp,0.25,[EDGE, 820]); key(hp,0.95,[EDGE, 640]); reveal(hp,2);
  var ho=HL.property("Opacity"); key(ho,0.25,0); key(ho,0.6,100); reveal(ho,1);
  var hsc=HL.property("Scale");
  key(hsc,0.25,[94,94]); key(hsc,0.95,[100,100]); reveal(hsc,2);

  // ---- green underline block under hero : clean horizontal wipe, holds (no pulse) ----
  var ul = mkSolid("UL", GREEN, 640, 10);
  ul.property("Anchor Point").setValue([0,5]);
  ul.property("Position").setValue([EDGE, 700]);
  var uls=ul.property("Scale");
  key(uls,0.85,[0,100]); key(uls,1.4,[100,100]); reveal(uls,2);

  // ---- subhead ----
  var sub = mkText("SUB","designed as code — live in After Effects",34,GRAY,F_REG,"L",20).L;
  sub.property("Position").setValue([EDGE, 764]);
  var so=sub.property("Opacity"); key(so,0.7,0); key(so,1.2,92); reveal(so,1);

  // ---- SECOND BEAT (~2.5s): capability line slides in beneath subhead ----
  var sub2 = mkText("SUB2","keyframes · expressions · choreography · physics · AI",24,MUTE,F_MED,"L",10).L;
  sub2.property("Anchor Point").setValue([0,0]);
  var s2p=sub2.property("Position"); key(s2p,2.5,[EDGE-40,824]); key(s2p,3.0,[EDGE,824]); reveal(s2p,2);
  var s2o=sub2.property("Opacity"); key(s2o,2.5,0); key(s2o,3.0,82); reveal(s2o,1);

  // scene-1 content windowed 0-5s (FIELD/GRAIN/PORTAL/SCAN/RULE/wordmark stay as chrome)
  var content=[m2, idx, HL, sub, ul, sub2];
  for(var c=0;c<content.length;c++){
    var o=content[c].property("Opacity");
    o.setValueAtTime(4.7, 100); o.setValueAtTime(5.0, 0);
    content[c].outPoint=5.02;
  }

  comp.time = 3.1;
}finally{ app.endUndoGroup(); }

JSON.stringify({ok:true, layers:comp.numLayers, heroFont:hero.got, heroWant:hero.want});
