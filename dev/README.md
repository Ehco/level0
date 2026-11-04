# dev/ — build & test tooling

- `p1.html … p5.js` — the game's source parts, concatenated top-to-bottom
  into the single-file deliverable. `p1.html` opens the document and holds
  the CSS; `p5.js` closes the `<script>` tag.
- `build` — assembles `index.html` from the parts: `bash dev/build`
- `harness.js` — headless self-audit (`node dev/harness.js`); reads
  `index.html` directly, prints one `AUDIT | PASS/FAIL` line per check.
  Full run ≈ 2 min. Current count: 32 PASS / 0 FAIL (see SELF_AUDIT.md).
- `shot.js` — headless screenshot dumper (`node dev/shot.js out.png`) for
  deterministic level/lighting/prop QA. Note: canvas-painted sprites
  (monster, arms) are empty in these PNGs — verify those in a browser.
- `painter.html` — texture/sprite painter workbench for the embedded
  base64 RGB textures.

Edit the parts, rebuild, re-run the harness, commit all three together.
