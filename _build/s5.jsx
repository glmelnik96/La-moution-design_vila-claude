// ===== GRID & RUPTURE — Scene 5 (Timing + Physics) 20-25s =====
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) { throw new Error("no active comp"); }
var INK=[0.133,0.133,0.133], PAPER=[1.000,1.000,1.000];
var VERM=[0.149,0.816,0.486], GREY=[0.600,0.615,0.600];
var W=comp.width, H=comp.height, MARGIN=140, ST=20.0, EN=25.0;

function KE(inf){ return new KeyframeEase(0,inf); }
function setEase(prop,k,inInf,outInf,n){
  prop.setInterpolationTypeAtKey(k,KeyframeInterpolationType.BEZIER,KeyframeInterpolationType.BEZIER);
  var tries=[n,1,2,3];
  for(var a=0;a<tries.length;a++){var m=tries[a];var ein=[],eout=[];
    for(var i=0;i<m;i++){ein.push(KE(inInf));eout.push(KE(outInf));}
    try{prop.setTemporalEaseAtKey(k,ein,eout);return;}catch(e){if(a===tries.length-1)throw e;}}
}
function reveal(prop,n){ setEase(prop,1,12,12,n); setEase(prop,2,90,90,n); }
function easeKey(prop,k,inInf,outInf,n){ setEase(prop,k,inInf,outInf,n); }
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

app.beginUndoGroup("GR — scene5");
try{
  var made=[];
  var lab=mkText("S5-lab","FIG.05  /  TIMING · PHYSICS",22,GREY,"SBSansInterface-Regular","L",180).L;
  lab.property("Position").setValue([MARGIN,152]); made.push(lab);
  var idx=mkText("S5-idx","05 — 06",26,VERM,"SBSansInterface-Regular","R",220).L;
  idx.property("Position").setValue([W-MARGIN,120]); made.push(idx);

  var hero=mkText("S5-hero","TIMING",190,PAPER,"SBSansDisplay-Bold","L",-14,true);
  hero.L.property("Anchor Point").setValue([0,0]); hero.L.property("Position").setValue([MARGIN,300]); made.push(hero.L);
  var hp=hero.L.property("Position"); key(hp,ST+0.2,[MARGIN-70,300]); key(hp,ST+1.0,[MARGIN,300]); reveal(hp,2);

  // eased count-up number, huge, right-aligned
  var num=mkText("S5-num","0%",240,PAPER,"SBSansDisplay-Bold","R",-10,true);
  num.L.property("Position").setValue([W-MARGIN, 640]);
  num.st.expression="s=20.3; e=23.0; v=ease(time,s,e,0,100); Math.round(v)+'%'";
  made.push(num.L);
  var nlab=mkText("S5-nlab","ease( time , 0 , 100 )",26,GREY,"CourierNewPSMT","R",20).L;
  nlab.property("Position").setValue([W-MARGIN, 700]); made.push(nlab);

  // bouncing ball with velocity-driven squash-stretch
  var floor=905;
  var ball=makeDot("S5-ball",VERM,74); ball.property("Anchor Point").setValue([0,37]); ball.motionBlur=true;
  var bp=ball.property("Position");
  var seq=[[20.3,250,600],[20.75,430,floor],[21.15,560,690],[21.6,740,floor],[21.9,850,760],
          [22.35,1030,floor],[22.68,1140,800],[23.1,1320,floor],[23.4,1430,845],[23.8,1600,floor],[24.6,1700,floor]];
  for(var i=0;i<seq.length;i++){ key(bp,seq[i][0],[seq[i][1],seq[i][2]]); }
  // ease: apex keys hang (high inf), floor keys snap (low inf)
  for(var i=1;i<=seq.length;i++){
    var isFloor = (Math.abs(seq[i-1][2]-floor)<1);
    var inf = isFloor? 20 : 85;
    easeKey(bp,i,inf,inf,1);
  }
  bp.setInterpolationTypeAtKey(seq.length,KeyframeInterpolationType.BEZIER,KeyframeInterpolationType.BEZIER);
  var bs=ball.property("Scale");
  bs.expression="v=thisLayer.transform.position.velocity; k=clamp(v[1]/2600,-0.32,0.32); [ (1-k)*100, (1+k)*100 ]";
  made.push(ball);
  // floor rule
  var fr=comp.layers.addSolid(GREY,"S5-floor",W-MARGIN*2,2,1);
  fr.property("Anchor Point").setValue([0,0]); fr.property("Position").setValue([MARGIN,floor+1]);
  fr.property("Opacity").setValue(45); made.push(fr);
  var frl=mkText("S5-frl","velocity-driven squash & stretch",22,GREY,"SBSansInterface-Regular","L",80).L;
  frl.property("Position").setValue([MARGIN,960]); made.push(frl);

  for(var i=0;i<made.length;i++){ win(made[i],ST,EN+0.02); fadeInOut(made[i],ST,EN); }
  comp.time = ST+1.4;
}finally{ app.endUndoGroup(); }
JSON.stringify({ok:true, layers:comp.numLayers, numFont:num.got});
