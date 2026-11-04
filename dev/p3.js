
/* ======================================================== §3 software renderer
   R: reusable ImageData + Uint32Array pixel buffer, z-buffer, per-tier state */
var cv = document.getElementById('cv');
var ctx = cv.getContext('2d');
var R = { W: 320, H: 180, drawDist: 24, floorOn: true, tier: 0,
          buf: null, pix: null, zbuf: null, vig: null, boost: null,
          armsW: 150, armsH: 92, flatFloor: null, flatCeil: null };

function setTier(n){
  G.tier = n;
  var t = TIERS[n];
  R.W = t[0]; R.H = t[1]; R.drawDist = t[2]; R.floorOn = t[3];
  cv.width = R.W; cv.height = R.H;
  R.buf = ctx.createImageData(R.W, R.H);
  R.pix = new Uint32Array(R.buf.data.buffer);
  R.zbuf = new Float32Array(R.W);
  genVignette();
  genBoost();
  R.armsW = (R.W * 0.47) | 0;
  R.armsH = (R.armsW * 92 / 150) | 0;
  if (!R.floorOn) buildFlatLUTs();
  fitCanvas();
}
function fitCanvas(){
  var s = Math.min(window.innerWidth / R.W, window.innerHeight / R.H);
  cv.style.width = (R.W * s) + 'px';
  cv.style.height = (R.H * s) + 'px';
}
window.addEventListener('resize', fitCanvas);

/* §3.2 fog: linear fade to black, fully dark at draw-distance edge.
   Returns fixed-point 0..256. */
function fogFixed(d){
  var f = 1 - d / R.drawDist;
  if (f <= 0) return 0;
  if (f > 1) f = 1;
  return (f * 256) | 0;
}

/* §9 tier 3: flat fog gradient rows instead of floor casting */
function buildFlatLUTs(){
  R.flatFloor = new Int32Array(R.H + 16);
  R.flatCeil = new Int32Array(R.H + 16);
  var i, d, f, c, r, g, b;
  var fr = 0, fg = 0, fb = 0, n = 4096;              // average carpet texel
  for (i = 0; i < n; i++){ fr += TEX.carpet[i] & 255; fg += (TEX.carpet[i] >> 8) & 255; fb += (TEX.carpet[i] >> 16) & 255; }
  var cr = fr / n | 0, cg = fg / n | 0, cb = fb / n | 0;
  fr = 0; fg = 0; fb = 0;                            // average ceiling texel
  for (i = 0; i < n; i++){ fr += TEX.ceil[i] & 255; fg += (TEX.ceil[i] >> 8) & 255; fb += (TEX.ceil[i] >> 16) & 255; }
  var er = fr / n | 0, eg = fg / n | 0, eb = fb / n | 0;
  for (d = 1; d < R.H + 16; d++){
    f = fogFixed((0.5 * R.H) / d) * 200 >> 8;        // 200/256 avg block light
    R.flatFloor[d] = pxPix(clamp255(cr * f >> 8), clamp255(cg * f >> 8), clamp255(cb * f >> 8));
    f = fogFixed((0.5 * R.H) / d) * 200 >> 8;
    R.flatCeil[d] = pxPix(clamp255(er * f >> 8), clamp255(eg * f >> 8), clamp255(eb * f >> 8));
  }
}

