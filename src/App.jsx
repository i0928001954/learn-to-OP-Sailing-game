import { useState, useEffect, useRef, useCallback } from "react";

const CANVAS_W = 800;
const CANVAS_H = 700;
const BOAT_SIZE = 22;
const MARK_RADIUS = 28;
const VERSION = "v1.1";
const LAST_UPDATED = "2026-05-16";
const MAX_SPEED = 3.0; // knots display max

function polarSpeed(a) {
  const ab = Math.abs(a);
  if (ab < 40) return 0.04;
  if (ab < 60) return 0.45 + (ab - 40) * 0.018;
  if (ab < 100) return 0.72 + (ab - 60) * 0.004;
  if (ab < 135) return 0.8 - (ab - 100) * 0.003;
  return 0.65;
}
function optimalSailAngle(a) {
  const ab = Math.abs(a);
  if (ab < 40) return 5;
  if (ab < 90) return (ab - 40) * 1.33; // 0→5, 90→100
  if (ab < 135) return 100 - (ab - 90) * 0.5; // downwind eases slightly
  return 80;
}

const LEVELS = [
  { id:1, name:"順風衝刺",    windDir:0,   windSpeed:9, marks:[{x:400,y:80,label:"終點"}],                                                startPos:{x:400,y:620}, startHeading:0,   tip:"順風時把帆放開！" },
  { id:2, name:"側風橫渡",    windDir:270, windSpeed:9, marks:[{x:720,y:350,label:"終點"}],                                               startPos:{x:80,y:350},  startHeading:90,  tip:"側風時帆角約45°！" },
  { id:3, name:"迎風搶風",    windDir:0,   windSpeed:9, marks:[{x:400,y:70,label:"上風標"}],                                              startPos:{x:400,y:630}, startHeading:315, tip:"逆風走Z字形（Tacking）！" },
  { id:4, name:"繞下風標",    windDir:0,   windSpeed:9, marks:[{x:400,y:600,label:"下風標"},{x:400,y:90,label:"終點"}],                  startPos:{x:400,y:90},  startHeading:180, tip:"繞過兩個浮標到終點！" },
  { id:5, name:"三角繞標賽",  windDir:350, windSpeed:10, marks:[{x:400,y:80,label:"上風標"},{x:680,y:530,label:"側風標"},{x:120,y:530,label:"終點"}], startPos:{x:400,y:630}, startHeading:5, tip:"順序經過三個浮標！" },
];

const BEAR_TIPS = {
  noGoZone:  {voice: false, text: ["這方向頂風，船在罷工啦！快轉！","嗯哼，進死角了！換個角度！","頂風衝？勇氣可嘉但船不動喔！"]},
  sailTooIn: {voice: false, text: ["帆繃那麼緊幹嘛，讓風進來啊！","帆角太小，風都憋死了！放開！","帆縮那麼緊，船飛不起來啦！"]},
  sailTooOut:{voice: false, text: ["帆放那麼開，是在晾衣服嗎？","帆都快飛走了！快收一點！","帆角太大，風都跑光了！收！"]},
  goodSpeed: {voice: true,  text: ["就這樣！年輕人有希望！","速度到位！老師我感動了！"]},
  slowSpeed: {voice: true,  text: ["這速度，龜都比你快啦！","動起來！老師我看了很著急！"]},
  nearMark:  {voice: false, text: ["那個浮標！繞過去！","快到了！眼睛放亮！","目標在眼前，漂亮繞過去！"]},
  tacking:   {voice: false, text: ["換舷！帆跟著換邊！","Z字形走法，這才是帆船精髓！","漂亮轉彎！帆調好！"]},
  finish:    {voice: true,  text: ["開得好！教練請你吃鬆餅！"]},
  start:     {voice: true,  text: ["出發！讓風看看你多厲害！","預備——衝！帥氣的！","年輕人，展示你的本事！走！"]},
};
function getBearTip(cat) {
  const tips=BEAR_TIPS[cat];
  const idx=Math.floor(Math.random()*tips.text.length);
  return {voice:tips.voice, text:tips.text[idx], idx};
}

// Shared audio element — reuse to avoid overlapping voices
let _bearAudio = null;
function _stopBearAudio() { if(_bearAudio){ _bearAudio.pause(); _bearAudio.currentTime=0; } }

let voicesLoaded = false;
function speakBear(cat, idx, text, shouldSpeak) {
  if (!shouldSpeak) return;
  _stopBearAudio();
  // Try pre-recorded MP3 first (public/audio/<cat>_<idx>.mp3)
  const audio = new Audio(`/audio/${cat}_${idx}.mp3`);
  audio.volume = 1;
  _bearAudio = audio;
  audio.play().catch(() => {
    // Fallback: browser speechSynthesis
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang="zh-TW"; utt.rate=0.9; utt.pitch=0.65; utt.volume=1;
    const tryVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const prefer = ["Zhiwei","Yunjian","Yunfeng","Yu-shu","Tong","Liang","Ming","Kun","Yu","Daniel"];
      const maleZh = voices.find(v=>(v.lang.startsWith("zh")||v.lang.startsWith("cmn"))&&prefer.some(n=>v.name.includes(n)));
      const anyZh  = voices.find(v=> v.lang.startsWith("zh")||v.lang.startsWith("cmn"));
      if (maleZh) utt.voice=maleZh; else if (anyZh) utt.voice=anyZh;
      window.speechSynthesis.speak(utt);
    };
    if (!voicesLoaded) { window.speechSynthesis.onvoiceschanged=()=>{voicesLoaded=true;tryVoice();}; tryVoice(); }
    else tryVoice();
  });
}

