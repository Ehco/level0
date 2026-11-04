/* Headless harness: boots the real game code under stubbed DOM/canvas/WebAudio
   and drives gameplay scenarios. Prints AUDIT lines for SELF_AUDIT.md. */
'use strict';
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('C:/Users/Administrator/level0/index.html', 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];

/* ---------- stubs ---------- */
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

function ctxStub(){
  const t = {};
  return { fillRect(){}, clearRect(){}, beginPath(){}, arc(){}, fill(){}, moveTo(){},
    quadraticCurveTo(){}, stroke(){}, ellipse(){}, save(){}, restore(){}, translate(){}, rotate(){},
    lineCap: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    lineTo(){}, arcTo(){}, closePath(){}, clip(){}, scale(){},
    createRadialGradient(){ return { addColorStop(){} }; },
    createLinearGradient(){ return { addColorStop(){} }; },
    createImageData(w, h){ return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    drawImage(){}, putImageData(){},
    getImageData(x, y, w, h){ return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    _t: t };
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
  atob(s){ return Buffer.from(s, 'base64').toString('latin1'); },
  requestAnimationFrame(fn){ rafQ.push(fn); },
  setTimeout(fn){ fn(); },                            // squeak double-chirp: fire inline
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
function keydown(code){ fire('d:keydown', { code, repeat: false, target: {}, preventDefault(){} }); }

/* ---------- run the game ---------- */
let out = [];
function A(name, ok, detail){ out.push(`AUDIT | ${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail === undefined ? '' : detail}`); }

vm.runInContext(js, sandbox, { filename: 'game.js' });
const L0 = sandbox.L0;
A('boot: no console errors/warnings', L0.errors().length === 0, JSON.stringify(L0.errors()));
A('boot: title screen', L0.stats().mode === 'title');

/* start with fixed seed, twice => determinism */
L0.start('audit');
const seedA = L0.seed();
const cellA = L0.cell(5, 5) + ',' + L0.cell(31, 7);
stepFrames(30);
L0.start('audit');
A('flow: start() enters play, seed hashed from string', L0.stats().mode === 'play' && seedA === L0.seed(), 'seed=' + seedA.toString(16));
A('world: deterministic regeneration (same seed -> same cells)', cellA === (L0.cell(5, 5) + ',' + L0.cell(31, 7)));

/* render sanity: pixel buffer is being written */
const pix = sandbox.L0.G && (() => {
  stepFrames(5);
  let lit = 0, colors = new Set();
  const R = vm.runInContext('R', sandbox);
  for (let i = 0; i < R.W * R.H; i++){ const c = R.pix[i] >>> 0; if (c !== 0xff000000){ lit++; colors.add(c & 0xffffff); } }
  return { lit, distinct: colors.size, W: R.W, H: R.H };
})();
A('render: tier-1 frame paints the buffer', pix.lit > pix.W * pix.H * 0.2, `${pix.lit}/${pix.W * pix.H} px, ${pix.distinct} colors`);

/* movement + collision */
const px0 = +L0.stats().pos[0], py0 = +L0.stats().pos[1];
L0.press('KeyW', true);
stepFrames(120);
L0.press('KeyW', false);
const st1 = L0.stats();
const moved = Math.hypot(st1.pos[0] - px0, st1.pos[1] - py0);
A('player: WASD movement + collision (no tunneling)', moved > 1 && moved < 12, `moved ${moved.toFixed(2)}u in 2s`);

/* arrow-only control scheme */
L0.press('ArrowUp', true);
stepFrames(60);
L0.press('ArrowUp', false);
const st2 = L0.stats();
A('player: arrow-only scheme moves the player', Math.hypot(st2.pos[0] - px0, st2.pos[1] - py0) > moved, `now ${Math.hypot(st2.pos[0] - px0, st2.pos[1] - py0).toFixed(2)}u`);

/* dt clamp: 5s tab-out frame */
fire('d:keydown', { code: 'KeyW', repeat: true, target: {}, preventDefault(){} });
stepFrames(1, 5000);
stepFrames(1, 16.667);
L0.press('KeyW', false);
const st3 = L0.stats();
A('player: dt clamp survives 5s stall (no tunneling/NaN)', isFinite(st3.pos[0]) && isFinite(st3.pos[1]) && L0.stats().mode === 'play', `pos ${st3.pos}`);

/* monster: spawn gate + spawn rules */
L0.G.graceT = 0;
stepFrames(3);
const sM = L0.stats();
A('monster: spawned after grace gate', !!sM.monster, JSON.stringify(sM.monster));
A('monster: spawn distance 18-26u, no LOS', sM.monster && sM.monster.dist >= 17.5 && sM.monster.dist <= 26.5, 'dist=' + sM.monster.dist);

/* chase on LOS, search after losing LOS, give up to ROAM */
const mp = L0.stats().pos;
L0.tpMon(+mp[0] + 2, +mp[1], true);
stepFrames(2);
A('monster: LOS -> CHASE', L0.stats().monster.state === 'CHASE', L0.stats().monster.state);

/* dump the monster far away OUT of LOS; hold it there while CHASE so it stays lost */
let placed = false, spot = null;
for (let ang = 0; ang < 8 && !placed; ang++){
  const tx = +mp[0] + Math.cos(ang * 0.785) * 24, ty = +mp[1] + Math.sin(ang * 0.785) * 24;
  if (L0.cell(Math.floor(tx), Math.floor(ty)) !== 0) continue;
  if (L0.los(+mp[0], +mp[1], tx, ty)) continue;      // need a blocked spot
  L0.tpMon(tx, ty); spot = { x: tx, y: ty }; placed = true;
}
A('monster: teleport probe found a no-LOS spot', placed, '');
let sawSearch = false;
for (let i = 0; i < 500 && placed; i++){
  stepFrames(1);
  const mo = L0.stats().monster;
  if (mo.state === 'SEARCH'){ sawSearch = true; break; }
  if (mo.state === 'CHASE') L0.tpMon(spot.x, spot.y);           // hold: never re-acquire
}
A('monster: CHASE -> SEARCH after losing LOS', sawSearch, 'state=' + L0.stats().monster.state);
/* move the player away so the search at the old last-known position finds nothing;
   require the new player pos to have no LOS to the search area */
const pp = L0.stats().pos;
let movedP = false;
for (let t = 30; t < 80 && !movedP; t++){
  const tx = Math.floor(+pp[0]) + t;
  if (L0.cell(tx, Math.floor(+pp[1])) !== 0 || L0.cell(tx + 1, Math.floor(+pp[1])) !== 0) continue;
  if (L0.los(spot.x, spot.y, tx + 0.5, +pp[1])) continue;   // stay invisible from the search area
  L0.tp(tx + 0.5, +pp[1]); movedP = true;
}
A('monster: player relocated for give-up phase', movedP, '');
let gaveUp = false;
for (let i = 0; i < 1500 && sawSearch && !gaveUp; i++){
  const mo = L0.stats().monster;
  if (mo.state === 'ROAM'){ gaveUp = true; break; }
  if (mo.state === 'CHASE' || L0.los(+L0.stats().pos[0], +L0.stats().pos[1], mo.x, mo.y)) L0.tpMon(spot.x, spot.y);
  stepFrames(1);                                            // preempt: monster never re-sees the player
}
A('monster: SEARCH -> ROAM after giving up', gaveUp, 'state=' + L0.stats().monster.state);

/* despawn: >40u away for >60s, then respawn. Hold the monster beyond 45u so
   its roaming can't reset despawnT (the game resets the timer inside 40u). */
let desp = false, resp = false, farSpot = null;
for (let t = 60; t < 100 && !farSpot; t++){
  const tx = Math.floor(+L0.stats().pos[0]) + t;
  if (L0.cell(tx, Math.floor(+L0.stats().pos[1])) === 0
      && !L0.los(+L0.stats().pos[0], +L0.stats().pos[1], tx + 0.5, +L0.stats().pos[1]))   // no LOS: monster must not stay CHASE (despawnT only ticks when lost)
    farSpot = { x: tx + 0.5, y: +L0.stats().pos[1] };
}
A('monster: far spot for despawn test', !!farSpot, '');
if (farSpot){
  L0.tpMon(farSpot.x, farSpot.y);
  for (let i = 0; i < 9600; i++){
    stepFrames(1);
    const mo = L0.stats().monster;
    if (mo === null){ desp = 'done'; }
    else {
      if (mo.dist < 45) L0.tpMon(farSpot.x, farSpot.y);
      if (desp === 'done'){ resp = true; break; }
    }
    /* respawn needs a no-LOS open cell 18-26u out; nudge the player if the
       geometry is pathological so the test measures respawn, not map luck */
    if (desp === 'done' && i > 1800 && i % 600 === 0) L0.tp(+L0.stats().pos[0] + 3, +L0.stats().pos[1]);
  }
}
A('monster: despawns >40u after 60s, then respawns', desp === 'done' && resp, 'despawned+respawned');

/* A* budget — capture NOW (before restarts zero the counters) */
const dbgChase = vm.runInContext('DBG', sandbox);
A('ai: A* node cap respected (chase run)', dbgChase.astarMaxNodes <= 256 && dbgChase.astarCalls > 0,
  `max=${dbgChase.astarMaxNodes} over ${dbgChase.astarCalls} calls, overflows=${dbgChase.astarOverflows}`);

/* catch -> game over -> restart */
L0.tpMon(+L0.stats().pos[0] + 0.2, +L0.stats().pos[1]);
stepFrames(2);
stepFrames(80);
A('monster: catch <0.6u -> YOU ARE LOST screen', L0.stats().mode === 'dead', 'mode=' + L0.stats().mode);
keydown('KeyR');                       // retry same seed
A('flow: R restarts same seed', L0.stats().mode === 'play' && L0.seed() === seedA, 'mode=' + L0.stats().mode);
L0.tpMon(+L0.stats().pos[0] + 0.2, +L0.stats().pos[1]);   // get caught again
stepFrames(82);
A('monster: second catch cycle works', L0.stats().mode === 'dead');
keydown('Enter');                      // new random seed
A('flow: ENTER starts new random seed', L0.stats().mode === 'play' && L0.seed() !== seedA, 'mode=' + L0.stats().mode);

/* quality tiers */
A('tiers: threshold map 1->2 at <28fps', L0.autoCheck(27.9) === 2);
A('tiers: threshold map 2->3 at <24fps', (L0.setTier(2), L0.autoCheck(23.9) === 3));
A('tiers: no drop at 50fps', L0.autoCheck(50) === -1);
L0.setTier(3);
stepFrames(10);
const R3 = vm.runInContext('R', sandbox);
let lit3 = 0; for (let i = 0; i < R3.W * R3.H; i++) if (R3.pix[i] !== 0xff000000) lit3++;
A('tiers: tier 3 renders (floor casting off, flat gradient)', R3.floorOn === false && lit3 > R3.W * R3.H * 0.2, `lit=${lit3}, floorOn=${R3.floorOn}`);
L0.setTier(1);

/* world integrity: 200 chunks straight +x (edge agreement + connectivity + no pockets) */
const v = L0.verify(200);
const kinds = {};
for (const f of v.failures){ const k = f.replace(/[\d/]+/g, '#'); kinds[k] = (kinds[k] || 0) + 1; }
A('world: 201-chunk strip — openings agree, all connected, no pockets', v.ok, `chunks=${v.chunks}, failures=${JSON.stringify(kinds)}`);

/* render perf (Node on this desktop; netbook has its own tier ladder).
   min-of-batches after warmup: immune to JIT/noise spikes */
const rperf = (() => { const rf = vm.runInContext('renderFrame', sandbox);
  for (let i = 0; i < 120; i++) rf();
  let best = 1e9;
  for (let b = 0; b < 3; b++){
    const t0 = Date.now(); for (let i = 0; i < 120; i++) rf();
    const ms = (Date.now() - t0) / 120; if (ms < best) best = ms;
  }
  return best; })();
A('perf: tier-1 render under budget on host', rperf < 16, rperf.toFixed(2) + ' ms/frame, min of 3x120');

/* 5-minute monster-free traversal: walk with steering wiggles, teleport ahead
   when stuck; chunk bound + prune logging; then verify the strip actually walked */
L0.M.active = false; L0.M.respawnT = 1e9; L0.M.neverSpawned = false;   // isolate world test
L0.setTier(3);                                    // world test, not a render test — tier 3 is 3x faster
let maxChunks = 0, steadyChunks = 0, logs = 0;
const origLog = sandbox.console.log;
sandbox.console.log = () => { logs++; };
const tWalk0 = Date.now();
for (let s = 0; s < 18000; s++){                     // 5 min at 60fps
  stepFrames(1);
  L0.press('KeyW', true);
  if (s % 120 === 60) L0.press('ArrowLeft', true);
  if (s % 120 === 75) L0.press('ArrowLeft', false);
  if (s % 120 === 90) L0.press('ArrowRight', true);
  if (s % 120 === 105) L0.press('ArrowRight', false);
  if (s % 600 === 599){                              // hop ahead along +x
    const p = L0.stats().pos, row = Math.floor(+p[1]);
    let cx = Math.floor(+p[0]) + 10;
    for (let t = 0; t < 40; t++, cx++){
      if (L0.cell(cx, row) === 0 && L0.cell(cx + 1, row) === 0){ L0.tp(cx + 0.5, +p[1]); break; }
    }
  }
  if (s % 120 === 0) vm.runInContext('pruneChunks()', sandbox);   // exercise prune like the 2s tick
  maxChunks = Math.max(maxChunks, L0.stats().chunks);
  steadyChunks = Math.max(steadyChunks, s % 120 === 0 ? L0.stats().chunks : 0);
}
sandbox.console.log = origLog;
L0.press('KeyW', false);
const walkMs = Date.now() - tWalk0;
const finalRow = Math.floor(+L0.stats().pos[1]);
const v2 = L0.verify(200, finalRow);
L0.setTier(1);                                    // back to tier 1 for perf measurement
A('world: 5-min traversal, bounded chunk set', steadyChunks <= 49, `steady<=${steadyChunks} (cap 49), transient max=${maxChunks}, walk sim ${walkMs}ms`);
A('world: strip at final row verified', v2.ok, `row=${finalRow} chunks=${v2.chunks} failures=${JSON.stringify(v2.failures.slice(0, 4))}`);
A('world: still no errors after traversal', L0.errors().length === 0, JSON.stringify(L0.errors().slice(0, 3)));

/* audio graph built and running (stubbed renderer) */
A('audio: context created on gesture, state running', vm.runInContext('AU.inited && AU.ac !== null', sandbox));

/* ---- cycle systems: critters, variants, exit descent, almond water, level tint ---- */
L0.start('cycle1');
L0.G.graceT = 999;
stepFrames(2);
/* critters: spawn two, one flees when close, both update; then despawn when far */
vm.runInContext(`(function(){
  CR.length = 0;
  CR.push({ x: P.x + 3, y: P.y, kind: 'shambler', a: Math.PI, turnT: 99, animT: 0.4, waitT: 0 });
  CR.push({ x: P.x + 2, y: P.y + 0.3, kind: 'rat', a: 0, turnT: 99, animT: 1, waitT: 0 });
  return 1;
})()`, sandbox);
const cr0 = vm.runInContext('CR.length', sandbox);
const shX0 = vm.runInContext('CR[0].x', sandbox);
stepFrames(30);                                        // 0.5s: shambler creeps, rat flees
const crMoved = vm.runInContext('Math.abs(CR[0].x - ' + shX0 + ') > 0.05', sandbox);
const ratFled = vm.runInContext('CR[1] ? (CR[1].x - P.x) > 2.5 : true', sandbox);
A('critters: staged critters update, wander and flee', cr0 === 2 && crMoved && ratFled,
  `n=${cr0} moved=${crMoved} fled=${ratFled}`);
vm.runInContext('CR[0] && (CR[0].x = P.x + 30)', sandbox);
stepFrames(120);                                       // 2s: >24u critter despawns
A('critters: despawn beyond 24u', vm.runInContext('CR.length <= 1', sandbox));
/* variants: every spawn carries a variant with valid multipliers */
const varOk = vm.runInContext(`(function(){
  M.active = false; M.respawnT = 0; G.graceT = 0;
  for (let k = 0; k < 6 && !M.active; k++) trySpawnMonster();
  const okV = M.active && M.var && [1, 1.32, 0.82, 1.12].indexOf(M.var.spd) >= 0 &&
              [1, 0.85, 1.22, 0.78].indexOf(M.var.sz) >= 0;
  return okV && (!M.var.deep || G.level >= 2);
})()`, sandbox);
A('monster: variant roll on spawn (speed/size/tint valid)', varOk);
/* deep gate: floor 1 never rolls the crawler */
const chair0 = vm.runInContext('PROPGEO.chair[0].c.slice()', sandbox);
const deepGate = vm.runInContext(`(function(){
  let seen = false;
  for (let k = 0; k < 40 && !seen; k++){
    M.active = false; M.respawnT = 0; G.graceT = 0;
    for (let k2 = 0; k2 < 6 && !M.active; k2++) trySpawnMonster();
    if (M.active && M.var.deep) seen = true;
  }
  return !seen;
})()`, sandbox);
A('crawler: deep variant never spawns on floor 1', deepGate);
/* exit stairwell: proximity -> descend (level++, reseed, toast) */
const seed0 = L0.seed();
vm.runInContext(`(function(){
  const cx2 = Math.floor(P.x), cy2 = Math.floor(P.y);
  chunks.get((P.x >> 4) + ',' + (P.y >> 4)).props.push({ x: P.x + 0.4, y: P.y, kind: 'exit', vOff: 0, tilt: 0, scl: 1, rot: 0 });
  return 1;
})()`, sandbox);
stepFrames(20);
const desc = vm.runInContext('G.level', sandbox) === 2 && L0.seed() !== seed0;
A('exit: proximity descends to floor 2 with a new seed', desc,
  `level=${vm.runInContext('G.level', sandbox)} seed=${L0.seed().toString(16)}`);
/* level tint: floor 2 walls differ from the pristine rip */
const tintOk = vm.runInContext(`(function(){
  for (let i = 0; i < TEX.wall.length; i += 97) if (TEX.wall[i] !== TEX.bwall[i]) return true;
  return false;
})()`, sandbox);
A('levels: floor-2 palette re-tints the ripped textures', tintOk);
/* almond water: pickup refills stamina and kicks the speed */
vm.runInContext(`(function(){
  chunks.get((P.x >> 4) + ',' + (P.y >> 4)).props.push({ x: P.x + 0.3, y: P.y, kind: 'water', vOff: 0, tilt: 0, scl: 1, rot: 0 });
  P.stamina = 0.15;
  return 1;
})()`, sandbox);
stepFrames(20);
A('almond water: pickup restores stamina + speed boost', vm.runInContext('P.stamina === 1 && P.boostT > 0', sandbox),
  `stam=${vm.runInContext('P.stamina', sandbox)} boost=${vm.runInContext('P.boostT.toFixed(1)', sandbox)}`);
/* prop tint: furniture followed the palette, landmarks did not */
A('levels: props re-tint per floor, exit/water exempt', vm.runInContext(`(function(){
  const b2 = PROPGEO.chair[0]._c;
  const moved = PROPGEO.chair[0].c.join() !== b2.join();
  const sameExit = PROPGEO.exit[1].c.join() === PROPGEO.exit[1]._c.join();
  return moved && sameExit;
})()`, sandbox), `chair ${chair0.join()} -> ${vm.runInContext('PROPGEO.chair[0].c.join()', sandbox)}`);
/* crawler: floor 2+ can roll the deep variant (120 spawns ~= 100%) */
const crawlerSeen = vm.runInContext(`(function(){
  let seen = false;
  for (let k = 0; k < 120 && !seen; k++){
    M.active = false; M.respawnT = 0; G.graceT = 0;
    for (let k2 = 0; k2 < 6 && !M.active; k2++) trySpawnMonster();
    if (M.active && M.var.deep) seen = true;
  }
  return seen;
})()`, sandbox);
A('crawler: deep variant spawns from floor 2 on', crawlerSeen);
/* exit beacon: staging a stairwell 2u away swells the beacon gain */
vm.runInContext(`(function(){
  chunks.get((P.x >> 4) + ',' + (P.y >> 4)).props.push({ x: P.x + 2, y: P.y, kind: 'exit', vOff: 0, tilt: 0, scl: 1, rot: 0 });
  AU.lastXG = 0;
  const origG = AU.exitG.gain.setTargetAtTime.bind(AU.exitG.gain);
  AU.exitG.gain.setTargetAtTime = function(v, tt, tc){ AU.lastXG = v; return origG(v, tt, tc); };
  return 1;
})()`, sandbox);
stepFrames(20);
A('audio: exit beacon swells near a stairwell (pitch per floor)',
  vm.runInContext('AU.lastXG > 0.02 && AU.xd < 36', sandbox),
  `gain=${vm.runInContext('AU.lastXG.toFixed(3)', sandbox)} xd2=${vm.runInContext('AU.xd', sandbox)}`);
/* rats: proximity tracked + squeak double-chirp fires */
vm.runInContext(`(function(){
  CR.push({ x: P.x + 3, y: P.y, kind: 'rat', a: 0, turnT: 99, animT: 1, waitT: 0 });
  AU.nBurst = 0; const ob = AU.burst;
  AU.burst = function(){ AU.nBurst++; return ob.apply(AU, arguments); };
  AU.squeak(3);
  return 1;
})()`, sandbox);
stepFrames(20);
A('audio: rat proximity tracked, squeak chirps fire',
  vm.runInContext('AU.rd < 64 && AU.nBurst === 2', sandbox),
  `rd2=${vm.runInContext('AU.rd', sandbox)} n=${vm.runInContext('AU.nBurst', sandbox)}`);
A('cycle: no errors after systems pass', L0.errors().length === 0, JSON.stringify(L0.errors().slice(0, 3)));

/* ---- §7d The Hound: second hostile (floors 2+), lunge-cycle chase ---- */
L0.start('cycle2');
L0.G.graceT = 999;
stepFrames(2);
vm.runInContext('G.level = 2; M.active = false; M.neverSpawned = false; M.respawnT = 0; G.graceT = 0;', sandbox);
let houndSpawned = false;
for (let k = 0; k < 300 && !houndSpawned; k++){
  vm.runInContext("M.active = false; M.kind = 'wanderer'; trySpawnMonster();", sandbox);
  houndSpawned = vm.runInContext("M.kind === 'hound' && M.active", sandbox);
}
A('hound: spawns on floor 2 (35% species roll)', houndSpawned);
A('hound: wide/low billboard + low drone pitch + distinct tint',
  houndSpawned && vm.runInContext("M.var.wd > 1 && M.var.pitch < 1 && M.var.kind === 'hound'", sandbox));
/* lunge cycle: LOS chase -> stalk, windup (snarl), committed dash */
const houndStaged = vm.runInContext(`(function(){
  for (var k = 0; k < 60; k++){
    var ang = Math.random() * 6.283, d2 = 3 + Math.random() * 3;
    var sx = P.x + Math.cos(ang) * d2, sy = P.y + Math.sin(ang) * d2;
    if (cellAt(Math.floor(sx), Math.floor(sy)) !== 0) continue;
    if (!los(P.x, P.y, sx, sy)) continue;
    L0.tpMon(sx, sy);
    M.kind = 'hound';
    M.var = { kind: 'hound', spd: 1.12, sz: 0.68, wd: 1.2, zoff: 0, tint: [0.9, 0.72, 1.1], pitch: 0.55, w: 1 };
    M.state = 'CHASE'; M.lp = 0; M.lpT = 0.15; M.lostT = 0; M.repathT = 0;
    M.lastKX = P.x; M.lastKY = P.y;
    return 1;
  }
  return 0;
})()`, sandbox);
let sawWindup = false, sawDash = false, dashDist = 0, lpx = null, lpy = null, houndOK = houndStaged === 1;
if (houndOK){
  for (let k = 0; k < 300; k++){
    stepFrames(1);
    const lp = vm.runInContext('M.lp', sandbox);
    const nx = vm.runInContext('M.x', sandbox), ny = vm.runInContext('M.y', sandbox);
    if (lp === 1) sawWindup = true;
    if (lp === 2){
      sawDash = true;
      if (lpx !== null) dashDist += Math.hypot(nx - lpx, ny - lpy);
    }
    lpx = nx; lpy = ny;
    if (vm.runInContext('G.mode', sandbox) !== 'play') break;   // caught: end of show
  }
}
A('hound: lunge cycle runs stalk -> windup -> dash', houndOK && sawWindup && sawDash,
  `staged=${houndStaged} windup=${sawWindup} dash=${sawDash}`);
A('hound: dash covers real ground while committed', dashDist > 0.4, `${dashDist.toFixed(2)}u total`);
/* hound catch shares the wanderer rules */
L0.start('cycle4');
L0.G.graceT = 999;
stepFrames(2);
vm.runInContext(`(function(){
  G.mode = 'play'; G.catchT = 0;
  L0.tpMon(P.x + 0.4, P.y);
  M.kind = 'hound';
  M.var = { kind: 'hound', spd: 1.12, sz: 0.68, wd: 1.2, zoff: 0, tint: [0.9, 0.72, 1.1], pitch: 0.55, w: 1 };
  return 1;
})()`, sandbox);
stepFrames(90);
A('hound: catch <0.6u with LOS -> YOU ARE LOST', vm.runInContext('G.mode', sandbox) === 'dead',
  `mode=${vm.runInContext('G.mode', sandbox)}`);
A('hound: no errors after hound passes', L0.errors().length === 0, JSON.stringify(L0.errors().slice(0, 3)));

console.log(out.join('\n'));