/* -------------------------------------------------- §3.2 walls: DDA per column */
function renderWalls(posX, posY, dirX, dirY, planeX, planeY, eyeH, horizon, flickI){
  var W = R.W, H = R.H, pix = R.pix, zbuf = R.zbuf, boost = R.boost;
  var tex = TEX.wall, wallTex = tex;
  for (var x = 0; x < W; x++){
    var cameraX = 2 * x / W - 1;
    var rdx = dirX + planeX * cameraX, rdy = dirY + planeY * cameraX;
    var mapX = Math.floor(posX), mapY = Math.floor(posY);
    var deltaDistX = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
    var deltaDistY = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    var stepX, stepY, sideDistX, sideDistY, side;
    if (rdx < 0){ stepX = -1; sideDistX = (posX - mapX) * deltaDistX; }
    else       { stepX = 1;  sideDistX = (mapX + 1 - posX) * deltaDistX; }
    if (rdy < 0){ stepY = -1; sideDistY = (posY - mapY) * deltaDistY; }
    else       { stepY = 1;  sideDistY = (mapY + 1 - posY) * deltaDistY; }
    var hit = 0, cell = 0, iter = 0, cap = R.drawDist * 2 + 8, perp = R.drawDist;
    while (!hit){
      if (sideDistX < sideDistY){ sideDistX += deltaDistX; mapX += stepX; side = 0; }
      else                      { sideDistY += deltaDistY; mapY += stepY; side = 1; }
      cell = cellAt(mapX, mapY);
      perp = side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY;
      if (cell) hit = 1;
      else if (++iter > cap || perp > R.drawDist){ hit = 2; }
    }
    zbuf[x] = perp < R.drawDist ? perp : R.drawDist;
    if (hit !== 1 || perp >= R.drawDist) continue;              // fogged to black
    var lineH = H / perp;
    var drawS = horizon - (1 - eyeH) * lineH;
    var drawE = horizon + eyeH * lineH;
    var wallX = side === 0 ? posY + perp * rdy : posX + perp * rdx;
    wallX -= Math.floor(wallX);
    var texX = (wallX * 64) | 0;
    if (side === 0 && rdx > 0) texX = 63 - texX;
    if (side === 1 && rdy < 0) texX = 63 - texX;
    // shade = side * fog * block light * flicker * flashlight (§3.2/§6)
    var s = (fogFixed(perp) * flickI) >> 8;
    s = (s * lightMul(mapX, mapY)) >> 8;
    s = (s * (side === 0 ? 205 : 256)) >> 8;
    s = (s * boost[x]) >> 8;
    if (cell === 2) s = (s * 215) >> 8;                          // pillars slightly colder
    var yA = drawS < 0 ? 0 : drawS | 0;
    var yB = drawE > H ? H : drawE | 0;
    var tstep = 64 / lineH;
    var tpos = (yA - drawS) * tstep;
    var o = yA * W + x;
    for (var y = yA; y < yB; y++){
      var ty = tpos | 0;
      if (ty < 0) ty = 0; else if (ty > 63) ty = 63;
      var c = wallTex[(ty << 6) + texX];
      var rw = ((c & 255) * s) >> 8; if (rw > 255) rw = 255;
      var gw = (((c >>> 8) & 255) * s) >> 8; if (gw > 255) gw = 255;
      var bw = (((c >>> 16) & 255) * s) >> 8; if (bw > 255) bw = 255;
      pix[o] = (0xff000000 | (bw << 16) | (gw << 8) | rw);
      tpos += tstep; o += W;
    }
  }
}

/* ----------------------------- §3.3 floor & ceiling casting (per screen row)
   Fixed-point accumulation: world pos kept in 1/64-texel units as a double,
   biased into int32 range once per pixel — no Math.floor in the inner loop. */
