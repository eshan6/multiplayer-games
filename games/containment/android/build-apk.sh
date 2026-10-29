#!/usr/bin/env bash
# Builds Containment.apk: the game's index.html in a full-screen WebView app.
#
# Needs a JDK (11+) and two pieces of the Android SDK, no Gradle or Android Studio:
#   BUILD_TOOLS  an extracted build-tools package (aapt2, d8, zipalign, apksigner),
#                e.g. https://dl.google.com/android/repository/build-tools_r35_linux.zip
#   ANDROID_JAR  android.jar from an extracted platform package,
#                e.g. https://dl.google.com/android/repository/platform-35_r02.zip
#   KEYSTORE     a signing keystore (created on first run if missing). Keep it: Android
#                only installs an update over an existing copy when it has the same signature.
#
#   BUILD_TOOLS=... ANDROID_JAR=... KEYSTORE=... games/containment/android/build-apk.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
: "${BUILD_TOOLS:?set BUILD_TOOLS to an extracted Android build-tools directory}"
: "${ANDROID_JAR:?set ANDROID_JAR to a platform android.jar}"
: "${KEYSTORE:=$HERE/containment.keystore}"
: "${KS_PASS:=containment}"
OUT="${OUT:-$HERE/Containment.apk}"
B="$(mktemp -d)"
trap 'rm -rf "$B"' EXIT

mkdir -p "$B/assets" "$B/gen" "$B/classes" "$B/dex"
cp "$HERE/../index.html" "$B/assets/index.html"

"$BUILD_TOOLS/aapt2" compile --dir "$HERE/res" -o "$B/res.zip"
"$BUILD_TOOLS/aapt2" link -o "$B/base.apk" -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" -A "$B/assets" --java "$B/gen" "$B/res.zip" \
  --min-sdk-version 24 --target-sdk-version 34 --auto-add-overlay

javac -nowarn -source 11 -target 11 -encoding UTF-8 -classpath "$ANDROID_JAR" -d "$B/classes" \
  $(find "$B/gen" "$HERE/src" -name '*.java') 2>&1 | grep -v 'bootstrap classpath' || true
"$BUILD_TOOLS/d8" --release --min-api 24 --lib "$ANDROID_JAR" --output "$B/dex" $(find "$B/classes" -name '*.class')

cp "$B/base.apk" "$B/unsigned.apk"
(cd "$B/dex" && zip -q "$B/unsigned.apk" classes.dex)
"$BUILD_TOOLS/zipalign" -p -f 4 "$B/unsigned.apk" "$B/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias containment \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Containment" >/dev/null 2>&1
fi
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias containment --out "$OUT" "$B/aligned.apk"
"$BUILD_TOOLS/apksigner" verify "$OUT"
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
