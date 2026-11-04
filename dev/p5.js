
/* ==================================================== §8 audio (all synthesized) */
var G = { mode: 'title', tier: 0, time: 0, flicker: 1, graceT: TUNE.GRACE,
          catchT: 0, catchA0: 0, catchD: 0, mute: false, fpsShow: false,
          fpsEMA: 60, autoFrames: 0, autoT: 0, lastTierChange: -1e9,
          logT: 0, pruneT: 0, lastStam: -1,
          bb: { next: TUNE.BB_MIN, until: 0, active: false } };

var AU = {
  ac: null, master: null, humG: null, humBase: 0.03, monG: null, monOsc: null,
  noiseBuf: null, inited: false, nextKnock: 0, tacc: 0,
  init: function(){
    if (this.inited) return;
    this.inited = true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ac = this.ac = new AC();
    this.master = ac.createGain();
    this.master.gain.value = G.mute ? 0 : 1;
    this.master.connect(ac.destination);
    var nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    var d = nb.getChannelData(0), i;
    for (i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // fluorescent hum: two detuned oscillators + lowpassed noise, slow wobble
    var humG = this.humG = ac.createGain();
    humG.gain.value = this.humBase;
    humG.connect(this.master);
    var o1 = ac.createOscillator(); o1.type = 'sine'; o1.frequency.value = 100;
    var g1 = ac.createGain(); g1.gain.value = 0.5; o1.connect(g1); g1.connect(humG); o1.start();
    var o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = 120.7;
    var g2 = ac.createGain(); g2.gain.value = 0.4; o2.connect(g2); g2.connect(humG); o2.start();
    var ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    var g3 = ac.createGain(); g3.gain.value = 0.5;
    ns.connect(lp); lp.connect(g3); g3.connect(humG); ns.start();
    var lfo = ac.createOscillator(); lfo.frequency.value = 0.33;
    var lg = ac.createGain(); lg.gain.value = 0.008;
    lfo.connect(lg); lg.connect(humG.gain); lfo.start();
    // monster: low drone, gain mapped to proximity
    var monG = this.monG = ac.createGain(); monG.gain.value = 0; monG.connect(this.master);
    var mo = this.monOsc = ac.createOscillator(); mo.type = 'sawtooth'; mo.frequency.value = 52;
    var mlp = ac.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 300;
    mo.connect(mlp); mlp.connect(monG); mo.start();
  },
  ok: function(){ return this.ac && this.ac.state === 'running'; },
  burst: function(dur, filtType, freq, q, vol, rampTo){
    if (!this.ok()) return;
    var ac = this.ac, t = ac.currentTime;
    var src = ac.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    var f = ac.createBiquadFilter(); f.type = filtType;
    f.frequency.setValueAtTime(freq, t);
    if (rampTo) f.frequency.exponentialRampToValueAtTime(rampTo, t + dur);
    f.Q.value = q;
    var g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
    src.stop(t + dur + 0.05);
  },
  step: function(sprint){ this.burst(0.09, 'bandpass', 300 + Math.random() * 300, 1.2, sprint ? 0.16 : 0.08, 0); },
  knock: function(vol){ this.burst(0.16, 'lowpass', 260, 1, vol, 0); },
  whoosh: function(){ this.burst(1.2, 'lowpass', 3000, 0.8, 0.3, 80); },
  sting: function(){
    if (!this.ok()) return;
    var ac = this.ac, t = ac.currentTime;
    var o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(165, t + 0.5);
    var g = ac.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.75);
    this.burst(0.3, 'lowpass', 500, 1, 0.22, 0);
  },
  update: function(dt){
    if (!this.ok()) return;
    this.tacc -= dt;
    if (this.tacc > 0) return;
    this.tacc = 0.1;
    var t = this.ac.currentTime;
    // hum drops with flicker (§8 blackout)
    this.humG.gain.setTargetAtTime(this.humBase * (0.4 + 0.6 * G.flicker), t, 0.08);
    var g = 0;
    if (M.active){
      var d2 = (M.x - P.x) * (M.x - P.x) + (M.y - P.y) * (M.y - P.y);
      g = 0.5 / (1 + d2 * 0.09);                    // audible before you see it
      if (g > 0.32) g = 0.32;
      this.monG.gain.setTargetAtTime(g, t, 0.15);
      this.monOsc.frequency.setTargetAtTime(M.state === 'CHASE' ? 63 : 50, t, 0.3);
      if (t > this.nextKnock){
        this.nextKnock = t + 2 + Math.random() * 5;
        this.knock(Math.min(0.4, g * 2 + 0.03));
      }
    } else this.monG.gain.setTargetAtTime(0, t, 0.3);
  }
};

