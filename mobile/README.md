# The phone app

Android first, built with Expo and React Native. It connects to your Jellyfin server; the music stays there.

- `src/`: the screens and stores. What albums, artists and mixes are comes from the desktop app's own code (`../src/lib`, `src/shared.ts` names what is used), so both apps agree.
- `modules/media3-player/`: the audio engine, a small native module around Google's Media3: background playback, lock screen and headset controls, songs in a row without a gap, 24-bit decoding.

## What it does beyond playing

- **Sync:** playlists and where you stopped stay the same as on the desktop, through the [sync service](../sync-server/README.md) on your server. Without the service the app works as before; playlists then stay on the phone.
- **Quality** (tap the format line in the player): *Original* plays the file itself, *Compact* a 128 kbps copy, *Automatic* the best the connection carries. Smaller copies are AAC over HLS, made by Jellyfin; if it can't make them, the app plays the file.

## Running it

You need Node, Android Studio with its SDK, and a phone or emulator.

```bash
npm install
npx expo run:android
```

`android/` is generated (`npx expo prebuild`) and not kept in Git.

On Windows the native build breaks on long folder paths: keep the project close to the drive's root (`C:\bt` works). A `subst` drive doesn't help, because Gradle then sees the same files under two different roots.

## An APK for your phone

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The file lands in `android/app/build/outputs/apk/release/`. It is signed with the debug key, which is fine for your own phone and not for a store.
