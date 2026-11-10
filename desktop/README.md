# Nest Studio on macOS

Build the local launcher with:

```sh
desktop/build-macos-launcher.sh "$HOME/Applications/Nest Studio.app"
```

Open Nest Studio from Applications or pin it to the Dock. A new Studio window resumes the last successfully opened project in its dedicated Chrome profile. If the profile has no remembered project, Studio uses `nest-project.json`. The launcher uses the existing Nest server on port 8960 or starts it locally. Rebuild it if you move the repository.

The launcher requires Google Chrome in Applications and the macOS command-line tools for Python and building. Its Chrome profile and server log live in `~/Library/Application Support/Nest Studio`.

For a portable desktop release, revisit Electron. Bundling Chromium would keep rendering close to the browser used for testing. Bundle the editor and its save backend, and verify project storage, card gestures and dice before packaging.
