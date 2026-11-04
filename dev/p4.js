
/* ===================================================== §6 player & collision */
var P = { x: 0.5, y: 0.5, a: 0, prevA: 0, bobPhase: 0, bobEye: 0, pitchPx: 0,
          bobArm: 0, swayPx: 0, stamina: 1, sprinting: false, odom: 0 };
var keys = {};

/* circle-vs-grid, axis-separated -> smooth wall sliding (§6) */
function resolveCells(o, r, moved, axisX){
  var x0 = Math.floor(o.x - r), x1 = Math.floor(o.x + r);
  var y0 = Math.floor(o.y - r), y1 = Math.floor(o.y + r);
  var cx, cy;
  for (cy = y0; cy <= y1; cy++){
    for (cx = x0; cx <= x1; cx++){
      if (!isSolid(cx, cy)) continue;
      var nx = Math.max(cx, Math.min(o.x, cx + 1));
      var ny = Math.max(cy, Math.min(o.y, cy + 1));
      var ddx = o.x - nx, ddy = o.y - ny;
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 < r * r){
        if (d2 > 1e-9){
          var d = Math.sqrt(d2);
          o.x += ddx / d * (r - d);
          o.y += ddy / d * (r - d);
        } else if (axisX){                    // center inside a wall: eject on moved axis
          o.x = moved > 0 ? cx - r : cx + 1 + r;
        } else {
          o.y = moved > 0 ? cy - r : cy + 1 + r;
        }
      }
    }
  }
}
function moveCollide(o, dx, dy, r){
  o.x += dx; resolveCells(o, r, dx, true);
  o.y += dy; resolveCells(o, r, dy, false);
}

function playerUpdate(dt){
  if (G.catchT > 0) return;
  var fwd = 0, str = 0, rot = 0;
  if (keys.KeyW || keys.ArrowUp) fwd += 1;
  if (keys.KeyS || keys.ArrowDown) fwd -= 1;
  if (keys.KeyA) str -= 1;
  if (keys.KeyD) str += 1;
  if (keys.ArrowLeft) rot -= 1;
  if (keys.ArrowRight) rot += 1;
  P.a += rot * TUNE.ROT_SPEED * dt;
  var dirX = Math.cos(P.a), dirY = Math.sin(P.a);
  var mvx = dirX * fwd - dirY * str;
  var mvy = dirY * fwd + dirX * str;
  var len = Math.sqrt(mvx * mvx + mvy * mvy);
  var ox = P.x, oy = P.y;
  if (len > 0.001){
    mvx /= len; mvy /= len;
    var wantSprint = (keys.ShiftLeft || keys.ShiftRight) && fwd > 0;
    var canSprint = P.sprinting ? P.stamina > 0 : P.stamina > TUNE.STAM_MIN;
    P.sprinting = wantSprint && canSprint;
    if (P.sprinting) P.stamina -= dt / TUNE.STAM_DRAIN;
    else P.stamina += dt / TUNE.STAM_REGEN;
    if (P.stamina > 1) P.stamina = 1;
    if (P.stamina < 0) P.stamina = 0;
    var spd = P.sprinting ? TUNE.SPRINT : TUNE.WALK;
    moveCollide(P, mvx * spd * dt, mvy * spd * dt, TUNE.P_RAD);
  } else {
    P.sprinting = false;
    P.stamina += dt / TUNE.STAM_REGEN;
    if (P.stamina > 1) P.stamina = 1;
  }
  var moved = Math.sqrt((P.x - ox) * (P.x - ox) + (P.y - oy) * (P.y - oy));
  P.odom += moved;
  // head bob drives footsteps (§6)
  if (moved > 0.0005){
    var oldPh = P.bobPhase;
    P.bobPhase += moved * 2.4;
    P.bobEye = Math.sin(P.bobPhase) * TUNE.BOB_AMP;
    P.pitchPx = (Math.sin(P.bobPhase * 2) * TUNE.BOB_PITCH) | 0;
    P.bobArm = (Math.abs(Math.sin(P.bobPhase)) * 5) | 0;
    if (((oldPh / Math.PI) | 0) !== ((P.bobPhase / Math.PI) | 0)) AU.step(P.sprinting);
  } else {
    P.bobEye *= 0.8; P.pitchPx = P.pitchPx * 0.8 | 0; P.bobArm *= 0.8;
  }
  // view sway on turn (§6)
  var tr = dt > 0 ? (P.a - P.prevA) / dt : 0;
  P.prevA = P.a;
  var target = tr * -6;
  if (target > 14) target = 14; else if (target < -14) target = -14;
  P.swayPx += (target - P.swayPx) * Math.min(1, dt * 10);
}

