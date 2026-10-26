# Isolated rat combat dice

This directory is a full copy of the root `dice/` module. Originals are preserved. `DiceService` adds validated appearance options `throwSide: 'top' | 'bottom'` (default bottom) and `color: 'black' | 'light'` (default light), passed into the local frame URL.

The copied engine embeds an Ammo physics worker as base64 `ml` in `vendor/dice-box/dice-box.es.js`. Only its `fe()` start-position expression changes: top uses negative world Z and bottom positive world Z (verified against the actual camera projection: +Z projects below center), preserving random X, throw height, and inward velocity from `ge()`. The top-down camera and canvas are not rotated. Unspecified worker config preserves the upstream random-edge behavior.

`nest-black` derives pale numeric/pip markings on charcoal faces from the copied Nest texture. All rendering, meshes, WASM, and textures use local paths.

Run `node --test demos/rat-combat-sequence/dice/tests/*.test.js`. Browser/WebGL appearance and physical settling require separate browser verification.
