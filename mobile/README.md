# The phone app

Android first, built with Expo and React Native. It connects to your Jellyfin server; the music stays there.

- `src/`: the screens and stores. What albums, artists and mixes are comes from the desktop app's own code (`../src/lib`, `src/shared.ts` names what is used), so both apps agree.
- `modules/media3-player/`: the audio engine, a small native module around Google's Media3: background playback, lock screen and headset controls, songs in a row without a gap.

## What it does beyond playing

- **The player's page:** as on Spotify. The title leads to its album, the artist to the artist, "Playing from" to the list it started from. The bottom row shows where the sound goes (tap it for the devices), what really plays, in signal colours from gold for lossless down to red, and the download arrow, which also takes the song off again. Under the page lie the lyrics, what comes next, and about the song and the artist, as in the desktop app's side panel.
- **Sync:** playlists, where you stopped, muted songs and the order of Liked Songs stay the same as on the desktop, through the [sync service](../sync-server/README.md). A phone that isn't playing shows what another device plays and steers it, and the other way round.
- **Devices** (the speaker in the mini player or the player): tiles for this phone and Android's own list of outputs, your other devices with Songsta, and what's on your Wi-Fi: receivers and network speakers over UPnP/DLNA, Chromecast, Google TV and Nest speakers over Cast. A press moves the music there; the plus lets another one play along, each with its own volume; a device's menu has *Play something else here*, which gives it its own queue next to yours. Those devices fetch the songs from your server's home address themselves, always as the file itself, so the phone can sleep; a notification keeps it running to say what's next, the lock screen and headset buttons steer it, and the volume keys reach the device. A group of separate devices isn't sample-exact: each one fetches and buffers by itself, which you can hear between two speakers in one room. A Cast group made in Google's own app is exact, and shows up here as one device. Amazon lets no app send music to an Echo or Fire TV directly, so those are listed with how to pair them over Bluetooth.
- **Quality** (tap what's playing in the player): *Original* plays the file itself, *Compact* a 128 kbps copy, *Automatic* the best the connection carries, measured while data flows, and over mobile data up to AAC 256 kbps, Jellyfin's highest. The line at the bottom of that sheet says what the sound goes through: decoder, output, speed. *24-bit output* in the settings keeps the full resolution of 24-bit files up to the phone's mixer; it is off by default, because one phone played songs far too fast and this may be why.
- **Volume leveling** (Settings): Jellyfin measures every song; the app brings loud ones down to −14 LUFS, Spotify's usual level, or −18 or −11 if you prefer. It only ever turns down.
- **Away from home** (Settings): a second address for your server, say a tunnel or proxy. The app asks both when the network changes and takes the direct way when it can; songs under way go on from the other address.
- **Swipes:** pull a song left in any list: let go quickly and it joins the queue; hold it a moment and it branches off, with the rest of its list behind it, as in the desktop app. Pull it right to mute it: greyed out with a red name, skipped everywhere, and played only when you tap it or queue it yourself. The same pull unmutes it.
- **Downloads:** the arrow in the player, the ⋮ on a song, or the arrow on an album or playlist. Each song's row shows how far it is. The app fetches them itself, over the same way as the player, also with the screen off, and goes on where it stopped when a connection breaks. A kept song brings its cover and lyrics. Settings choose the file itself or a 192 kbps MP3, and whether mobile data may be used.
- **Without a connection** the app opens from what it remembers: the library, playlists, the small covers it fetched on Wi-Fi, lyrics it has shown. Downloaded songs play, the rest is greyed out. Likes and plays from that time wait in the app and reach the server when it's back.
- **What goes online:** your server; for a player that's open, Genius for the song and MusicBrainz, Wikidata and Wikipedia for the artist; LRCLIB for lyrics your server doesn't have. Each is asked once and the answer stays on the phone. The devices page looks around your Wi-Fi only while it's open, and only what you send to a device goes there.

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
