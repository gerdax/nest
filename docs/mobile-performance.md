# Comparing player effects on a phone

The standalone player includes **Performance comparison · effects** inside **Controls**, at the bottom-right of the playfield. This is a session-only diagnostic panel; the original appearance is the default. It does not change projects, exported JSON, motion settings, or the editor. Reload restores Original effects. `player.html?perf=1#performance-mode` opens the panel directly.

**Original effects** enables every effect. **Light effects** disables all five effects. Individual checkboxes disable card shadows, artwork colorization, paper texture, the masked rim, and inventory backdrop blur. The controls affect CSS rendering only: shadow calculations, DOM updates, gesture sampling, source asset sizes, and motion physics remain the same. Thus this first comparison isolates visual effect cost rather than every potential source of work. It does not yet test smaller textures or one-render-per-frame input scheduling.

## A52 comparison procedure

1. Export the same project from the local editor and load it in the player with **Open JSON**. Use the same phone, browser, orientation, display refresh setting, and game position for every trial.
2. Let artwork finish loading. Repeat a few swipes to warm the cache before measuring.
3. Select Original effects. Return to a repeatable situation, such as an incomplete downward swipe that you cancel, so no items are consumed and the same cards remain visible.
4. Choose **Record 10 seconds**, close Controls after starting the recording, and repeat that gesture 5–10 times. You can stop early; the report states how recording ended.
5. Repeat with Light effects. Then restore Original and disable one effect at a time, beginning with Shadows. Keep card count and gestures consistent.
6. The report textarea keeps the last five runs for copying. Each records its effects, chapter, starting card count, viewport, DPR, browser identifier, active interval count, mean and p95 interval, callback cadence, and count of gaps above 33.3 ms.

Recording samples only consecutive animation-frame callbacks while the same visible deck has input or animation activity. Idle intervals, stopped players, and asynchronous waits without motion are excluded. Changing effects or hiding the page ends the recording. The measurement loop runs only while recording and stops after ten seconds. A held finger can include intervals without visual movement; use repeated, consistent gestures instead of holding still.

These are **RAF callback intervals, not GPU timings or proof of presented FPS**. The 33.3 ms count is a fixed comparison threshold, not an estimate of dropped frames at the phone's refresh rate. A low sample count or an idle recording is not evidence of good performance. Compare multiple runs and perceived smoothness. If Light improves motion, separate effect toggles identify the next optimization to profile. If it does not, investigate rendering cadence, geometry/DOM work, texture memory, and the device trace before changing animation behavior.

## Local phone preview

Prepare a fresh staging directory:

```sh
python3 build_pages.py /tmp/nest-mobile-2
python3 -m http.server 8940 --bind 0.0.0.0 --directory /tmp/nest-mobile-2
```

The build creates a missing directory and refuses to overwrite a nonempty one. If a server already uses port 8940, stop it with Ctrl+C before starting the new command. On a phone on the same Wi-Fi, open `http://MAC_LAN_IP:8940/player.html?perf=1#performance-mode`, replacing `MAC_LAN_IP` with the Mac's network address. Staging is a snapshot; rebuild into a fresh directory after code changes. Public GitHub Pages is updated separately and does not include local changes until published.


The [portrait layout report](portrait-layout-2026-10-16.md) records short, standard and tall viewport checks and the remaining physical-device limitations.
