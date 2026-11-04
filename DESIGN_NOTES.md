# DESIGN_NOTES.md — LEVEL 0

Per-section implementation summary, in the order the spec numbers them.
Assumptions are listed per section and collected at the bottom.

## §3 Rendering

- **Buffer**: `<canvas>` is 320×180 and CSS-upscaled with
  `image-rendering: pixelated` (crisp-edges fallback), letterboxed on black.
  One reusable `ImageData` + `Uint32Array` view; exactly one `putImageData`
  per frame; the frame loop allocates nothing (all buffers preallocated in
  `R`; per-tier `fitCanvas()` reuses them).
- **Walls**: DDA per column exactly as specified (`cameraX`, `deltaDistX/Y`,
  sideDist stepping, perpendicular distance from `sideDist - deltaDist`).
  `zbuf[x]` stores perpDist for sprites. texX from the wall-hit fraction with
  the two side-consistency flips. Shade =
  `fog(perp) · flicker(t) · lightLevel(block) · sideShade · flashlight(x)`.
- **Fog**: linear fade to black, fully dark at the draw-distance edge
  (implemented in fixed point: `fogFixed()` returns 0..256).
- **Floor/ceiling**: row casting below/above `horizon = H/2 + pitch`.
  World position is accumulated in 1/64-texel fixed point and biased into
  int32 once per pixel (`((fx64 + OFF) | 0) - OFF`), which removes both
  `Math.floor` calls and all vm-global lookups from the inner loop — the
  ceiling/floor pass measures ~3 ms/frame at tier 1 (was ~10 ms).
- **Sprites**: billboard projection per spec with the standard
  `invDet` transform, z-tested against `zbuf[x]`, fog+light shaded.
