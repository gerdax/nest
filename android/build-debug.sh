#!/usr/bin/env bash
# Build the dependency-free, native debug shell. Studio transfers the web runtime separately.
set -euo pipefail
android_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-"$HOME/Library/Android/sdk"}}
tools="$sdk/build-tools/35.0.0"
platform="$sdk/platforms/android-35/android.jar"
output=${1:-"$android_dir/build/nest-playtest-debug.apk"}
key=${NEST_ANDROID_DEBUG_KEYSTORE:-"$android_dir/build/debug.keystore"}

if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if [[ ! -f "$platform" || ! -x "$tools/aapt2" || ! -x "$tools/d8" ||
      ! -x "$tools/zipalign" || ! -x "$tools/apksigner" ]]; then
  echo "Install Android SDK Platform 35 and Build-Tools 35.0.0, then set ANDROID_HOME." >&2
  exit 1
fi
if ! javac -version >/dev/null 2>&1 || ! command -v keytool >/dev/null || ! command -v jar >/dev/null; then
  echo "Install JDK 17 and set JAVA_HOME." >&2
  exit 1
fi
if [[ "$output" != /* ]]; then output="$PWD/$output"; fi
if [[ "$key" != /* ]]; then key="$PWD/$key"; fi

work=$(mktemp -d "${TMPDIR:-/tmp}/nest-playtest-build.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
mkdir -p -- "$work/classes" "$work/dex" "$(dirname -- "$output")" "$(dirname -- "$key")"
if [[ ! -f "$key" ]]; then
  keytool -genkeypair -keystore "$key" -storepass android -keypass android -alias androiddebugkey \
    -dname "CN=Nest Playtest Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000
fi

"$tools/aapt2" link -I "$platform" --manifest "$android_dir/AndroidManifest.xml" -o "$work/shell.apk"
javac --release 8 -classpath "$platform" -d "$work/classes" "$android_dir"/src/org/nest/playtest/*.java
jar cf "$work/classes.jar" -C "$work/classes" .
"$tools/d8" --lib "$platform" --min-api 28 --output "$work/dex" "$work/classes.jar"
(cd "$work/dex" && zip -q -0 "$work/shell.apk" classes.dex)
"$tools/zipalign" -f 4 "$work/shell.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$key" --ks-key-alias androiddebugkey --ks-pass pass:android \
  --key-pass pass:android --v4-signing-enabled false --out "$work/signed.apk" "$work/aligned.apk"
"$tools/apksigner" verify "$work/signed.apk"
cp -- "$work/signed.apk" "$output"
printf '%s\n' "$output"