/* ------------------------------------------------------------- §10 game flow */
var $id = function(id){ return document.getElementById(id); };
var stamF = $id('stamF'), fpsOv = $id('fpsOv'), seedLbl = $id('seedLbl');
var titleOv = $id('titleOv'), pauseOv = $id('pauseOv'), deadOv = $id('deadOv'), fadeOv = $id('fadeOv');

function resetWorld(seedVal){
  worldSeed = seedVal >>> 0;
  chunks.clear();
  invalidateChunkCache();
  var c0 = chunkGet(0, 0);
  c0.cells[0] = 0; c0.cells[1] = 0; c0.cells[16] = 0; c0.cells[17] = 0;   // safe spawn 2x2
  P.x = 0.5; P.y = 0.5; P.a = 0; P.prevA = 0; P.bobPhase = 0; P.stamina = 1;
  P.odom = 0; P.sprinting = false; P.swayPx = 0; P.bobEye = 0; P.pitchPx = 0;
  M.active = false; M.neverSpawned = true; M.respawnT = 0; M.state = 'ROAM';
  M.pathLen = 0; M.animT = 0; M.despawnT = 0; M.arrived = false;
  G.time = 0; G.graceT = TUNE.GRACE; G.catchT = 0;
  G.bb.active = false;
  G.bb.next = TUNE.BB_MIN + Math.random() * TUNE.BB_VAR; G.bb.until = 0;
  G.autoFrames = 0; G.autoT = 0; G.lastTierChange = -1e9; G.logT = 0; G.pruneT = 0;
  DBG.gens = 0; DBG.astarCalls = 0; DBG.astarMaxNodes = 0; DBG.astarOverflows = 0;
  fadeOv.style.opacity = '0';
  seedLbl.textContent = 'seed ' + worldSeed.toString(16);
}
function startGame(seedStr){
  /* audio must never block the game: no-audio-device (VM/RDP) throws here */
  try {
    AU.init();
    if (AU.ac && AU.ac.state === 'suspended') AU.ac.resume();
  } catch (e) { AU.ac = null; AU.inited = true; __errs.push('error: audio init ' + e); }
  try {
    resetWorld(seedFromString(seedStr));
  } catch (e) {
    __errs.push('error: world init ' + e);
    $id('seedLbl').textContent = 'world error: ' + e;
    return;
  }
  G.mode = 'play';
  titleOv.classList.add('hidden');
  deadOv.classList.add('hidden');
  pauseOv.classList.add('hidden');
  requestLock();
}
function pauseGame(){
  if (G.mode !== 'play') return;
  G.mode = 'pause';
  pauseOv.classList.remove('hidden');
}
function resumeGame(){
  if (G.mode !== 'pause') return;
  pauseOv.classList.add('hidden');
  G.mode = 'play';
  requestLock();
}
function gameOver(){
  G.mode = 'dead';
  deadOv.classList.remove('hidden');
  if (document.exitPointerLock) document.exitPointerLock();
}
function restart(sameSeed){
  resetWorld(sameSeed ? worldSeed : (Math.random() * 0xffffffff) >>> 0);
  G.mode = 'play';
  deadOv.classList.add('hidden');
  pauseOv.classList.add('hidden');
  requestLock();
}
function toggleMute(){
  G.mute = !G.mute;
  if (AU.master) AU.master.gain.value = G.mute ? 0 : 1;
  $id('muteBtn').textContent = G.mute ? 'UNMUTE' : 'MUTE';
}
function requestLock(){
  try {
    var p = cv.requestPointerLock();
    if (p && p.catch) p.catch(function(){});
  } catch (e) { __errs.push('error: pointer lock ' + e); }
}

