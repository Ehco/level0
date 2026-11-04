
/* ============================================================= §5 textures
   All 64x64, Uint32Array[4096], little-endian ABGR (0xAABBGGRR). */
var TEX = {};
function vhash(ix, iy, s){ return hash32(ix, iy, s, 0xA653) / 4294967295; }
function vnoise(x, y, s){
  var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  var a = vhash(ix, iy, s), b = vhash(ix + 1, iy, s);
  var c = vhash(ix, iy + 1, s), d = vhash(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pxPix(r, g, b){ return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0; }
function clamp255(v){ return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

function genTextures(){
  var S = 64 * 64, i, x, y, t, rng;
  // §5 wallpaper: yellow base, faint vertical stripes, mottling, bottom stains
  var wall = new Uint32Array(S);
  rng = rngFrom(hash32(worldSeed, 0, 0, 0x7E11));
  var stains = [];
  for (i = 0; i < 6; i++) stains.push({ x: rng() * 64, y: 40 + rng() * 24, r: 4 + rng() * 6 });
  for (y = 0; y < 64; y++) for (x = 0; x < 64; x++){
    var n = vnoise(x * 0.13, y * 0.13, 11) * 0.6 + vnoise(x * 0.42, y * 0.42, 12) * 0.4;
    var m = 1;
    if (x % 8 === 0) m *= 0.92;                       // faint stripe every 8 px
    for (t = 0; t < 6; t++){
      var st = stains[t], dx = x - st.x, dy = y - st.y, d2 = dx * dx + dy * dy;
      if (d2 < st.r * st.r) m *= 0.62 + 0.38 * Math.sqrt(d2 / (st.r * st.r));
    }
    var rr = (201 + n * 22) * m, gg = (180 + n * 20) * m, bb = (88 + n * 20) * m;
    wall[y * 64 + x] = pxPix(clamp255(rr), clamp255(gg), clamp255(bb));
  }
  TEX.wall = wall;
  // §5 carpet: brown-yellow, per-pixel mottling, darker damp patches
  var carpet = new Uint32Array(S);
  rng = rngFrom(hash32(worldSeed, 0, 0, 0x7E12));
  var damp = [];
  for (i = 0; i < 4; i++) damp.push({ x: rng() * 64, y: rng() * 64, r: 6 + rng() * 10 });
  for (y = 0; y < 64; y++) for (x = 0; x < 64; x++){
    var n2 = 0.82 + vhash(x, y, 21) * 0.30;
    var m2 = 1;
    for (t = 0; t < 4; t++){
      var dp = damp[t], dx2 = x - dp.x, dy2 = y - dp.y, d22 = dx2 * dx2 + dy2 * dy2;
      if (d22 < dp.r * dp.r) m2 *= 0.60 + 0.40 * Math.sqrt(d22 / (dp.r * dp.r));
    }
    carpet[y * 64 + x] = pxPix(clamp255(122 * n2 * m2), clamp255(109 * n2 * m2), clamp255(63 * n2 * m2));
  }
  TEX.carpet = carpet;
  // §5 ceiling tile: off-white, seams every 32 px, grime
  var ceil = new Uint32Array(S);
  for (y = 0; y < 64; y++) for (x = 0; x < 64; x++){
    var gr = 0.86 + vnoise(x * 0.2, y * 0.2, 31) * 0.14;
    var seam = (x % 32 === 0) || (y % 32 === 0);
    var r3 = seam ? 148 : 214 * gr, g3 = seam ? 146 : 210 * gr, b3 = seam ? 140 : 198 * gr;
    ceil[y * 64 + x] = pxPix(clamp255(r3), clamp255(g3), clamp255(b3));
  }
  TEX.ceil = ceil;
  // §5 light panel: bright warm white, subtle gradient, dark frame
  var panel = new Uint32Array(S);
  for (y = 0; y < 64; y++) for (x = 0; x < 64; x++){
    if (x < 5 || x > 58 || y < 5 || y > 58){ panel[y * 64 + x] = pxPix(92, 90, 86); continue; }
    var dx3 = Math.max(Math.abs(x - 32) / 27, Math.abs(y - 32) / 27);
    var gf = 1 - 0.22 * dx3;
    panel[y * 64 + x] = pxPix(clamp255(255 * gf), clamp255(244 * gf), clamp255(218 * gf));
  }
  TEX.panel = panel;
}

/* ---------------------------------------- §5/§6 sprite art via offscreen canvas */
function texFromCanvas(c){
  var d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  return { w: c.width, h: c.height, data: new Uint32Array(d.data.buffer) };
}
function drawFigure(g, col, dx, sway){
  g.fillStyle = col;
  g.save(); g.translate(dx, 0);
  g.save(); g.translate(-3, -22); g.rotate(-sway); g.fillRect(-2, 0, 4, 22); g.restore(); // L leg
  g.save(); g.translate(3, -22); g.rotate(sway);  g.fillRect(-2, 0, 4, 22); g.restore(); // R leg
  g.fillRect(-6, -52, 12, 32);                                                            // torso
  g.beginPath(); g.arc(0, -57, 6, 0, Math.PI * 2); g.fill();                              // head
  g.save(); g.translate(-6, -50); g.rotate(0.15 + sway); g.fillRect(-2, 0, 4, 30); g.restore(); // L arm
  g.save(); g.translate(6, -50); g.rotate(-0.15 - sway); g.fillRect(-2, 0, 4, 30); g.restore(); // R arm
  g.restore();
}
function genSprites(){
  var f, c, g;
  // §5 The Wanderer: 3-frame tall dark silhouette, rim highlight, subtle sway
  TEX.mon = [];
  for (f = 0; f < 3; f++){
    c = document.createElement('canvas'); c.width = 64; c.height = 64;
    g = c.getContext('2d');
    var sway = (f - 1) * 0.09;
    drawFigure(g, '#48485c', 1.2, sway);  // rim highlight (right edge)
    drawFigure(g, '#131118', 0, sway);    // dark body on top
    TEX.mon.push(texFromCanvas(c));
  }
  // §6 first-person body: arms + flashlight, bottom-center overlay
  c = document.createElement('canvas'); c.width = 150; c.height = 92;
  g = c.getContext('2d');
  g.lineCap = 'round';
  g.strokeStyle = '#2a2420'; g.lineWidth = 15;                       // sleeves
  g.beginPath(); g.moveTo(-68 + 75, 34 + 58); g.quadraticCurveTo(-50 + 75, 5 + 58, -14 + 75, -6 + 58); g.stroke();
  g.beginPath(); g.moveTo(68 + 75, 34 + 58); g.quadraticCurveTo(50 + 75, 5 + 75, 14 + 75, -8 + 58); g.stroke();
  g.fillStyle = '#57493e';                                            // gloves
  g.beginPath(); g.ellipse(-14 + 75, -6 + 58, 7, 9, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(14 + 75, -8 + 58, 7, 9, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3f4147'; g.fillRect(10 + 75, -36 + 58, 12, 32);     // flashlight body
  g.fillStyle = '#6a6d75'; g.fillRect(10 + 75, -36 + 58, 12, 6);      // bezel highlight
  g.fillStyle = '#e8e2c2'; g.fillRect(12 + 75, -39 + 58, 8, 4);       // lens
  TEX.arms = texFromCanvas(c);
}

/* ---------------------------------------------- §3.5 post-processing overlays */
function genVignette(){
  var c = document.createElement('canvas'); c.width = R.W; c.height = R.H;
  var g = c.getContext('2d');
  var grad = g.createRadialGradient(R.W / 2, R.H / 2, R.H * 0.35, R.W / 2, R.H / 2, R.W * 0.72);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = grad; g.fillRect(0, 0, R.W, R.H);
  g.fillStyle = 'rgba(0,0,0,0.05)';                                   // subtle scanlines
  for (var y = 0; y < R.H; y += 2) g.fillRect(0, y, R.W, 1);
  R.vig = c;
}
/* §6 flashlight: precomputed brightness boost for center columns */
function genBoost(){
  var b = new Int32Array(R.W), x;
  for (x = 0; x < R.W; x++){
    var t = Math.abs(x - R.W / 2) / (R.W * 0.22);
    b[x] = 256 + (t < 1 ? 70 * (1 - t) : 0) | 0;
  }
  R.boost = b;
}
