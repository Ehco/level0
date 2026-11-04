# LEVEL 0 — Infinite Backrooms

A single-file, zero-asset, infinite Backrooms-style first-person horror game.
Everything — textures, sprites, audio, world — is generated in code at boot.
Runs by double-clicking `index.html` from `file://`, fully offline. No WebGL,
no libraries, no build step, no network.

## How to run

1. Double-click `index.html` (any modern browser).
2. Optionally type a seed, or leave blank for a random one.
3. Click **ENTER**. The game requests Pointer Lock and starts.

## Controls

| Input | Action |
|---|---|
| `W A S D` / mouse | Move / look (Pointer Lock — click canvas to capture, Esc releases and pauses) |
| `↑ ↓` | Move (arrow-only fallback) |
| `← →` | Rotate (arrow-only fallback) |
| `Shift` | Sprint (drains stamina; must exceed 15% to re-start sprinting) |
| `M` | Mute |
| `F` | FPS counter |
| `1 / 2 / 3` | Quality tier override |
| `R` | (when lost) Retry same seed |
| `Enter` | (when lost) New random seed |

## Quality tiers

| Tier | Resolution | Draw dist | Floor casting | Trigger |
|---|---|---|---|---|
| 1 (default) | 320×180 | 24 | on | — |
| 2 | 240×135 | 16 | on | avg FPS < 28 over 3 s |
| 3 | 200×112 | 12 | off (flat fog gradient) | avg FPS < 24 at tier 2 |

Auto-drop with 10 s hysteresis; manual override with `1/2/3`. The FPS counter
(`F`) lets you verify on your actual machine.

## Tuning constants

Every gameplay constant lives in one `TUNE` table inside `index.html`
(search `var TUNE = {` — it sits at the top of the main `<script>`, right
after the `TIERS` quality table):

| Constant | Meaning | Spec |
|---|---|---|
| `WALK:3.0` `SPRINT:5.2` | player speeds (u/s) | §6 |
| `STAM_DRAIN:4.0` `STAM_REGEN:6.0` `STAM_MIN:0.15` | stamina drain/regen (s), re-sprint floor | §6 |
| `P_RAD:0.2` | player collision radius | §6 |
| `BOB_AMP:0.03` `BOB_PITCH:2` | head bob amplitude (u) / pitch (px) | §6 |
| `ROT_SPEED:2.8` `MOUSE_SENS:0.0025` | arrow rotate (rad/s) / mouse sens | §6 |
| `M_ROAM:1.4` `M_CHASE:4.4` `M_RAD:0.28` | monster roam/chase speed (u/s), radius | §7 |
| `M_HEIGHT:2.2` `M_WIDTH:1.1` | monster world size | §7 |
| `GRACE:20` `ODO_SPAWN:30` | spawn gate: 20 s or 30 cells walked | §7 |
| `SPAWN_MIN:18` `SPAWN_MAX:26` | spawn distance window (u) | §7 |
| `DESPAWN_D:40` `DESPAWN_T:60` | despawn beyond 40 u for 60 s | §7 |
| `CATCH_D:0.6` | catch distance | §7 |
| `HEAR_D:10` | sprint hearing distance (through walls) | §7 |
| `LOSE_T:4` | CHASE→SEARCH after LOS lost (s) | §7 |
| `REPATH:0.5` | CHASE repath interval (s) | §7 |
| `SEARCH_WAIT:3` `SEARCH_T:15` | search wait / give-up (s) | §7 |
| `ASTAR_WIN:21` `ASTAR_CAP:256` | A* window / expanded-node cap | §7 |
| `BB_MIN:45` `BB_VAR:75` | blackout every 45–120 s | §4.4 |
| `BB_DUR_MIN:2` `BB_DUR_VAR:2` | blackout lasts 2–4 s | §4.4 |
| `BB_LIGHT:0.15` | light level during blackout | §4.4 |
| `TIER_FPS2:28` `TIER_FPS3:24` | auto-drop thresholds | §9 |
| `TIER_WINDOW:3` `TIER_HYST:10` | FPS averaging window / hysteresis (s) | §9 |
| `PRUNE_R:4` `GEN_R:3` `MAX_CHUNKS:49` | chunk keep/generate radii + hard cap | §4.1 |
| `FOV_PLANE:0.649` | tan(66°/2) — FOV | §3.1 |

Other useful in-game handles (console, when running from `file://`):
`L0.stats()` (mode, position, chunk count, monster state), `L0.seed()`,
`L0.setTier(n)`, `L0.press(code, down)`, `L0.verify(rows)` — a debug API used
by the automated audit; see DESIGN_NOTES.md.
