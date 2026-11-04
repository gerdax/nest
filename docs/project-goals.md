# NEST project goals

1. **Playable demo.** Build one chapter that can be played from start to finish. Use it to show how exploration, decisions, finding and using items, and combat fit together in NEST.
2. **Mobile playtesting.** Tune touch controls, layout, and performance on real phones. Establish a repeatable process for installing and updating test builds so the team can try each iteration on devices.
3. **Mobile release.** Develop NEST into a full game for iOS and Android, release it on the App Store and Google Play, and aim to reach a wide audience.

## Proposed Android workflow

Use Capacitor to package the existing Player, the demo chapter, and its runtime assets. Keep two paths for testing:

- **Studio iteration.** On a trusted Wi-Fi network, configure a development build to load the Player from the Mac's local NEST server. Open the same named project in Studio and Player. After saving a change in Studio, reload the Player on the phone to load the latest saved version without rebuilding the app.
- **Installable demo.** Bundle a chosen export and its assets with the Player so the app can run offline. Use a signed Android App Bundle for Google Play internal testing. To ship a newer chapter in this mode, package the updated export in the next build.

The local-server preview is for development. Verify the packaged build separately on a phone, including startup offline, touch gestures, combat, and dice animation.

## Card artwork export

Export card illustrations at **960 × 1280 px** in portrait orientation (**3:4**). Set the resolution metadata to **72 DPI** if the export tool provides that setting. The Player renders from the pixel dimensions, and the DPI metadata does not affect on-screen sharpness. Export a separate game-ready copy and keep the original artwork intact.

Check artwork sharpness in the mobile build on a physical high-density phone. The current Player layout suggests slight upscaling on a large iPhone such as the iPhone 17 Pro Max. This is a layout estimate and still needs device verification.