var F64OFF = 1 << 20;                                    /* multiple of 64, exact in doubles */
function renderFloorCeil(posX, posY, dirX, dirY, planeX, planeY, eyeH, horizon, flickI){
  var W = R.W, H = R.H, pix = R.pix, boost = R.boost;
  var rlx = dirX - planeX, rly = dirY - planeY;
  var rrx = dirX + planeX, rry = dirY + planeY;
  var carpet = TEX.carpet, ceil = TEX.ceil, panel = TEX.panel;
  var foff = F64OFF;                                                   /* local: no vm-global reads in the hot loop */
  var y, x, o, rowDist, fogI, boostRow, stepX, stepY, fx, fy, s, c, tx, ty;
  var lBKX = -1, lBKY = -1, lLV = 0, gx, gy, fxI, fyI, ck;
  // ---- floor (below horizon): rowDist = eyeH*H/(y-horizon)
  for (y = horizon + 1; y < H; y++){
    rowDist = (eyeH * H) / (y - horizon);
    fogI = fogFixed(rowDist);
    boostRow = (fogI * flickI) >> 8;
    stepX = rowDist * (rrx - rlx) / W * 64;
    stepY = rowDist * (rry - rly) / W * 64;
    fx = (posX + rowDist * rlx) * 64;
    fy = (posY + rowDist * rly) * 64;
    o = y * W;
    for (x = 0; x < W; x++){
      fxI = ((fx + foff) | 0) - foff;                          // = floor(fx*64)
      fyI = ((fy + foff) | 0) - foff;
      gx = fxI >> 6; gy = fyI >> 6;                                // = floor(world)
      ck = (gx >> 2) - lBKX | 0;
      if (ck){ lBKX = gx >> 2; lBKY = gy >> 2; lLV = lightMulB(lBKX, lBKY); }
      else { ck = (gy >> 2) - lBKY; if (ck){ lBKY = gy >> 2; lLV = lightMulB(lBKX, lBKY); } }
      tx = fxI & 63; ty = fyI & 63;
      s = (boostRow * lLV) >> 8;
      s = (s * boost[x]) >> 8;
      c = carpet[(ty << 6) + tx];
      var rr = ((c & 255) * s) >> 8; if (rr > 255) rr = 255;
      var gg = (((c >>> 8) & 255) * s) >> 8; if (gg > 255) gg = 255;
      var bb = (((c >>> 16) & 255) * s) >> 8; if (bb > 255) bb = 255;
      pix[o + x] = (0xff000000 | (bb << 16) | (gg << 8) | rr);
      fx += stepX; fy += stepY;
    }
  }
  // ---- ceiling (above horizon): rowDist = (1-eyeH)*H/(horizon-y)
  for (y = horizon - 1; y >= 0; y--){
    rowDist = ((1 - eyeH) * H) / (horizon - y);
    fogI = fogFixed(rowDist);
    boostRow = (fogI * flickI) >> 8;
    stepX = rowDist * (rrx - rlx) / W * 64;
    stepY = rowDist * (rry - rly) / W * 64;
    fx = (posX + rowDist * rlx) * 64;
    fy = (posY + rowDist * rly) * 64;
    o = y * W;
    lBKX = -1; lBKY = -1;
    for (x = 0; x < W; x++){
      fxI = ((fx + foff) | 0) - foff;
      fyI = ((fy + foff) | 0) - foff;
      gx = fxI >> 6; gy = fyI >> 6;
      ck = (gx >> 2) - lBKX | 0;
      if (ck){ lBKX = gx >> 2; lBKY = gy >> 2; lLV = lightMulB(lBKX, lBKY); }
      else { ck = (gy >> 2) - lBKY; if (ck){ lBKY = gy >> 2; lLV = lightMulB(lBKX, lBKY); } }
      tx = fxI & 63; ty = fyI & 63;
      s = (boostRow * lLV) >> 8;
      s = (s * boost[x]) >> 8;
      // lit block -> light panel texture; dark blocks are dim/black areas
      c = (lLV === 256 ? panel : ceil)[(ty << 6) + tx];
      var rr2 = ((c & 255) * s) >> 8; if (rr2 > 255) rr2 = 255;
      var gg2 = (((c >>> 8) & 255) * s) >> 8; if (gg2 > 255) gg2 = 255;
      var bb2 = (((c >>> 16) & 255) * s) >> 8; if (bb2 > 255) bb2 = 255;
      pix[o + x] = (0xff000000 | (bb2 << 16) | (gg2 << 8) | rr2);
      fx += stepX; fy += stepY;
    }
  }
}
function renderFlatRows(horizon){
  var W = R.W, H = R.H, pix = R.pix, ff = R.flatFloor, fc = R.flatCeil, x, y, c, o;
  for (y = 0; y < H; y++){
    o = y * W;
    if (y > horizon){ c = ff[y - horizon > 15 ? 15 : y - horizon]; }
    else if (y < horizon){ c = fc[horizon - y > 15 ? 15 : horizon - y]; }
    else { c = 0xff000000; }
    for (x = 0; x < W; x++) pix[o + x] = c;
  }
}