/* ------------------------------------------------- §4.4 flicker & blackouts */
function flickerUpdate(dt){
  G.time += dt;
  var bb = G.bb;
  if (!bb.active && G.time >= bb.next){
    bb.active = true;
    bb.until = G.time + TUNE.BB_DUR_MIN + Math.random() * TUNE.BB_DUR_VAR;
    AU.whoosh();
    if (M.active && M.state !== 'CHASE' && Math.random() < 0.6) blackoutTeleport();
  }
  if (bb.active && G.time >= bb.until){
    bb.active = false;
    bb.next = G.time + TUNE.BB_MIN + Math.random() * TUNE.BB_VAR;
  }
  var f = 1 + 0.08 * Math.sin(G.time * 1.7) * Math.sin(G.time * 2.9 + 1.7);
  if (bb.active) f *= TUNE.BB_LIGHT;
  G.flicker = f;
}
function blackoutTeleport(){
  for (var i = 0; i < 30; i++){
    var ang = Math.random() * Math.PI * 2;
    var d = 8 + Math.random() * 6;
    var sx = P.x + Math.cos(ang) * d, sy = P.y + Math.sin(ang) * d;
    if (cellAt(Math.floor(sx), Math.floor(sy)) !== 0) continue;
    if (los(P.x, P.y, sx, sy)) continue;
    M.x = sx; M.y = sy; M.pathLen = 0; M.stuckT = 0; M.lastX = sx; M.lastY = sy;
    return;
  }
}

/* ------------------------------------------------------- §9 quality auto-drop */
function tierAutoCheckAvg(avgFps){
  if (G.tier === 0 && avgFps < TUNE.TIER_FPS2) return 2;
  if (G.tier === 1 && avgFps < TUNE.TIER_FPS3) return 3;
  return -1;
}
function tierAutoCheck(dt){
  G.autoFrames++;
  G.autoT += dt;
  if (G.autoT < TUNE.TIER_WINDOW) return;
  var avg = G.autoFrames / G.autoT;
  G.autoFrames = 0; G.autoT = 0;
  var n = tierAutoCheckAvg(avg);
  if (n > 0 && G.time - G.lastTierChange >= TUNE.TIER_HYST){
    G.lastTierChange = G.time;
    setTier(n - 1);
  }
}

/* ------------------------------------------------------------------- HUD */
function hudUpdate(dt){
  hudUpdate.t -= dt;
  if (hudUpdate.t > 0) return;
  hudUpdate.t = 0.15;
  var w = (P.stamina * 100) | 0;
  if (w !== G.lastStam){
    G.lastStam = w;
    stamF.style.width = w + '%';
  }
  if (G.fpsShow){
    fpsOv.textContent = (G.fpsEMA | 0) + ' fps  tier ' + (G.tier + 1) +
      '  chunks ' + chunks.size + '  a* ' + DBG.astarMaxNodes +
      '\nmon ' + (M.active ? M.state : '-') + '  seed ' + worldSeed.toString(16);
  }
}

/* ------------------------------------------------------------- §7 catch seq */
function startCatch(){
  G.catchT = 0.0001;
  var d = Math.atan2(M.y - P.y, M.x - P.x) - P.a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  G.catchA0 = P.a; G.catchD = d;
}