/* ------------------------------------------------- §7 LOS: DDA ray on the grid */
function los(ax, ay, bx, by){
  var dx = bx - ax, dy = by - ay;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return true;
  var rdx = dx / dist, rdy = dy / dist;
  var mapX = Math.floor(ax), mapY = Math.floor(ay);
  var tX = Math.floor(bx), tY = Math.floor(by);
  var deltaX = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
  var deltaY = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
  var stepX, stepY, sdX, sdY, guard = 0;
  if (rdx < 0){ stepX = -1; sdX = (ax - mapX) * deltaX; }
  else        { stepX = 1;  sdX = (mapX + 1 - ax) * deltaX; }
  if (rdy < 0){ stepY = -1; sdY = (ay - mapY) * deltaY; }
  else        { stepY = 1;  sdY = (mapY + 1 - ay) * deltaY; }
  while (guard++ < 160){
    if (mapX === tX && mapY === tY) return true;
    if (sdX < sdY){ sdX += deltaX; mapX += stepX; }
    else          { sdY += deltaY; mapY += stepY; }
    if (cellAt(mapX, mapY) !== 0) return false;
  }
  return true;
}

/* ------- §7 A*: 21x21 window, <=256 expansions, preallocated + Int32 heap */
var AW = TUNE.ASTAR_WIN, AW2 = AW * AW;
var asG = new Int32Array(AW2), asF = new Int32Array(AW2), asFrom = new Int32Array(AW2);
var asOpen = new Int32Array(AW2), asClosed = new Int32Array(AW2);
var heap = new Int32Array(AW2 + 2), heapN = 0, asGen = 0;
var asPX = new Int32Array(AW2), asPY = new Int32Array(AW2), asPathLen = 0;
var asBestI = 0, asBestH = 0;

function heapPush(n){
  var i = ++heapN, v;
  heap[i] = n;
  while (i > 1){
    var p = i >> 1;
    if (asF[heap[p]] <= asF[heap[i]]) break;
    v = heap[p]; heap[p] = heap[i]; heap[i] = v;
    i = p;
  }
}
function heapPop(){
  var top = heap[1], v;
  heap[1] = heap[heapN]; heapN--;
  var i = 1;
  while (true){
    var l = i << 1, r = l + 1, m = i;
    if (l <= heapN && asF[heap[l]] < asF[heap[m]]) m = l;
    if (r <= heapN && asF[heap[r]] < asF[heap[m]]) m = r;
    if (m === i) break;
    v = heap[m]; heap[m] = heap[i]; heap[i] = v;
    i = m;
  }
  return top;
}
/* A* from monster cell to (tgx,tgy); target must lie inside the window.
   Returns path length; fills asPX/asPY with global cell coords. */
