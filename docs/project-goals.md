# NEST project goals

1. **Playable demo.** Build one chapter that can be played from start to finish. Use it to show how exploration, decisions, finding and using items, and combat fit together in NEST.
2. **Mobile playtesting.** Tune touch controls, layout, and performance on real phones. Establish a repeatable process for installing and updating test builds so the team can try each iteration on devices.
3. **Mobile release.** Develop NEST into a full game for iOS and Android, release it on the App Store and Google Play, and aim to reach a wide audience.

## Mobile playtesting

[Android Playtest](../android/README.md) uses a native WebView shell. Studio sends the selected chapter and its artwork over USB, and updates Player when its runtime files change. The device checks the candidate before activating it. Restart the app after disconnecting to verify offline startup.

For fast development, a phone on trusted Wi-Fi can also open Player from the Mac's local server and reload after a Studio save. Use the offline Android build for device acceptance, including touch gestures, combat, dice, and the Rat attack-to-choice transition. [Mobile performance](mobile-performance.md) describes the repeatable comparison.

Signed Android release packaging and an iOS distribution workflow are future release work.

## Card artwork export

Export card illustrations at **960 × 1280 px** in portrait orientation (**3:4**). Set the resolution metadata to **72 DPI** if the export tool provides that setting. The Player renders from the pixel dimensions, and the DPI metadata does not affect on-screen sharpness. Export a separate game-ready copy and keep the original artwork intact.

Check artwork sharpness in the mobile build on a physical high-density phone. The current Player layout suggests slight upscaling on a large iPhone such as the iPhone 17 Pro Max. This is a layout estimate and still needs device verification.