- **Post**: vignette + scanline pre-rendered once to an offscreen canvas and
  composited per frame; skipped when it would cost >1 ms (it doesn't).
- **Channel-saturation note**: the flashlight boost can push `s` past 256;
  scaled channels are saturated at 255 so carries never bleed into the next
  channel byte (a cyan smear artifact found and fixed during browser testing).

## §4 World & generation

- **Storage**: `Map` keyed `"cx,cy"` → `Uint8Array(256)`. Generate within
  radius 3 (≤49 chunks), prune beyond radius 4, plus a hard
  `MAX_CHUNKS: 49` cap (the radius-3 set is exactly 7×7=49, so the cap makes
  the bound provable, not just heuristic). One chunk generates synchronously
  in well under a millisecond; there are no loading screens.
- **Seeding**: `hash32(seed, cx, cy, salt)` (splitmix-style mixing); each
  chunk gets `rngFrom(hash)` so generation is order-independent — revisiting
  a pruned chunk regenerates identically.
- **Archetypes**: OPEN_OFFICE / MAZE / HALLS / ATRIUM weighted per rng;
  spawn chunk (0,0) forced OPEN_OFFICE.
- **Border openings**: `openingsForEdge(seed, cx, cy, side)` is a pure
  function of the edge, agreed by both neighbors, so adjacent chunks always
  agree. Opening cells are forced to floor.
- **Connectivity**: flood-fill from all openings; unreached floor becomes
  wall; unreached openings get a Bresenham carve to the nearest reached
  cell. Two subtle bugs were found here and fixed (see Assumptions): a
  closure capturing the loop variable, and diagonal carve steps not being
  4-connected. Carve lines now also open the orthogonal corner cell on every
  diagonal step, so every carved line is 4-connected like the flood fill.
- **Lighting**: per 4×4-cell block hash → lit 80% / dim 15% / dark 5%,
  cached per block in fixed point (`lightMulB`). Global flicker 1.0 ±8%
  smooth noise; blackouts every 45–120 s for 2–4 s at 0.15 light, during
  which the monster may teleport 8–14 away out of LOS (once per blackout).

## §5 Textures & sprites

All 64×64, `Uint32Array[4096]`, generated at boot: wallpaper (yellow with
stripes, mottling, bottom stains), carpet (noise + damp patches), ceiling
tile (32-px seams + grime), light panel (warm gradient + dark frame),
3-frame monster silhouette (2.2 u tall, limb sway), first-person arms +
flashlight. Sprite art is drawn once to offscreen canvases and blitted into
Uint32 arrays with an alpha channel.

## §6 Player

Walk 3.0 / sprint 5.2 u/s, stamina 4 s drain / 6 s regen / 15% floor.
Axis-separated circle-vs-grid collision (radius 0.2) → smooth wall sliding.
Delta-time physics clamped to 0.1 s. Head bob ±0.03 u + pitch offset drives
footsteps. Pointer Lock with arrow-key fallback (fully playable without
mouse). The player is a full world entity (position + radius) used by AI.
First-person arms + flashlight are a bottom-center overlay with sway/bob;
the flashlight brightens center columns. HUD: stamina bar bottom-left, seed
bottom-right. `M` mute, `F` FPS, `1/2/3` tiers.

## §7 Monster

Exactly one Wanderer. ROAM (A* to random cells, 1.4 u/s) → CHASE on LOS or
hearing (A* to player, repath 0.5 s or on cell change, 4.4 u/s) → SEARCH
after 4 s without LOS (path to last-known, wait 3 s, sweep 2 cells) → ROAM
after 15 s. Catch below 0.6 u snaps the camera and fades to black. LOS is a
grid DDA. Hearing: sprinting within 10 u through walls. Spawn after the
20 s / 30-cell gate at 18–26 u, no LOS, preferring dark blocks; despawns
beyond 40 u for 60 s and respawns. A* window 21×21, ≤256 expanded nodes,
preallocated Int32 binary heap (zero per-call allocation); outside the
window it greedy-steers. All state-machine constants live in `TUNE`.

## §8 Audio

WebAudio, fully synthesized, created on first gesture. Fluorescent hum (two
detuned ~100/120 Hz oscillators + lowpassed noise, slow wobble), footsteps
on the bob cycle (louder/faster when sprinting), monster drone + irregular
knocks with gain mapped to proximity (audible before you see it), a sting on
CHASE start, a power-down whoosh on blackouts, master gain with `M` mute.

## §9 Performance

Tier table `[W, H, drawDist, floorOn]` with auto-drop at <28 (<24 for
tier 3) averaged over 3 s and 10 s hysteresis; manual `1/2/3`. Bounded
chunk set (≤49 × 256 B ≈ 12 KB of grid data), textures precomputed once,
no per-frame allocation, no per-frame string building. Measured on the dev
host (Node, tier 1): **8.7 ms/frame** (floor/ceil 3.0, walls 3.8, sprites
<0.1, update+AI ≤2) — inside the 16.6 ms budget with headroom; the tier
ladder covers slower machines.

## §10 Flow

Title (seed input, controls, ENTER) → pointer-locked play → pause overlay on
pointer-lock loss (Resume / Restart / Mute) → caught: 1 s camera snap, fade,
"YOU ARE LOST" (R = same seed, Enter = new seed). All in-page, monospace
amber-on-black.

## §12 Stretch

Not attempted: §12 stretch items were skipped per "only if everything else
passes §14" — and a real rendering bug (§3 note above) was found and fixed
during final browser testing instead.

## Assumptions

1. **"Wall height 1.0, eye 0.5"** — implemented literally; floor casting
   uses `eyeH·H/(y−horizon)`, ceiling uses `(1−eyeH)·H/(horizon−y)`.
2. **Chunk bound ≤49** — enforced by a hard cap in addition to the radius-4
   prune, since the radius-3 generation set is exactly 7×7.
3. **Monster despawn** (§7 table) is part of the FSM and is tested; the
   spawn prefers dark blocks when a no-LOS floor cell exists at the target
   distance, falling back to any no-LOS floor cell otherwise.
4. **`F` FPS counter and `1/2/3`** override auto tier selection until the
   next auto-drop window; the auto-ladder never upgrades more than once per
   10 s.
5. **Audio before gesture**: nothing is created until the ENTER click;
   verified in the audit harness.
6. **Node-only verification of §13 items that need a real browser** (console
   cleanliness, pointer lock, real audio state) is backed by a headless
   harness (`harness.js`, vm-stubbed DOM/canvas/WebAudio) plus a manual
   browser pass: title → play → pause → caught → restart were exercised in
   a real browser at 60 FPS with zero console errors.