/* ------------------------------------------------------ §3.4 billboard sprites */
function renderMonster(dirX, dirY, planeX, planeY, eyeH, horizon, flickI){
  if (!M.active) return;
  var dx = M.x - P.x, dy = M.y - P.y;
  var invDet = 1 / (planeX * dirY - dirX * planeY);
  var tX = invDet * (dirY * dx - dirX * dy);
  var tY = invDet * (-planeY * dx + planeX * dy);
  if (tY <= 0.05 || tY >= R.drawDist) return;                    // behind / fogged
  var W = R.W, H = R.H, pix = R.pix, zbuf = R.zbuf, boost = R.boost;
  var sx = (W / 2) * (1 + tX / tY);
  var hpx = (TUNE.M_HEIGHT * H) / tY;
  var wpx = hpx * (TUNE.M_WIDTH / TUNE.M_HEIGHT);
  var spr = TEX.mon[M.frame];
  var x0 = Math.ceil(sx - wpx / 2), x1 = Math.floor(sx + wpx / 2);
  if (x1 < 0 || x0 >= W || wpx < 1) return;
  var yTop = horizon + (eyeH - TUNE.M_HEIGHT) * (H / tY);
  var yBot = horizon + eyeH * (H / tY);
  var yA = yTop < 0 ? 0 : yTop | 0;
  var yB = yBot > H ? H : yBot | 0;
  var baseS = (fogFixed(tY) * flickI) >> 8;
  baseS = (baseS * lightMul(M.x | 0, M.y | 0)) >> 8;
  var data = spr.data, tw = spr.w, th = spr.h;
  var x, y, c, s, a;
  for (x = x0 > 0 ? x0 : 0; x <= (x1 < W - 1 ? x1 : W - 1); x++){
    if (tY >= zbuf[x]) continue;                                  // occluded by wall
    var texX = ((x - (sx - wpx / 2)) / wpx * tw) | 0;
    if (texX < 0) texX = 0; else if (texX >= tw) texX = tw - 1;
    s = (baseS * boost[x]) >> 8;
    for (y = yA; y < yB; y++){
      var texY = ((y - yTop) / hpx * th) | 0;
      if (texY < 0) texY = 0; else if (texY >= th) texY = th - 1;
      c = data[texY * tw + texX];
      a = c >>> 24;
      if (a < 128) continue;
      var rm = ((c & 255) * s) >> 8; if (rm > 255) rm = 255;
      var gm = (((c >>> 8) & 255) * s) >> 8; if (gm > 255) gm = 255;
      var bm = (((c >>> 16) & 255) * s) >> 8; if (bm > 255) bm = 255;
      pix[y * W + x] = (0xff000000 | (bm << 16) | (gm << 8) | rm);
    }
  }
}

/* --------------------------------------- §6 first-person body overlay (no depth) */
function renderArms(){
  var spr = TEX.arms, OW = R.armsW, OH = R.armsH, W = R.W, H = R.H, pix = R.pix;
  var ox = ((W - OW) >> 1) + (P.swayPx | 0);
  var oy = H - OH + (P.bobArm | 0);
  var stepS = spr.w / OW, stepT = spr.h / OH;
  var sF = (G.flicker * 256 * 0.55 + 256 * 0.45) | 0;            // arms dim in blackouts
  var x, y, c, s;
  for (y = 0; y < OH; y++){
    var dy = oy + y;
    if (dy < 0 || dy >= H) continue;
    var st = y * stepT | 0;
    for (x = 0; x < OW; x++){
      var dxp = ox + x;
      if (dxp < 0 || dxp >= W) continue;
      c = spr.data[st * spr.w + (x * stepS | 0)];
      if ((c >>> 24) < 128) continue;
      s = sF;
      pix[dy * W + dxp] = (0xff000000 |
                          ((((c >>> 16) & 255) * s >> 8) << 16) |
                          ((((c >>> 8) & 255) * s >> 8) << 8) |
                          (((c & 255) * s) >> 8));
    }
  }
}

/* --------------------------------------------------------- frame composition */
function renderFrame(){
  var dirX = Math.cos(P.a), dirY = Math.sin(P.a);
  var planeX = -dirY * TUNE.FOV_PLANE, planeY = dirX * TUNE.FOV_PLANE;
  var eyeH = 0.5 + P.bobEye;
  var horizon = (R.H >> 1) + P.pitchPx;
  var flickI = (G.flicker * 256) | 0;
  var posX = P.x, posY = P.y;
  if (R.floorOn) renderFloorCeil(posX, posY, dirX, dirY, planeX, planeY, eyeH, horizon, flickI);
  else renderFlatRows(horizon);
  renderWalls(posX, posY, dirX, dirY, planeX, planeY, eyeH, horizon, flickI);
  renderMonster(dirX, dirY, planeX, planeY, eyeH, horizon, flickI);
  renderArms();
  ctx.putImageData(R.buf, 0, 0);                                 // single putImageData
  ctx.drawImage(R.vig, 0, 0);                                    // §3.5 vignette+scanlines
}
