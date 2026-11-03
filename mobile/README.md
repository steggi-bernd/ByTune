# The phone app

Android first, built with Expo and React Native. It connects to your Jellyfin server; the music stays there.

- `src/`: the screens and stores. What albums, artists and mixes are comes from the desktop app's own code (`../src/lib`, `src/shared.ts` names what is used), so both apps agree.
- `modules/media3-player/`: the audio engine, a small native module around Google's Media3: background playback, lock screen and headset controls, songs in a row without a gap.

## What it does beyond playing

- **Sync:** playlists, where you stopped and the order of Liked Songs stay the same as on the desktop, through the [sync service](../sync-server/README.md).
- **Quality** (tap the format line in the player): *Original* plays the file itself, *Compact* a 128 kbps copy, *Automatic* the best the connection carries, measured while data flows, and over mobile data up to 320 kbps. The line at the bottom of that sheet says what the sound goes through: decoder, output, speed. *24-bit output* in the settings keeps the full resolution of 24-bit files up to the phone's mixer; it is off by default, because one phone played songs far too fast and this may be why.
- **Volume leveling** (Settings): Jellyfin measures every song; the app brings loud ones down to −14 LUFS, Spotify's usual level, or −18 or −11 if you prefer. It only ever turns down.
- **Away from home** (Settings): a second address for your server, say a tunnel or proxy. The app asks both when the network changes and takes the direct way when it can; songs under way go on from the other address.
- **Downloads:** the ⋮ on a song, or the arrow on an album or playlist. Each song's row shows how far it is. The app fetches them itself, over the same way as the player, also with the screen off, and goes on where it stopped when a connection breaks. A kept song brings its cover and lyrics. Settings choose the file itself or a 192 kbps MP3, and whether mobile data may be used.
- **Without a connection** the app opens from what it remembers: the library, playlists, the small covers it fetched on Wi-Fi, lyrics it has shown. Downloaded songs play, the rest is greyed out.

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