/* -------------------------------------------------------------- input (§6) */
var NEED_PREVENT = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
                     Space: 1, KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1 };
document.addEventListener('keydown', function(e){
  if (e.target === $id('seedInp')) return;
  if (NEED_PREVENT[e.code]) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  try { AU.init(); if (AU.ac && AU.ac.state === 'suspended') AU.ac.resume(); } catch (e2) { AU.ac = null; AU.inited = true; }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyF'){ G.fpsShow = !G.fpsShow; fpsOv.style.display = G.fpsShow ? 'block' : 'none'; }
  if (e.code === 'Digit1') setTier(0);
  if (e.code === 'Digit2') setTier(1);
  if (e.code === 'Digit3') setTier(2);
  if (G.mode === 'dead'){
    if (e.code === 'KeyR') restart(true);
    if (e.code === 'Enter') restart(false);
  } else if (G.mode === 'title' && e.code === 'Enter'){ startGame($id('seedInp').value); }
});
document.addEventListener('keyup', function(e){ keys[e.code] = false; });
cv.addEventListener('mousemove', function(e){
  if (document.pointerLockElement === cv && G.mode === 'play' && G.catchT === 0){
    P.a += e.movementX * TUNE.MOUSE_SENS;
  }
});
cv.addEventListener('click', function(){
  if (G.mode === 'play' && document.pointerLockElement !== cv) requestLock();
});
document.addEventListener('pointerlockchange', function(){
  if (document.pointerLockElement !== cv && G.mode === 'play' && G.catchT === 0) pauseGame();
});
$id('startBtn').addEventListener('click', function(){ startGame($id('seedInp').value); });
$id('resumeBtn').addEventListener('click', resumeGame);
$id('restartBtn').addEventListener('click', function(){ restart(true); });
$id('muteBtn').addEventListener('click', toggleMute);

/* ------------------------------------------------- world integrity prober (audit) */
function collectOpenings(ch){
  var cx = ch.cx, cy = ch.cy, opens = [], pw, e;
  pw = openingsFor(true, cx, cy);     for (e = 0; e < pw.length; e++) opens.push(pw[e] << 4);
  pw = openingsFor(true, cx + 1, cy); for (e = 0; e < pw.length; e++) opens.push((pw[e] << 4) + 15);
  pw = openingsFor(false, cy, cx);    for (e = 0; e < pw.length; e++) opens.push(pw[e]);
  pw = openingsFor(false, cy + 1, cx);for (e = 0; e < pw.length; e++) opens.push((15 << 4) + pw[e]);
  return opens;
}
function floodFrom(ch, seed){
  var cells = ch.cells, reached = new Uint8Array(256), stack = [seed];
  reached[seed] = 1;
  while (stack.length){
    var n = stack.pop(), nx = n & 15, ny = n >> 4, d;
    for (d = 0; d < 4; d++){
      var ox = nx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      var oy = ny + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (ox < 0 || ox > 15 || oy < 0 || oy > 15) continue;
      var q = (oy << 4) + ox;
      if (!reached[q] && cells[q] === 0){ reached[q] = 1; stack.push(q); }
    }
  }
  return reached;
}
/* Generate n+1 chunks straight along row cy and prove: every border opening
   is carved on BOTH sides (pure edge fn agreement) and every chunk's openings
   are mutually connected with no unreachable floor pockets. */