function astar(sgx, sgy, tgx, tgy){
  DBG.astarCalls++;
  var wx = sgx - (AW >> 1), wy = sgy - (AW >> 1);
  var si = (sgy - wy) * AW + (sgx - wx);
  var ti = (tgy - wy) * AW + (tgx - wx);
  asGen++;
  heapN = 0;
  var nodes = 0, found = false;
  asG[si] = 0; asFrom[si] = -1; asOpen[si] = asGen; asClosed[si] = 0;
  asF[si] = Math.abs(tgx - sgx) + Math.abs(tgy - sgy);
  asBestI = si; asBestH = asF[si];
  heapPush(si);
  while (heapN > 0){
    if (nodes >= TUNE.ASTAR_CAP){ DBG.astarOverflows++; break; }   // budget: best-so-far
    var n = heapPop();
    if (asClosed[n] === asGen) continue;
    asClosed[n] = asGen;
    nodes++;
    var nx = n % AW, ny = (n - nx) / AW;
    var gx = wx + nx, gy = wy + ny;
    var h = Math.abs(tgx - gx) + Math.abs(tgy - gy);
    if (h < asBestH){ asBestH = h; asBestI = n; }
    if (n === ti){ found = true; break; }
    var d, nb, ox, oy;
    for (d = 0; d < 4; d++){
      ox = nx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      oy = ny + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (ox < 0 || ox >= AW || oy < 0 || oy >= AW) continue;
      nb = oy * AW + ox;
      if (asClosed[nb] === asGen) continue;
      if (cellAt(wx + ox, wy + oy) !== 0) continue;
      var ng = asG[n] + 1;
      if (asOpen[nb] !== asGen || ng < asG[nb]){
        asG[nb] = ng;
        asF[nb] = ng + Math.abs(tgx - (wx + ox)) + Math.abs(tgy - (wy + oy));
        asFrom[nb] = n;
        asOpen[nb] = asGen;
        heapPush(nb);
      }
    }
  }
  DBG.astarMaxNodes = nodes > DBG.astarMaxNodes ? nodes : DBG.astarMaxNodes;
  var end = found ? ti : asBestI;
  var len = 0, cur = end;
  while (cur >= 0 && len < AW2){
    var lx = cur % AW, ly = (cur - lx) / AW;
    asPX[len] = wx + lx; asPY[len] = wy + ly;
    len++;
    if (cur === si) break;
    cur = asFrom[cur];
  }
  var a3 = 0, b3 = len - 1, tmp;
  while (a3 < b3){ tmp = asPX[a3]; asPX[a3] = asPX[b3]; asPX[b3] = tmp;
                   tmp = asPY[a3]; asPY[a3] = asPY[b3]; asPY[b3] = tmp; a3++; b3--; }
  asPathLen = len;
  return len;
}

/* ------------------------------------------------------------ §7 The Wanderer */
var M = { active: false, neverSpawned: true, respawnT: 0, state: 'ROAM',
          x: 0, y: 0, frame: 0, animT: 0, pathPos: 0, pathLen: 0, useGreedy: false,
          repathT: 0, lostT: 0, searchT: 0, searchPhase: 0, sweeps: 0, waitT: 0,
          stuckT: 0, lastX: 0, lastY: 0, detourT: 0, detourSign: 1,
          lastKX: 0, lastKY: 0, targetCX: 0, targetCY: 0, despawnT: 0 };

