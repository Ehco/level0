/* Staged screenshot dumper: boots the real game headless, injects a scene,
   renders, and writes the 320x180 framebuffer as a nearest-neighbor x4 PNG. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const zlib = require('zlib');

const html = fs.readFileSync('C:/Users/Administrator/level0/index.html', 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];

function param(){ return { value: 0, setTargetAtTime(){}, setValueAtTime(){}, exponentialRampToValueAtTime(){} }; }
function nodeStub(){ return { gain: param(), frequency: param(), Q: param(), playbackRate: param(),
  type: '', connect(){}, start(){}, stop(){}, buffer: null, loop: false }; }
function AudioContextStub(){
  this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; this.state = 'running';
  AC_INSTANCES.push(this);
}
const AC_INSTANCES = [];
AudioContextStub.prototype.createGain = function(){ return nodeStub(); };
AudioContextStub.prototype.createOscillator = function(){ return nodeStub(); };
AudioContextStub.prototype.createBiquadFilter = function(){ return nodeStub(); };
AudioContextStub.prototype.createBuffer = function(ch, len){ return { getChannelData: () => new Float32Array(len) }; };
AudioContextStub.prototype.createBufferSource = function(){ return nodeStub(); };
AudioContextStub.prototype.resume = function(){ this.state = 'running'; };

let LAST_FRAME = null;                       // captured ImageData from putImageData
function ctxStub(){
  const store = {};
  return new Proxy(store, {
    get(o, k){
      if (k in o) return o[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop(){} });
      if (k === 'createImageData' || k === 'getImageData')
        return (a, b) => ({ data: new Uint8ClampedArray(a * b * 4), width: a, height: b });
      if (k === 'putImageData') return (im) => { LAST_FRAME = im; };
      if (typeof k === 'string' && /^[a-z_][a-z0-9_]*$/i.test(k)){ const f = function(){}; o[k] = f; return f; }
      return undefined;
    },
    set(o, k, v){ o[k] = v; return true; }
  });
}
function canvasStub(){
  return { width: 0, height: 0, style: {},
    addEventListener(type, fn){ (EV[type] = EV[type] || []).push(fn); },
    requestPointerLock(){ return { catch(){} }; },
    getContext(){ if (!this._ctx) this._ctx = ctxStub(); return this._ctx; } };
}
function elStub(){
  return { classList: { add(){}, remove(){}, contains(){ return false; } }, style: {}, textContent: '',
    value: '', addEventListener(type, fn){ (EV[type] = EV[type] || []).push(fn); } };
}
const EV = {};
const rafQ = [];
const sandbox = {
  console, Math, Date, Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array, Float32Array,
  Map, Infinity, isNaN, parseFloat, parseInt, JSON, Object, Array, String, Number, Boolean,
  isFinite, RegExp, Error,
  requestAnimationFrame(fn){ rafQ.push(fn); },
  atob(s){ return Buffer.from(s, 'base64').toString('binary'); },
  btoa(s){ return Buffer.from(s, 'binary').toString('base64'); },
  innerWidth: 1280, innerHeight: 720,
  addEventListener(type, fn){ (EV['w:' + type] = EV['w:' + type] || []).push(fn); },
  AudioContext: AudioContextStub
};
sandbox.window = sandbox;
sandbox.document = {
  getElementById(id){ if (id === 'cv'){ if (!this._cv) this._cv = canvasStub(); return this._cv; }
    if (!this._els[id]) this._els[id] = elStub(); return this._els[id]; },
  createElement(tag){ return tag === 'canvas' ? canvasStub() : elStub(); },
  addEventListener(type, fn){ (EV['d:' + type] = EV['d:' + type] || []).push(fn); },
  pointerLockElement: null,
  exitPointerLock(){},
  _els: {}
};
sandbox.performance = { now: () => NOW };
sandbox.stepFramesRef = function(n){ stepFrames(n); };
vm.createContext(sandbox);

let NOW = 0;
function stepFrames(n, frameMs = 16.667){
  for (let i = 0; i < n; i++){
    NOW += frameMs;
    for (const ac of AC_INSTANCES) ac.currentTime += frameMs / 1000;
    const cbs = rafQ.splice(0, rafQ.length);
    for (const cb of cbs) cb(NOW);
  }
}
function fire(type, arg){ for (const fn of (EV[type] || [])) fn(arg); }

vm.runInContext(js, sandbox, { filename: 'game.js' });

/* ---- minimal PNG writer (filter 0 rows, deflate, CRC32) ---- */
function crc32(buf){
  let c, table = crc32.table;
  if (!table){ table = crc32.table = []; for (let n = 0; n < 256; n++){ c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, w, h, rgba){
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++){
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = rgba[y * w * 4 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(path, png);
}
function upscale(rgba, w, h, k){
  const W = w * k, H = h * k, out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++){
    const sy = (y / k) | 0;
    for (let x = 0; x < W; x++){
      const sx = (x / k) | 0, si = (sy * w + sx) * 4, di = (y * W + x) * 4;
      out[di] = rgba[si]; out[di+1] = rgba[si+1]; out[di+2] = rgba[si+2]; out[di+3] = 255;
    }
  }
  return out;
}
function shoot(name){
  if (!LAST_FRAME) { console.log('no frame captured for ' + name); return; }
  const W = LAST_FRAME.width, H = LAST_FRAME.height;
  const big = upscale(Buffer.from(LAST_FRAME.data), W, H, 4);
  writePNG('C:/Users/Administrator/AppData/Local/hermes/cache/scratch/l0build/shot_' + name + '.png', W * 4, H * 4, big);
  console.log('wrote shot_' + name + '.png (' + W + 'x' + H + ' -> x4)');
}

/* ---------------------------- drive the staged scenes ---------------------------- */
const L0 = sandbox.window.L0;
function start(seedStr){
  L0.start(seedStr);
  L0.G.graceT = 999;
  stepFrames(2);
}
function placeCritters(list){
  vm.runInContext('CR.length = 0', sandbox);
  for (const c of list) vm.runInContext('CR.push(' + JSON.stringify(c) + ')', sandbox);
}
function findCorridor(){
  // open run along row y=0 east of spawn on the current seed
  let run = [];
  for (let x = 2; x < 30; x++){ if (L0.cell(x, 0) === 0) run.push(x); else if (run.length) break; }
  return run;
}
/* scene 1: corridor with shambler + rat + water + exit */
start('shotA');
const run = findCorridor();
console.log('corridor cells:', run.length, run.slice(0, 12).join(','));
L0.tp(2.5, 0.5, 0);
placeCritters([
  { x: 4.5, y: 0.5, kind: 'shambler', a: Math.PI, turnT: 99, animT: 0.4, waitT: 99 },
  { x: 3.6, y: 1.3, kind: 'rat',     a: Math.PI, turnT: 99, animT: 1.1, waitT: 99 }
]);
vm.runInContext('chunks.get("0,0").props.push({ x: 10.5, y: 1.5, kind: "water", vOff: 0, tilt: 0, scl: 1, rot: 0 }, { x: 13.5, y: 0.5, kind: "exit", vOff: 0, tilt: 0, scl: 1, rot: 0 })', sandbox);
stepFrames(6);
// visibility probe: where do the critters project?
const vis = vm.runInContext(`(() => {
  window.__bbc = 0; window.__mon = 0; window.__crit = 0;
  const orig = renderBillboardAt;
  renderBillboardAt = function(wx, wy, spr){
    __bbc++;
    if (spr && spr.length === 4096) __mon++;
    return orig.apply(this, arguments);
  };
  renderCritters(Math.cos(P.a), Math.sin(P.a), -Math.sin(P.a) * 0.66, Math.cos(P.a) * 0.66, 0.5, 90, 1);
  const direct = __mon;
  renderBillboardAt = orig;
  return JSON.stringify({ critNow: CR.length, monSpriteLen: TEX.mon[0].length,
    probeDraw: (function(){ renderCritters(Math.cos(P.a), Math.sin(P.a), -Math.sin(P.a) * 0.66, Math.cos(P.a) * 0.66, 0.5, 90, 1); return 1; })() });
})()`, sandbox);
console.log('probe:', vis);
const cnt = vm.runInContext(`(function(){
  window.__bbc2 = 0; window.__mon2 = 0;
  const orig = renderBillboardAt;
  renderBillboardAt = function(wx, wy, spr){
    __bbc2++;
    if (spr && spr.length === 4096) __mon2++;
    return orig.apply(this, arguments);
  };
  stepFramesRef(1);
  renderBillboardAt = orig;
  return JSON.stringify({ billboards: __bbc2, monFrames: __mon2, cr: CR.length });
})()`, sandbox);
console.log('frame counts:', cnt);
shoot('corridor');

/* scene 2: descend -> floor 2 tint + toast */
vm.runInContext('G.level = 2; applyLevelTint(); toast("FLOOR 2")', sandbox);
stepFrames(6);
shoot('floor2');

/* scene 3: the Wanderer mid-chase, close */
L0.tp(run[Math.min(2, run.length - 1)] + 0.5, 0.5, 0);
L0.tpMon(6.5, 0.5);
vm.runInContext('M.state = "CHASE"; M.var = MVARS[0]; G.graceT = 0;', sandbox);
stepFrames(4);
shoot('chase');

/* scene 4: the crawler (deep variant) on floor 2 — low, long, dark — plus tinted props */
vm.runInContext('G.level = 2; applyLevelTint();', sandbox);
L0.tp(2.5, 0.5, 0);                                  // run = cells 2..6 only
L0.tpMon(5.5, 0.5);                                  // crawler mid-corridor, 3u out
vm.runInContext(`(() => {
  M.state = "CHASE"; M.var = MVARS[3];
  chunks.get("0,0").props.push(
    { x: 4.5, y: 0.9, kind: "chair", vOff: 0, tilt: 0, scl: 1, rot: 1 });
  return 1;
})()`, sandbox);
stepFrames(4);
shoot('crawler');
console.log('crawler:', JSON.stringify(vm.runInContext('({ var: M.var, x: M.x, y: M.y, lvl: G.level })', sandbox)));

/* scene 5: THE HOUND — floor 2, windup frame (jaw open, eyes lit), mid-corridor */
L0.tp(2.5, 0.5, 0);
L0.tpMon(5.5, 0.5);
vm.runInContext(`(() => {
  M.kind = 'hound';
  M.var = { kind: 'hound', spd: 1.12, sz: 0.68, wd: 1.2, zoff: 0, tint: [0.9, 0.72, 1.1], pitch: 0.55, w: 1 };
  M.state = 'CHASE'; M.lp = 1; M.lpT = 0.4; M.frame = 1; M.animT = 1; M.lostT = 0;
  return 1;
})()`, sandbox);
stepFrames(2);
shoot('hound');
console.log('hound:', JSON.stringify(vm.runInContext('({ kind: M.kind, lp: M.lp, x: M.x, lvl: G.level })', sandbox)));
console.log('errors:', JSON.stringify(L0.errors()));