function verifyStrip(n, cy){
  if (cy === undefined) cy = 0;
  cy |= 0;
  var failures = [], i, k;
  for (i = 0; i <= n; i++) chunkGet(i, cy);
  for (i = 0; i <= n; i++){
    var ch = chunkGet(i, cy);
    var opens = collectOpenings(ch);
    var reached = floodFrom(ch, opens[0]);
    for (k = 0; k < opens.length; k++)
      if (!reached[opens[k]]) failures.push('chunk ' + i + ': opening ' + k + ' disconnected');
    for (k = 0; k < 256; k++)
      if (ch.cells[k] === 0 && !reached[k]){ failures.push('chunk ' + i + ': unreachable floor pocket'); break; }
    if (i < n){
      var nxt = chunkGet(i + 1, cy);
      var pw = openingsFor(true, i + 1, cy), e;
      for (e = 0; e < pw.length; e++){
        if (ch.cells[(pw[e] << 4) + 15] !== 0 || nxt.cells[pw[e] << 4] !== 0)
          failures.push('edge opening not carved both sides: chunks ' + i + '/' + (i + 1) + ' row ' + pw[e]);
      }
    }
  }
  return { chunks: n + 1, failures: failures, ok: failures.length === 0 };
}

/* ------------------------------------------------------------- main loop (§3.1) */
var lastTs = 0;
function loop(ts){
  requestAnimationFrame(loop);
  var dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt <= 0) return;
  if (dt > 0.1) dt = 0.1;                                  // §6 dt clamp
  G.fpsEMA = G.fpsEMA * 0.9 + (1 / dt) * 0.1;
  if (G.mode === 'play'){
    flickerUpdate(dt);
    if (G.catchT > 0){
      G.catchT += dt;
      var k = G.catchT;
      if (k > 1) k = 1;
      P.a = G.catchA0 + G.catchD * k * k;                  // 1 s camera snap
      fadeOv.style.opacity = (k * k * 0.92).toFixed(2);
      if (G.catchT >= 1) gameOver();
    } else {
      playerUpdate(dt);
      monsterUpdate(dt);
    }
    tierAutoCheck(dt);
    hudUpdate(dt);
    G.logT += dt;
    if (G.logT > 5){ G.logT = 0; logWorld(); }
    G.pruneT += dt;
    if (G.pruneT > 2){ G.pruneT = 0; pruneChunks(); }
    AU.update(dt);
  }
  if (G.mode === 'play' || G.mode === 'pause' || G.mode === 'dead') renderFrame();
}

/* -------------------------------------------------------- L0 instrumentation */
window.L0 = {
  stats: function(){
    var md = Math.sqrt((M.x - P.x) * (M.x - P.x) + (M.y - P.y) * (M.y - P.y));
    return { fps: G.fpsEMA | 0, tier: G.tier + 1, chunks: chunks.size,
             chunkGens: DBG.gens, astarMax: DBG.astarMaxNodes,
             astarOverflows: DBG.astarOverflows, astarCalls: DBG.astarCalls,
             mode: G.mode, pos: [P.x.toFixed(2), P.y.toFixed(2)],
             monster: M.active ? { state: M.state, dist: +md.toFixed(2), x: M.x, y: M.y } : null,
             errorCount: __errs.length, seed: worldSeed >>> 0, time: G.time };
  },
  cell: function(x, y){ return cellAt(Math.floor(+x), Math.floor(+y)); },
  los: function(ax, ay, bx, by){ return los(+ax, +ay, +bx, +by); },
  tp: function(x, y, a){ P.x = +x; P.y = +y; if (a !== undefined) P.a = +a; },
  tpMon: function(x, y){ M.x = +x; M.y = +y; M.active = true; M.neverSpawned = false; },
  press: function(code, down){ keys[code] = down !== false; },   // test input hook
  setTier: function(n){ setTier(n - 1); },
  autoCheck: tierAutoCheckAvg,
  seed: function(){ return worldSeed >>> 0; },
  start: function(s){ startGame(s === undefined ? '' : s); },
  verify: verifyStrip,
  errors: function(){ return __errs.slice(); },
  G: G, M: M, P: P, TEX: TEX, TUNE: TUNE, DBG: DBG
};

/* ------------------------------------------------------------------- boot */
genTextures();
genSprites();
setTier(0);
resetWorld((Math.random() * 0xffffffff) >>> 0);
G.mode = 'title';
requestAnimationFrame(loop);
</script>
</body>
</html>