function pathTo(tgx, tgy){
  M.useGreedy = false;
  M.arrived = false;
  var mgx = Math.floor(M.x), mgy = Math.floor(M.y);
  var wx = mgx - (AW >> 1), wy = mgy - (AW >> 1);
  if (tgx < wx || tgx >= wx + AW || tgy < wy || tgy >= wy + AW){
    M.useGreedy = true;                                // §7: greedy beyond window
    M.pathLen = 0;
    return 0;
  }
  if (cellAt(tgx, tgy) !== 0){ M.pathLen = 0; return 0; }  // wall target: no path
  var len = astar(mgx, mgy, tgx, tgy);
  M.pathLen = len;
  M.pathPos = len > 1 ? 1 : 0;
  return len;
}
function followPath(speed, dt){
  if (M.pathLen === 0 || M.pathPos >= M.pathLen){ M.arrived = true; return; }
  M.arrived = false;
  var tx = asPX[M.pathPos] + 0.5, ty = asPY[M.pathPos] + 0.5;
  var dx = tx - M.x, dy = ty - M.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  var step = speed * dt;
  if (d <= step + 0.08){ M.pathPos++; }
  else moveCollide(M, dx / d * step, dy / d * step, TUNE.M_RAD);
}
function greedyMove(tx, ty, speed, dt){
  var dx = tx - M.x, dy = ty - M.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.05) return;
  if (M.detourT > 0){                                  // stuck sidestep
    M.detourT -= dt;
    moveCollide(M, -dy / d * M.detourSign * speed * dt, dx / d * M.detourSign * speed * dt, TUNE.M_RAD);
    return;
  }
  moveCollide(M, dx / d * speed * dt, dy / d * speed * dt, TUNE.M_RAD);
}
/* stuck detection: no progress while trying to move */
function monsterStuckCheck(speed, dt){
  var mdx = M.x - M.lastX, mdy = M.y - M.lastY;
  M.lastX = M.x; M.lastY = M.y;
  if (mdx * mdx + mdy * mdy < speed * dt * speed * dt * 0.25){
    M.stuckT += dt;
  } else M.stuckT = 0;
  if (M.stuckT > 1.2){
    M.stuckT = 0;
    if (M.useGreedy){ M.detourT = 0.7; M.detourSign = -M.detourSign; }
    else M.pathLen = 0;                                // force repath
  }
}
function monsterAnim(speed, dt){
  M.animT += dt * speed * 0.5;
  M.frame = (M.animT | 0) % 3;
}
function enterChase(){
  if (M.state !== 'CHASE') AU.sting();
  M.state = 'CHASE';
  M.repathT = 0; M.lostT = 0;
  M.lastKX = P.x; M.lastKY = P.y;
}
function enterSearch(){
  M.state = 'SEARCH';
  M.searchT = 0; M.searchPhase = 0; M.sweeps = 2;
  pathTo(Math.floor(M.lastKX), Math.floor(M.lastKY));
}
function trySpawnMonster(){
  var best = null, bestScore = -1, i;
  for (i = 0; i < 40; i++){
    var ang = Math.random() * Math.PI * 2;
    var d = TUNE.SPAWN_MIN + Math.random() * (TUNE.SPAWN_MAX - TUNE.SPAWN_MIN);
    var sx = P.x + Math.cos(ang) * d, sy = P.y + Math.sin(ang) * d;
    if (cellAt(Math.floor(sx), Math.floor(sy)) !== 0) continue;
    if (los(P.x, P.y, sx, sy)) continue;               // §7: no LOS at spawn
    var score = (2 - lightRaw(Math.floor(sx), Math.floor(sy))) * 10 + Math.random();
    if (score > bestScore){ bestScore = score; best = { x: sx, y: sy }; }
  }
  if (best){
    M.active = true; M.neverSpawned = false;
    M.x = best.x; M.y = best.y;
    M.state = 'ROAM'; M.pathLen = 0; M.despawnT = 0; M.lostT = 0; M.stuckT = 0;
    M.lastX = M.x; M.lastY = M.y;
  }
}
function monsterUpdate(dt){
  if (!M.active){
    if (M.respawnT > 0){
      M.respawnT -= dt;
      if (M.respawnT <= 0) trySpawnMonster();
      return;
    }
    if (M.neverSpawned && G.graceT > 0 && P.odom < TUNE.ODO_SPAWN){
      G.graceT -= dt;
      return;
    }
    trySpawnMonster();
    return;
  }
  var dx = P.x - M.x, dy = P.y - M.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > TUNE.DESPAWN_D){
    M.despawnT += dt;
    if (M.despawnT > TUNE.DESPAWN_T){ M.active = false; M.respawnT = 3; M.pathLen = 0; return; }
  } else M.despawnT = 0;

  var seeP = los(M.x, M.y, P.x, P.y);
  if (seeP){ M.lastKX = P.x; M.lastKY = P.y; }
  var hears = P.sprinting && dist < TUNE.HEAR_D;        // through walls (§7)

  if (M.state === 'ROAM'){
    if (M.pathLen === 0 || M.arrived){
      // pick a random reachable cell nearby
      var tries = 0, tgy2, tgx2;
      while (tries++ < 8){
        tgx2 = Math.floor(M.x) + (Math.random() * 16 - 8) | 0;
        tgy2 = Math.floor(M.y) + (Math.random() * 16 - 8) | 0;
        if (cellAt(tgx2, tgy2) !== 0) continue;
        if (pathTo(tgx2, tgy2) > 1) break;
        M.pathLen = 0;
      }
      if (M.pathLen === 0) M.waitT = 0.5 + Math.random() * 1.5;
    }
    if (M.waitT > 0){ M.waitT -= dt; }
    else followPath(TUNE.M_ROAM, dt);
    monsterStuckCheck(TUNE.M_ROAM, dt);
    monsterAnim(TUNE.M_ROAM, dt);
    if (seeP || dist < 3 || hears) enterChase();
  }
  else if (M.state === 'CHASE'){
    M.repathT -= dt;
    var pcx = Math.floor(P.x), pcy = Math.floor(P.y);
    if (M.repathT <= 0 || (seeP && (pcx !== M.targetCX || pcy !== M.targetCY))){
      M.repathT = TUNE.REPATH;
      M.targetCX = pcx; M.targetCY = pcy;
      pathTo(seeP ? pcx : Math.floor(M.lastKX), seeP ? pcy : Math.floor(M.lastKY));
    }
    if (M.useGreedy) greedyMove(M.lastKX, M.lastKY, TUNE.M_CHASE, dt);
    else followPath(TUNE.M_CHASE, dt);
    monsterStuckCheck(TUNE.M_CHASE, dt);
    monsterAnim(TUNE.M_CHASE, dt);
    if (!seeP){
      M.lostT += dt;
      if (M.lostT > TUNE.LOSE_T) enterSearch();
    } else M.lostT = 0;
  }
  else { // SEARCH
    M.searchT += dt;
    if (M.searchPhase === 0){
      if (M.useGreedy){                    // last-known outside A* window
        greedyMove(M.lastKX, M.lastKY, TUNE.M_ROAM, dt);
        var gdx = M.lastKX - M.x, gdy = M.lastKY - M.y;
        if (gdx * gdx + gdy * gdy < 0.25){ M.searchPhase = 1; M.waitT = TUNE.SEARCH_WAIT; }
      } else {
        followPath(TUNE.M_ROAM, dt);
        if (M.arrived || M.pathLen === 0){ M.searchPhase = 1; M.waitT = TUNE.SEARCH_WAIT; }
      }
    } else if (M.searchPhase === 1){
      M.waitT -= dt;
      if (M.waitT <= 0){
        M.searchPhase = 2;
        var tgx3 = Math.floor(M.lastKX) + (Math.random() * 10 - 5) | 0;
        var tgy3 = Math.floor(M.lastKY) + (Math.random() * 10 - 5) | 0;
        if (cellAt(tgx3, tgy3) !== 0 || pathTo(tgx3, tgy3) <= 1) M.sweeps--;
      }
    } else {
      followPath(TUNE.M_ROAM, dt);
      if (M.arrived || M.pathLen === 0){
        M.sweeps--;
        if (M.sweeps > 0){
          var tgx4 = Math.floor(M.lastKX) + (Math.random() * 10 - 5) | 0;
          var tgy4 = Math.floor(M.lastKY) + (Math.random() * 10 - 5) | 0;
          if (cellAt(tgx4, tgy4) !== 0 || pathTo(tgx4, tgy4) <= 1) M.sweeps--;
        }
      }
    }
    monsterAnim(TUNE.M_ROAM, dt);
    if (M.searchT > TUNE.SEARCH_T || M.sweeps <= 0){ M.state = 'ROAM'; M.pathLen = 0; M.waitT = 0.5; }
    if (seeP || dist < 3 || hears) enterChase();
  }
  if (dist < TUNE.CATCH_D && G.catchT === 0) startCatch();
}
