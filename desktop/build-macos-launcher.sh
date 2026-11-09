#!/bin/bash
set -euo pipefail

workspace="$(cd "$(dirname "$0")/.." && pwd -P)"
destination="${1:?Usage: desktop/build-macos-launcher.sh /path/to/Nest Studio.app}"
build="$(mktemp -d "${TMPDIR:-/tmp}/nest-studio.XXXXXX")"
trap 'rm -rf "$build"' EXIT

app="$build/Nest Studio.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
swiftc -parse-as-library -module-cache-path "$build/ModuleCache" -O "$workspace/desktop/NestStudioLauncher.swift" -o "$app/Contents/MacOS/NestStudio"
printf '%s\n' "$workspace" > "$app/Contents/Resources/workspace.txt"
cp "$workspace/desktop/NestStudio.icns" "$app/Contents/Resources/NestStudio.icns"

cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>studio.nest.local-launcher</string>
  <key>CFBundleName</key><string>Nest Studio</string>
  <key>CFBundleDisplayName</key><string>Nest Studio</string>
  <key>CFBundleExecutable</key><string>NestStudio</string>
  <key>CFBundleIconFile</key><string>NestStudio.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

codesign --force --sign - "$app"
ditto "$app" "$destination"
printf 'Built %s\n' "$destination"