// ─── speed zone config ───────────────────────────────────────────
// ratio = speed / MAX_SPEED  (0-1)
function speedZone(ratio) {
  if (ratio < 0.25) return { label:"無風", color:"#4a7fa5", glow:"rgba(74,127,165,0.3)",  particle:"#7bb8d4" };
  if (ratio < 0.50) return { label:"微風", color:"#22c55e", glow:"rgba(34,197,94,0.35)",  particle:"#86efac" };
  if (ratio < 0.75) return { label:"強風", color:"#facc15", glow:"rgba(250,204,21,0.45)", particle:"#fde68a" };
  return                    { label:"飆速", color:"#f97316", glow:"rgba(249,115,22,0.6)",  particle:"#fb923c" };
}

// ─── Canvas speedometer (drawn inside game canvas, top-left) ─────
function drawSpeedometer(ctx, speed, t) {
  const ratio = Math.min(speed / MAX_SPEED, 1);
  const zone  = speedZone(ratio);
  const cx = 68, cy = 68, R = 52;

  ctx.save();

  // Outer glow ring (pulses at high speed)
  if (ratio > 0.5) {
    const pulse = 0.5 + 0.5 * Math.sin(t * (ratio > 0.75 ? 0.18 : 0.08));
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
    ctx.strokeStyle = zone.glow.replace("0.6", `${0.3 * pulse}`).replace("0.45", `${0.25 * pulse}`).replace("0.35", `${0.2 * pulse}`);
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  // Background disc
  const bg = ctx.createRadialGradient(cx, cy, 4, cx, cy, R);
  bg.addColorStop(0, "rgba(5,20,40,0.92)");
  bg.addColorStop(1, "rgba(5,20,40,0.75)");
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1.5; ctx.stroke();

  // Arc track (background)
  const startA = Math.PI * 0.75;
  const endA   = Math.PI * 2.25;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 8, startA, endA);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.stroke();

  // Arc fill — color gradient based on ratio
  if (ratio > 0.01) {
    const fillEnd = startA + (endA - startA) * ratio;
    const arcGrad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
    arcGrad.addColorStop(0, "#22c55e");
    arcGrad.addColorStop(0.5, "#facc15");
    arcGrad.addColorStop(1, "#f97316");
    ctx.beginPath();
    ctx.arc(cx, cy, R - 8, startA, fillEnd);
    ctx.strokeStyle = arcGrad;
    ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.stroke();

    // Neon tip dot
    const tipX = cx + (R - 8) * Math.cos(fillEnd);
    const tipY = cy + (R - 8) * Math.sin(fillEnd);
    ctx.beginPath(); ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = zone.color; ctx.fill();
    ctx.shadowColor = zone.color; ctx.shadowBlur = 12;
    ctx.fill(); ctx.shadowBlur = 0;
  }

  // Tick marks
  for (let i = 0; i <= 8; i++) {
    const a = startA + (endA - startA) * (i / 8);
    const inner = i % 2 === 0 ? R - 18 : R - 14;
    ctx.beginPath();
    ctx.moveTo(cx + inner * Math.cos(a), cy + inner * Math.sin(a));
    ctx.lineTo(cx + (R - 10) * Math.cos(a), cy + (R - 10) * Math.sin(a));
    ctx.strokeStyle = i % 2 === 0 ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)";
    ctx.lineWidth = i % 2 === 0 ? 1.5 : 1;
    ctx.stroke();
  }

  // Speed number
  const knots = (speed * 10).toFixed(1);
  ctx.fillStyle = zone.color;
  ctx.font = `bold ${ratio > 0.6 ? 18 : 16}px 'Courier New', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Shadow glow at high speed
  if (ratio > 0.5) { ctx.shadowColor = zone.color; ctx.shadowBlur = 10; }
  ctx.fillText(knots, cx, cy - 4);
  ctx.shadowBlur = 0;

  // Unit
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px sans-serif";
  ctx.fillText("kn", cx, cy + 12);

  // Zone label
  ctx.font = `bold 10px sans-serif`;
  ctx.fillStyle = zone.color;
  ctx.fillText(zone.label, cx, cy + 26);

  ctx.restore();
}

// ─── Speed particles (emitted near boat at high speed) ────────────
const particles = [];
function emitParticles(x, y, heading, speed, t) {
  const ratio = Math.min(speed / MAX_SPEED, 1);
  if (ratio < 0.45) return;
  const zone = speedZone(ratio);
  const count = ratio > 0.75 ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const rad = ((heading + 180 + (Math.random() - 0.5) * 30) * Math.PI) / 180;
    particles.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.sin(rad) * (1.5 + Math.random() * 2),
      vy: -Math.cos(rad) * (1.5 + Math.random() * 2),
      life: 1,
      decay: 0.04 + Math.random() * 0.03,
      color: zone.particle,
      size: 2 + Math.random() * 2.5,
    });
  }
}
function updateParticles(ctx) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    const alpha = p.life * 0.7;
    ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2,"0");
    ctx.fill();
  }
}

// ─── Speed streak lines (at very high speed) ─────────────────────
function drawSpeedStreaks(ctx, x, y, heading, speed, t) {
  const ratio = Math.min(speed / MAX_SPEED, 1);
  if (ratio < 0.7) return;
  const zone = speedZone(ratio);
  ctx.save();
  ctx.globalAlpha = (ratio - 0.7) / 0.3 * 0.4;
  const rad = ((heading + 180) * Math.PI) / 180;
  const count = Math.floor(ratio * 8);
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 28;
    const len = 20 + Math.random() * 40 * ratio;
    const ox = Math.cos(rad + Math.PI / 2) * spread;
    const oy = Math.sin(rad + Math.PI / 2) * spread;
    ctx.beginPath();
    ctx.moveTo(x + ox, y + oy);
    ctx.lineTo(x + ox + Math.sin(rad) * len, y + oy - Math.cos(rad) * len);
    ctx.strokeStyle = zone.particle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Ocean ────────────────────────────────────────────────────────
function drawOcean(ctx, t, speed) {
  const ratio = Math.min(speed / MAX_SPEED, 1);
  // Ocean gets slightly brighter / more saturated at speed
  const blue1 = `hsl(205,${70 + ratio * 15}%,${26 + ratio * 6}%)`;
  const blue2 = `hsl(205,${60 + ratio * 10}%,${38 + ratio * 8}%)`;
  const grad = ctx.createLinearGradient(0,0,0,CANVAS_H);
  grad.addColorStop(0, blue1); grad.addColorStop(1, blue2);
  ctx.fillStyle = grad; ctx.fillRect(0,0,CANVAS_W,CANVAS_H);

  // Wave speed increases with boat speed
  const waveSpeed = 0.25 + ratio * 0.6;
  ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1.5;
  for (let i = 0; i < 10; i++) {
    const y = (i * 80 + t * waveSpeed) % CANVAS_H;
    ctx.beginPath();
    for (let x = 0; x < CANVAS_W; x += 4) {
      const wy = y + Math.sin(x * 0.018 + t * 0.04 + i) * (5 + ratio * 6);
      x === 0 ? ctx.moveTo(x, wy) : ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }
}

function drawWindArrows(ctx, windDir) {
  ctx.save(); ctx.globalAlpha = 0.12; ctx.strokeStyle="#fff"; ctx.lineWidth=1.5;
  for (let gx=70; gx<CANVAS_W; gx+=130)
    for (let gy=70; gy<CANVAS_H; gy+=130) {
      ctx.save(); ctx.translate(gx,gy); ctx.rotate(windDir*Math.PI/180);
      ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(0,14); ctx.moveTo(0,-14); ctx.lineTo(-5,-4); ctx.moveTo(0,-14); ctx.lineTo(5,-4);
      ctx.stroke(); ctx.restore();
    }
  ctx.restore();
}

function drawMark(ctx, mark, reached, isNext) {
  ctx.save(); ctx.translate(mark.x, mark.y);
  if (isNext) { ctx.beginPath(); ctx.arc(0,0,MARK_RADIUS+9,0,Math.PI*2); ctx.fillStyle="rgba(255,210,0,0.18)"; ctx.fill(); }
  ctx.beginPath(); ctx.arc(0,0,MARK_RADIUS,0,Math.PI*2);
  ctx.fillStyle = reached ? "#22c55e" : isNext ? "#facc15" : "#f97316";
  ctx.fill(); ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle="#fff"; ctx.font="bold 10px sans-serif"; ctx.textAlign="center";
  ctx.fillText(mark.label,0,4);
  if (reached) { ctx.font="13px sans-serif"; ctx.fillText("✓",0,-6); }
  ctx.restore();
}

// drawBoat
// Coordinate system (after translate+rotate to boat centre):
//   Y-up in screen = -Y in canvas  → bow is at (0, -BOW) moving in -Y direction
//   heading=0 → boat moves toward -Y (screen up) = North ✓
//
// Sail angle convention (matches real OP):
//   0°  → boom points straight to stern (+Y, behind boat)
//   90° → boom points abeam (to the side)
//   100° max → slightly past abeam toward bow
//   windSide +1 = wind from port  → boom goes to starboard (positive X, CW)
//            -1 = wind from starboard → boom goes to port (negative X, CCW)
function drawBoat(ctx, x, y, heading, sailAngle, windSide, speedRatio) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading * Math.PI / 180);

  // ── Shadow ──
  ctx.beginPath();
  ctx.ellipse(1, 1, BOAT_SIZE * 0.38, BOAT_SIZE * 0.92, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  ctx.fill();

  // ── Hull ──
  // bow  = (0, -BOAT_SIZE)   ← sharp, front, moving direction
  // stern= (0, +BOAT_SIZE*0.55) ← wide/round, back
  // Max beam at ~40% from stern
  const BOW  = BOAT_SIZE;
  const STN  = BOAT_SIZE * 0.55;
  const BW   = BOAT_SIZE * 0.42;  // half-beam
  const BEAM_Y = BOAT_SIZE * 0.15; // y of max beam (slightly forward of centre)

  ctx.beginPath();
  ctx.moveTo(0, -BOW);                                          // bow tip
  ctx.bezierCurveTo( BW*0.6, -BOW*0.5,  BW,  BEAM_Y,  BW*0.5,  STN); // starboard
  ctx.bezierCurveTo( BW*0.2,  STN+4,   -BW*0.2, STN+4, -BW*0.5, STN); // stern arc
  ctx.bezierCurveTo(-BW,  BEAM_Y, -BW*0.6, -BOW*0.5,  0, -BOW); // port
  ctx.fillStyle = "#dfc98a";
  ctx.fill();
  ctx.strokeStyle = "#9a7a46";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Waterline stripe near stern
  ctx.beginPath();
  ctx.moveTo(-BW * 0.45, STN - 2);
  ctx.lineTo( BW * 0.45, STN - 2);
  ctx.strokeStyle = "rgba(120,90,40,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Mast ── (at ~30% from bow)
  const mastBaseY = -BOW * 0.35;
  const mastLen   =  BOAT_SIZE * 1.35;
  ctx.beginPath();
  ctx.moveTo(0, mastBaseY);
  ctx.lineTo(0, mastBaseY - mastLen);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2;
  ctx.stroke();

  // ── Sail (clock-hand from mast base) ──
  // 0° → tip points toward stern (+Y), i.e. angle offset = +90° from "up"
  // We map sailAngle so:
  //   sa=0   → tip at (0, +sailLen)  i.e. pointing stern
  //   sa=90  → tip at (±sailLen, 0)  i.e. pointing abeam
  //   sa=100 → tip slightly past abeam toward bow
  const MAX_SA = 100;
  const saRad = (sailAngle / MAX_SA) * (Math.PI * 100 / 180) * windSide;
  // saRad=0 → tip=(0,+1) i.e. stern; saRad=π/2*side → tip=(±1,0) abeam
  const sailLen = mastLen * 0.92;
  const tipX =  Math.sin(saRad) * sailLen;
  const tipY =  Math.cos(saRad) * sailLen;  // +Y = toward stern ✓

  // Bulge: perpendicular to sail direction, scales with speed
  // perpendicular to (sin,cos) is (cos,-sin), outboard = windSide direction
  const bulge = sailLen * 0.42 * Math.min(speedRatio, 1);
  const cpX = tipX * 0.5 + Math.cos(saRad) * bulge * windSide;
  const cpY = tipY * 0.5 - Math.sin(saRad) * bulge * windSide;

  ctx.save();
  ctx.translate(0, mastBaseY);

  // Sail fill
  const sailAlpha = 0.08 + speedRatio * 0.22;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
  ctx.lineTo(0, 0);
  ctx.fillStyle = `rgba(255,255,255,${sailAlpha})`;
  ctx.fill();

  // Sail line — thicker + brighter at speed
  const lineW  = 1.8 + speedRatio * 2.2;
  const bright = Math.round(155 + speedRatio * 100);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
  ctx.strokeStyle = `rgb(${bright},${bright},${bright})`;
  ctx.lineWidth = lineW;
  ctx.lineCap = "round";
  ctx.stroke();

  // Pivot dot
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#888";
  ctx.fill();

  ctx.restore();
  ctx.restore();
}

// ─── Joystick ────────────────────────────────────────────────────
function Joystick({ onRudder }) {
  const activeRef=useRef(false), startYRef=useRef(0);
  const TRACK_H=110, KNOB_R=22;
  const [knobY, setKnobY]=useState(0);
  const update = useCallback(rawY=>{
    const c=Math.max(-1,Math.min(1,rawY)); setKnobY(c); onRudder(-c);
  },[onRudder]);
  const onPD=e=>{ e.currentTarget.setPointerCapture(e.pointerId); activeRef.current=true; startYRef.current=e.clientY; };
  const onPM=e=>{ if(!activeRef.current) return; update((e.clientY-startYRef.current)/(TRACK_H/2)); };
  const onPU=()=>{ activeRef.current=false; setKnobY(0); onRudder(0); };
  const knobPx=knobY*(TRACK_H/2-KNOB_R);
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flex:1,minWidth:70}}>
      <span style={{fontSize:10,color:"#7ed6ff",fontWeight:600}}>🚢 舵</span>
      <div style={{fontSize:9,color:"#4a8aaa",lineHeight:1.3,textAlign:"center"}}>上推右轉<br/>下拉左轉</div>
      <div onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}
        style={{width:KNOB_R*2+8,height:TRACK_H,background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(96,180,255,0.3)",borderRadius:KNOB_R+4,position:"relative",cursor:"grab",touchAction:"none",WebkitTapHighlightColor:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",width:"60%",height:1,background:"rgba(255,255,255,0.2)",borderRadius:1}}/>
        <div style={{position:"absolute",left:"50%",top:"50%",transform:`translate(-50%,calc(-50% + ${knobPx}px))`,width:KNOB_R*2,height:KNOB_R*2,borderRadius:"50%",background:knobY===0?"radial-gradient(circle at 35% 35%,#7ed6ff,#1a6fa8)":"radial-gradient(circle at 35% 35%,#fbbf24,#b45309)",boxShadow:"0 2px 8px rgba(0,0,0,0.4)",pointerEvents:"none"}}/>
        <div style={{position:"absolute",top:5,left:"50%",transform:"translateX(-50%)",color:"rgba(255,255,255,0.25)",fontSize:14,pointerEvents:"none"}}>▲</div>
        <div style={{position:"absolute",bottom:5,left:"50%",transform:"translateX(-50%)",color:"rgba(255,255,255,0.25)",fontSize:14,pointerEvents:"none"}}>▼</div>
      </div>
      <span style={{fontSize:10,color:knobY===0?"#3a6a8a":"#fbbf24",fontWeight:600}}>
        {knobY<-0.1?"◀右轉":knobY>0.1?"左轉▶":"直行"}
      </span>
    </div>
  );
}

function SailSlider({ value, onChange }) {
  const activeRef=useRef(false), startYRef=useRef(0), startValRef=useRef(value);
  const TRACK_H=110, KNOB_R=22;
  const knobPx=((value/90)-0.5)*(-(TRACK_H-KNOB_R*2));
  const onPD=e=>{ e.currentTarget.setPointerCapture(e.pointerId); activeRef.current=true; startYRef.current=e.clientY; startValRef.current=value; };
  const onPM=e=>{ if(!activeRef.current) return; const dy=e.clientY-startYRef.current; onChange(Math.max(0,Math.min(100,startValRef.current-(dy/(TRACK_H-KNOB_R*2))*100))); };
  const onPU=()=>{ activeRef.current=false; };
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flex:1,minWidth:70}}>
      <span style={{fontSize:10,color:"#f97316",fontWeight:600}}>⛵ 帆角</span>
      <div style={{fontSize:9,color:"#4a8aaa",lineHeight:1.3,textAlign:"center"}}>上推收帆<br/>下拉放帆</div>
      <div onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}
        style={{width:KNOB_R*2+8,height:TRACK_H,background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(249,115,22,0.35)",borderRadius:KNOB_R+4,position:"relative",cursor:"ns-resize",touchAction:"none",WebkitTapHighlightColor:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{position:"absolute",left:"50%",top:KNOB_R,bottom:KNOB_R,width:3,transform:"translateX(-50%)",background:"linear-gradient(to bottom,rgba(249,115,22,0.5),rgba(96,200,255,0.3))",borderRadius:2}}/>
        <div style={{position:"absolute",left:"50%",top:"50%",transform:`translate(-50%,calc(-50% + ${knobPx}px))`,width:KNOB_R*2,height:KNOB_R*2,borderRadius:"50%",background:"radial-gradient(circle at 35% 35%,#fdba74,#c2410c)",boxShadow:"0 2px 8px rgba(0,0,0,0.4)",pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",fontWeight:700}}>
          {Math.round(value)}°
        </div>
        <div style={{position:"absolute",top:5,left:"50%",transform:"translateX(-50%)",color:"rgba(255,255,255,0.25)",fontSize:14,pointerEvents:"none"}}>▲</div>
        <div style={{position:"absolute",bottom:5,left:"50%",transform:"translateX(-50%)",color:"rgba(255,255,255,0.25)",fontSize:14,pointerEvents:"none"}}>▼</div>
      </div>
      <span style={{fontSize:10,color:"#f97316",fontWeight:600}}>{value<20?"收帆":value>70?"放帆":"側風"}</span>
    </div>
  );
}

// ════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════
export default function OPSailboatGame() {
  const canvasRef = useRef(null);
  const gameRef = useRef({ x:400,y:620,heading:0,speed:0,sailAngle:45,angleDiff:0,currentMark:0,startTime:null,elapsed:0,finished:false,t:0,trail:[] });
  const keysRef = useRef({});
  const rudderRef = useRef(0);

  const [levelIdx, setLevelIdx] = useState(0);
  const [gameState, setGameState] = useState("menu");
  const [coachOn, setCoachOn] = useState(true);
  const [bearMsg, setBearMsg] = useState("");
  const [bearVisible, setBearVisible] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [currentMark, setCurrentMark] = useState(0);
  const [sailAngleDisplay, setSailAngleDisplay] = useState(45);
  const [speedDisplay, setSpeedDisplay] = useState(0);
  const [speedRatio, setSpeedRatio] = useState(0); // for CSS overlay effects
  const [records, setRecords] = useState(()=>{ try{return JSON.parse(localStorage.getItem("op_records3")||"{}")}catch{return{}} });

  const bearTimerRef=useRef(null), animRef=useRef(null), lastBearCatRef=useRef("");
  const coachOnRef=useRef(coachOn);
  useEffect(()=>{ coachOnRef.current=coachOn; },[coachOn]);

  const level = LEVELS[levelIdx];

  const showBear = useCallback(cat=>{
    if(!coachOnRef.current) return;
    if(lastBearCatRef.current===cat) return;
    lastBearCatRef.current=cat;
    const tip=getBearTip(cat);
    setBearMsg(tip.text); setBearVisible(true); speakBear(cat, tip.idx, tip.text, tip.voice);
    if(bearTimerRef.current) clearTimeout(bearTimerRef.current);
    bearTimerRef.current=setTimeout(()=>{ setBearVisible(false); lastBearCatRef.current=""; },4000);
  },[]);

  const startLevel = useCallback(idx=>{
    const lv=LEVELS[idx]; const g=gameRef.current;
    Object.assign(g,{x:lv.startPos.x,y:lv.startPos.y,heading:lv.startHeading,speed:0,sailAngle:45,angleDiff:0,currentMark:0,startTime:null,elapsed:0,finished:false,t:0,trail:[]});
    rudderRef.current=0;
    setCurrentMark(0); setElapsed(0); setSailAngleDisplay(45); setSpeedDisplay(0); setSpeedRatio(0);
    setGameState("playing"); setBearVisible(false); lastBearCatRef.current="";
    setTimeout(()=>showBear("start"),700);
  },[showBear]);

  // ── Game loop ──────────────────────────────────────────────────
  useEffect(()=>{
    if(gameState!=="playing") return;
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext("2d");
    let lastTime=performance.now(), prevWindSide=0;

    function loop(now){
      const dt=Math.min((now-lastTime)/1000,0.05); lastTime=now;
      const g=gameRef.current; const lv=LEVELS[levelIdx];
      if(g.finished) return;
      g.t+=dt*60;
      if(!g.startTime&&g.speed>0.05) g.startTime=now;
      if(g.startTime) g.elapsed=(now-g.startTime)/1000;

      // keyboard
      const keys=keysRef.current;
      if(keys["ArrowLeft"])  rudderRef.current=Math.max(rudderRef.current-dt*3.5,-1);
      else if(keys["ArrowRight"]) rudderRef.current=Math.min(rudderRef.current+dt*3.5,1);
      if(keys["ArrowUp"])   g.sailAngle=Math.min(g.sailAngle+dt*38,100);
      if(keys["ArrowDown"]) g.sailAngle=Math.max(g.sailAngle-dt*38,0);

      // physics
      const windFrom=(lv.windDir+180)%360;
      g.angleDiff=((g.heading-windFrom+540)%360)-180;
      const optSail=optimalSailAngle(Math.abs(g.angleDiff));
      const sailEff=Math.max(0,1-Math.abs(g.sailAngle-optSail)/72);
      const targetSpeed=polarSpeed(g.angleDiff)*sailEff*lv.windSpeed*0.22;
      const accel = targetSpeed > g.speed ? 1.6 : 0.42;
      g.speed+=(targetSpeed-g.speed)*dt*accel;

      // angleDiff>0: wind from port(left) → boom goes starboard(+1 CW); <0: wind from starboard → boom goes port(-1 CCW)
      const windSide = g.angleDiff >= 0 ? 1 : -1;
      if(prevWindSide!==0&&windSide!==prevWindSide) showBear("tacking");
      prevWindSide=windSide;

      const turnRate=rudderRef.current*Math.max(g.speed,0.55)*36;
      g.heading=(g.heading+turnRate*dt+360)%360;
      const rad=g.heading*Math.PI/180;
      g.x=Math.max(15,Math.min(CANVAS_W-15,g.x+Math.sin(rad)*g.speed*dt*60));
      g.y=Math.max(15,Math.min(CANVAS_H-15,g.y-Math.cos(rad)*g.speed*dt*60));

      if(g.trail.length===0||Math.hypot(g.x-g.trail[0].x,g.y-g.trail[0].y)>10){
        g.trail.unshift({x:g.x,y:g.y}); if(g.trail.length>80) g.trail.pop();
      }

      // mark check
      const mark=lv.marks[g.currentMark];
      if(mark&&Math.hypot(g.x-mark.x,g.y-mark.y)<MARK_RADIUS+BOAT_SIZE+4){
        if(g.currentMark<lv.marks.length-1){ g.currentMark++; setCurrentMark(g.currentMark); showBear("nearMark"); }
        else{
          g.finished=true; const ft=g.elapsed; setElapsed(ft); setGameState("finished"); showBear("finish");
          setRecords(prev=>{ const k=`lv${lv.id}`; const u=(!prev[k]||ft<prev[k])?{...prev,[k]:ft}:prev; try{localStorage.setItem("op_records3",JSON.stringify(u))}catch{}; return u; });
          return;
        }
      }

      // coach
      if(Math.abs(g.angleDiff)<40&&g.speed<0.2) showBear("noGoZone");
      else if(g.sailAngle<optSail-30&&g.speed>0.15&&Math.abs(g.angleDiff)>35) showBear("sailTooIn");
      else if(g.sailAngle>Math.min(optSail+30,100)&&g.speed>0.15&&Math.abs(g.angleDiff)>35) showBear("sailTooOut");
      else if(g.speed>targetSpeed*0.85&&targetSpeed>0.5) showBear("goodSpeed");
      else if(targetSpeed>0.3&&g.speed<targetSpeed*0.4&&g.elapsed>3) showBear("slowSpeed");
      if(mark&&Math.hypot(g.x-mark.x,g.y-mark.y)<80) showBear("nearMark");

      const ratio=Math.min(g.speed/MAX_SPEED,1);
      setElapsed(g.elapsed); setSailAngleDisplay(Math.round(g.sailAngle));
      setSpeedDisplay(+(g.speed*10).toFixed(1)); setSpeedRatio(ratio);

      // ── Draw ──
      drawOcean(ctx, g.t, g.speed);
      drawWindArrows(ctx, lv.windDir);

      // Trail
      ctx.save();
      for(let i=0;i<g.trail.length-1;i++){
        ctx.strokeStyle=`rgba(255,255,255,${(1-i/g.trail.length)*0.18})`;
        ctx.lineWidth=2; ctx.beginPath();
        ctx.moveTo(g.trail[i].x,g.trail[i].y); ctx.lineTo(g.trail[i+1].x,g.trail[i+1].y); ctx.stroke();
      }
      ctx.restore();

      // Speed FX
      emitParticles(g.x, g.y, g.heading, g.speed, g.t);
      updateParticles(ctx);
      drawSpeedStreaks(ctx, g.x, g.y, g.heading, g.speed, g.t);

      lv.marks.forEach((mk,i)=>drawMark(ctx,mk,i<g.currentMark,i===g.currentMark));
      drawBoat(ctx,g.x,g.y,g.heading,g.sailAngle,windSide,ratio);

      // ── Speedometer — top left ──
      drawSpeedometer(ctx, g.speed, g.t);

      // Wind compass — top right
      ctx.save(); ctx.translate(CANVAS_W-48,48);
      ctx.beginPath(); ctx.arc(0,0,32,0,Math.PI*2); ctx.fillStyle="rgba(0,0,0,0.42)"; ctx.fill();
      ctx.strokeStyle="rgba(255,255,255,0.18)"; ctx.lineWidth=1; ctx.stroke();
      ctx.rotate(lv.windDir*Math.PI/180);
      ctx.strokeStyle="#60c8ff"; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.moveTo(0,18); ctx.lineTo(0,-18); ctx.moveTo(0,-18); ctx.lineTo(-5,-8); ctx.moveTo(0,-18); ctx.lineTo(5,-8);
      ctx.stroke(); ctx.restore();
      ctx.fillStyle="#60c8ff"; ctx.font="10px sans-serif"; ctx.textAlign="center";
      ctx.fillText("風",CANVAS_W-48,90);

      animRef.current=requestAnimationFrame(loop);
    }
    animRef.current=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(animRef.current);
  },[gameState,levelIdx,showBear]);

  useEffect(()=>{
    const down=e=>{ if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) e.preventDefault(); keysRef.current[e.key]=true; };
    const up=e=>{ keysRef.current[e.key]=false; };
    window.addEventListener("keydown",down); window.addEventListener("keyup",up);
    return ()=>{ window.removeEventListener("keydown",down); window.removeEventListener("keyup",up); };
  },[]);

  const handleRudder=useCallback(v=>{ rudderRef.current=v; },[]);
  const handleSail=useCallback(v=>{ gameRef.current.sailAngle=v; },[]);
  const fmtTime=s=>`${Math.floor(s/60)}:${(s%60).toFixed(2).padStart(5,"0")}`;

  // speed zone for CSS effects
  const zone = speedZone(speedRatio);

  // ─── MENU ────────────────────────────────────────────────────────
  if(gameState==="menu") return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#051e34 0%,#0a4a72 55%,#0b6daa 100%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Noto Sans TC','PingFang TC',sans-serif",color:"#fff",padding:"20px",userSelect:"none"}}>
      <div style={{fontSize:58}}>⛵</div>
      <h1 style={{fontSize:"clamp(20px,5vw,34px)",fontWeight:900,letterSpacing:2,margin:"6px 0 4px",background:"linear-gradient(90deg,#fff,#7ed6ff)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>OP 小帆船學習遊戲</h1>
      <p style={{color:"#7ed6ff",fontSize:13,margin:"0 0 6px"}}>掌握風帆，成為海上飛人！</p>
      <p style={{color:"rgba(126,214,255,0.5)",fontSize:10,margin:"0 0 16px",letterSpacing:1}}>{VERSION} · 更新：{LAST_UPDATED}</p>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,background:"rgba(255,255,255,0.08)",borderRadius:30,padding:"8px 18px"}}>
        <span style={{fontSize:22}}>🐻</span><span style={{fontSize:13}}>黑熊教練語音</span>
        <button onClick={()=>setCoachOn(p=>!p)} style={{width:46,height:24,borderRadius:12,border:"none",cursor:"pointer",background:coachOn?"#22c55e":"#555",transition:"background 0.2s",position:"relative"}}>
          <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:coachOn?25:3,transition:"left 0.2s"}}/>
        </button>
        <span style={{fontSize:11,color:"#adf"}}>{coachOn?"ON 🔊":"OFF"}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,width:"100%",maxWidth:500,marginBottom:16}}>
        {LEVELS.map((lv,i)=>{ const rec=records[`lv${lv.id}`]; return (
          <button key={lv.id} onClick={()=>{setLevelIdx(i);startLevel(i);}}
            style={{background:"rgba(255,255,255,0.09)",border:"1px solid rgba(255,255,255,0.18)",borderRadius:12,padding:"12px 8px",cursor:"pointer",color:"#fff",transition:"all 0.18s",textAlign:"center"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.2)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.09)"}>
            <div style={{fontSize:20,marginBottom:4}}>{["🌊","💨","⬆️","🔄","🏁"][i]}</div>
            <div style={{fontWeight:700,fontSize:12,marginBottom:2}}>關卡 {lv.id}</div>
            <div style={{fontSize:11,color:"#7ed6ff",marginBottom:4}}>{lv.name}</div>
            {rec&&<div style={{fontSize:10,color:"#fbbf24"}}>🏆 {fmtTime(rec)}</div>}
          </button>
        );})}
      </div>
      <div style={{background:"rgba(0,0,0,0.28)",borderRadius:12,padding:"10px 18px",fontSize:12,color:"#adf",textAlign:"center",maxWidth:380}}>
        <div style={{fontWeight:700,color:"#fff",marginBottom:4}}>🎮 操作說明</div>
        <div>📱 左搖桿：上推右轉，下拉左轉，中間直行</div>
        <div style={{marginTop:2}}>📱 右搖桿：上推收帆，下拉放帆</div>
        <div style={{marginTop:2,opacity:0.7}}>⌨️ ← → 轉舵 ｜ ↑ ↓ 調帆角</div>
      </div>
    </div>
  );

  // ─── FINISHED ────────────────────────────────────────────────────
  if(gameState==="finished"){ const rec=records[`lv${level.id}`]; return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#062a4a,#0a5a8c)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Noto Sans TC','PingFang TC',sans-serif",color:"#fff",padding:20}}>
      <div style={{fontSize:68}}>🎉</div>
      <h2 style={{fontSize:26,fontWeight:900,margin:"6px 0"}}>關卡完成！</h2>
      <p style={{color:"#7ed6ff",margin:"0 0 16px"}}>關卡 {level.id}：{level.name}</p>
      <div style={{background:"rgba(255,255,255,0.1)",borderRadius:16,padding:"18px 40px",textAlign:"center",marginBottom:16}}>
        <div style={{fontSize:12,color:"#adf",marginBottom:4}}>完成時間</div>
        <div style={{fontSize:42,fontWeight:900,fontVariantNumeric:"tabular-nums"}}>{fmtTime(elapsed)}</div>
        {rec&&rec>=elapsed?<div style={{fontSize:13,color:"#22c55e",marginTop:4}}>⭐ 新紀錄！</div>:rec&&<div style={{fontSize:11,color:"#fbbf24",marginTop:4}}>🏆 最佳：{fmtTime(rec)}</div>}
      </div>
      <div style={{fontSize:15,marginBottom:20,color:"#e2f4ff",maxWidth:300,textAlign:"center"}}>🐻 「{getBearTip("finish").text}」</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
        <button onClick={()=>startLevel(levelIdx)} style={{background:"#f97316",border:"none",borderRadius:30,padding:"11px 22px",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>🔄 再玩一次</button>
        {levelIdx<LEVELS.length-1&&<button onClick={()=>{const n=levelIdx+1;setLevelIdx(n);startLevel(n);}} style={{background:"#22c55e",border:"none",borderRadius:30,padding:"11px 22px",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>下一關 ➜</button>}
        <button onClick={()=>setGameState("menu")} style={{background:"rgba(255,255,255,0.14)",border:"1px solid rgba(255,255,255,0.25)",borderRadius:30,padding:"11px 22px",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>🏠 選關</button>
      </div>
    </div>
  ); }

  // ─── PLAYING ─────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#041e36",display:"flex",flexDirection:"column",alignItems:"center",fontFamily:"'Noto Sans TC','PingFang TC',sans-serif",userSelect:"none"}}>

      {/* HUD */}
      <div style={{width:"100%",maxWidth:CANVAS_W,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",background:"rgba(0,0,0,0.65)",boxSizing:"border-box"}}>
        <button onClick={()=>setGameState("menu")} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:8,color:"#fff",padding:"4px 10px",cursor:"pointer",fontSize:12}}>← 選關</button>
        <div style={{display:"flex",gap:14,alignItems:"center"}}>
          {[
            {label:"帆角",val:`${sailAngleDisplay}°`,color:"#f97316"},
            {label:"⏱ 時間",val:fmtTime(elapsed),color:"#fbbf24"},
            {label:"浮標",val:`${currentMark}/${level.marks.length}`,color:"#fff"},
          ].map(({label,val,color})=>(
            <div key={label} style={{textAlign:"center"}}>
              <div style={{fontSize:9,color:"#7ed6ff"}}>{label}</div>
              <div style={{fontSize:14,fontWeight:700,color,fontVariantNumeric:"tabular-nums"}}>{val}</div>
            </div>
          ))}
        </div>
        <button onClick={()=>setCoachOn(p=>!p)} style={{background:coachOn?"rgba(34,197,94,0.28)":"rgba(255,255,255,0.08)",border:"none",borderRadius:8,color:"#fff",padding:"4px 8px",cursor:"pointer",fontSize:12}}>🐻 {coachOn?"ON":"OFF"}</button>
      </div>

      {/* Level strip */}
      <div style={{width:"100%",maxWidth:CANVAS_W,background:"rgba(255,255,255,0.05)",padding:"3px 12px",boxSizing:"border-box",fontSize:10,color:"#adf",display:"flex",justifyContent:"space-between"}}>
        <span>關卡 {level.id}：{level.name}</span>
        <span style={{opacity:0.7}}>💡 {level.tip}</span>
      </div>

      {/* Canvas + overlays */}
      <div style={{position:"relative",width:"100%",maxWidth:CANVAS_W}}>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          style={{width:"100%",display:"block",touchAction:"none"}}
        />

        {/* ── 速度邊框光暈 overlay（CSS，根據速度段顯示不同顏色氛圍） */}
        {speedRatio > 0.45 && (
          <div style={{
            position:"absolute", inset:0, pointerEvents:"none",
            borderRadius:2,
            boxShadow:`inset 0 0 ${40 + speedRatio * 60}px ${zone.glow}`,
            transition:"box-shadow 0.3s ease",
          }}/>
        )}

        {/* ── 飆速時頂部閃光條 */}
        {speedRatio > 0.72 && (
          <div style={{
            position:"absolute", top:0, left:0, right:0, height:3,
            background:`linear-gradient(90deg, transparent, ${zone.color}, transparent)`,
            animation:"flashBar 0.5s ease-in-out infinite alternate",
            pointerEvents:"none",
          }}/>
        )}

        {/* ── 黑熊教練 — 右下角 ── */}
        {bearVisible && coachOn && (
          <div style={{
            position:"absolute", bottom:12, right:10,
            background:"rgba(8,28,52,0.92)",
            border:`1px solid ${coachOn?"rgba(96,200,255,0.3)":"transparent"}`,
            borderRadius:14, padding:"8px 12px",
            color:"#fff", fontSize:"clamp(10px,2.3vw,12px)",
            maxWidth:"62%", display:"flex", alignItems:"flex-start", gap:8,
            boxShadow:"0 4px 20px rgba(0,0,0,0.6)",
            backdropFilter:"blur(6px)",
            animation:"bearIn 0.22s ease", zIndex:10,
            pointerEvents:"none",
          }}>
            <span style={{fontSize:24,flexShrink:0,lineHeight:1}}>🐻</span>
            <span style={{lineHeight:1.45}}>{bearMsg}</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{width:"100%",maxWidth:CANVAS_W,display:"flex",alignItems:"flex-start",justifyContent:"space-around",padding:"10px 16px 16px",gap:12,background:"#041e36",boxSizing:"border-box"}}>
        <Joystick onRudder={handleRudder}/>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,paddingTop:28,color:"#2a5a7a",fontSize:10,textAlign:"center"}}>
          <span style={{fontSize:22}}>⛵</span><span>操控台</span>
        </div>
        <SailSlider value={sailAngleDisplay} onChange={handleSail}/>
      </div>

      <style>{`
        @keyframes bearIn {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes flashBar {
          from { opacity:0.5; }
          to   { opacity:1; }
        }
        button:active { filter: brightness(1.25); }
      `}</style>
    </div>
  );
}
