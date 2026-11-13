# Nest Studio on macOS

Build the local launcher with:

```sh
desktop/build-macos-launcher.sh "/Applications/Nest Studio.app"
```

Open Nest Studio from Applications. The launcher starts the local Nest server on port 8960, then opens Chrome’s installed Nest Studio web app. The web app has its own Nest icon in the Dock and Command-Tab; Chrome still renders it. The launcher itself runs without a Dock icon.

On the first launch, Chrome opens the editor in Nest’s existing dedicated profile. Choose **⋮ → Cast, save, and share → Install page as app…**, and install **Nest Studio**. Open the launcher again after installation. Menu wording can vary with Chrome language/version. No project migration or new Chrome profile is needed. The installed app’s name, icon and window mode come from `studio/app.webmanifest`.

Use the launcher in Applications to start Nest after restarting your Mac: it ensures the local server is available. Chrome’s generated app can be pinned to the Dock, but opening that shortcut directly does not start the local server. If it shows a connection error, open the launcher. Quitting Nest closes its web app; it does not quit your normal Chrome windows or stop the local server.

A new Studio window resumes the last successfully opened project in its dedicated Chrome profile. If the profile has no remembered project, Studio uses `nest-project.json`. Rebuild the launcher if you move the repository. Its profile and server log live in `~/Library/Application Support/Nest Studio`.

The launcher requires Google Chrome in Applications and macOS command-line tools for Python and building. If Swift reports that the default SDK is newer than the compiler, select a compatible installed SDK, for example on this Mac:

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk desktop/build-macos-launcher.sh "/Applications/Nest Studio.app"
```

For a portable desktop release, revisit Electron. Bundling Chromium would keep rendering close to the browser used for testing. Bundle the editor and its save backend, and verify project storage, card gestures and dice before packaging.
