<p align="center">
  <img src="build/icon.png" width="88" height="88" alt="Songsta logo">
</p>

<h1 align="center">Songsta</h1>

<p align="center">
  <b>A music player for the music you own — on Windows, Linux and your Android phone, kept the same everywhere by a small service on your own server.</b><br>
  Local folders, Jellyfin and Navidrome in one library — Hi-Res playback, synced lyrics and a home page built from your own listening. No account, no ads.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#features">Features</a> ·
  <a href="#on-your-phone">Phone app</a> ·
  <a href="#the-same-on-all-your-devices">Sync</a> ·
  <a href="#your-devices-in-one-place">Devices</a> ·
  <a href="#spotify-import">Spotify import</a> ·
  <a href="#discord-status-optional">Discord</a> ·
  <a href="#build-from-source">Build</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#credits-and-license">License</a>
</p>

<p align="center">
  <a href="https://github.com/steggi-bernd/Songsta/releases/latest"><img src="https://img.shields.io/github/v/release/steggi-bernd/Songsta?label=release&color=7c5cd6" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011%20%C2%B7%20Linux%20%C2%B7%20Android-1f6f5c" alt="Platform: Windows 10/11 · Linux · Android">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-a8324a" alt="License: GPL-3.0"></a>
</p>

![Songsta: an album page with its track list; the library panel with two pinned rows over what played last; the right panel with what's next and the song's tempo and key; the player bar showing Hi-Res · FLAC 24-bit / 96 kHz](docs/screenshots/local/album.jpg)

Songsta is a fork of [ByTune](https://github.com/rishiteja21/ByTune), the open-source YouTube Music desktop app, rebuilt into a player for your own collection. YouTube and the account screens are gone: the app opens in your library, plays from your disk first and streams from your own server only when a file isn't there.

Songsta comes in three parts. The desktop app stands on its own; the other two build on your Jellyfin server.

| | What it's for | What it needs |
|---|---|---|
| **Desktop app** (Windows, Linux) | Your whole library, from local folders and servers, and everything under [Features](#features) | Nothing |
| **[Android app](#on-your-phone)** | Your server's music and folders on your phone, downloads for when there's no connection, and steering the speakers at home | A Jellyfin server, folders on the phone, or both |
| **[Sync service](#the-same-on-all-your-devices)** | Playlists, where you stopped, muted songs and the order of Liked Songs the same everywhere, and devices that see and steer each other | Docker next to Jellyfin |

All three are on the [Releases page](https://github.com/steggi-bernd/Songsta/releases/latest); [Install](#install) says how to set each of them up.

> [!NOTE]
> The screenshots show a **made-up demo library** — artists, songs, covers and lyrics were invented for this page. The app around them is the real build.

## Features

### One library, every source

- **Local folders**, watched while the app runs: new, changed and deleted files show up without a rescan.
- **Jellyfin** (user name and password, or an API key) and **Navidrome or any Subsonic server**. Streams pass through a local proxy, so plain-http servers on your network work too.
- **Duplicates become one song.** A song you have as a local FLAC and on your server is listed once, with its plays added up. It plays from the local file and streams only when that file can't be reached.
- **Unreachable songs are greyed out** — an unplugged drive, a server that doesn't answer — and come back by themselves.
- **Missing facts come from open databases**: covers and album names from MusicBrainz and the Cover Art Archive (iTunes Search as a fallback), artist bios and photos from Wikidata, Wikipedia and Wikimedia Commons. Your files are never rewritten.
- Credits like "Artist A, Artist B" count as two artists, each with their own page.
- **Library check** (Settings): artists written different ways, albums split into parts, songs you have twice, albums without a cover, year or genre, and songs without an album — with a fix wherever Songsta can make one itself.

### Made for good files

- **See what you hear:** the player bar shows *Hi-Res*, *Lossless* or *Lossy* with the codec and the bit depth and sample rate (or bit rate) of what actually plays.
- Plays MP3, AAC, FLAC up to 24-bit/192 kHz, WAV, Ogg Vorbis and Opus directly. AIFF, ALAC, WMA, WavPack, APE and DSD play through [FFmpeg](https://ffmpeg.org/), converted once into a cached 24-bit FLAC with full seeking.
- **Volume leveling** from ReplayGain tags, per song or per album, towards −18, −14 or −11 LUFS. It only ever turns loud songs down.
- **Equalizer:** ten bands, or a parametric EQ with [AutoEQ](https://github.com/jaakkopasanen/AutoEq) corrections for about 9,000 headphones, Equalizer APO import and the frequency response drawn live.
- Crossfade, Automix, skip silence, playback speed, and a volume slider that is actually quiet at the bottom.
- **Sound analysis:** tempo, key and energy of every local song, measured once in the background with FFmpeg. They show in the song's details, Automix times its fades to the beat with them, and they make the *Calm* and *Upbeat* mixes.
- **Seamless albums:** live albums, DJ mixes and songs that run into each other play on without a gap or a crossfade.

### Your music, arranged like a streaming app

![Home: quick-access tiles, Made for you mixes — On Repeat, Rediscover, Calm, Upbeat and one per genre — and recently added albums](docs/screenshots/local/home.jpg)

- **Home**, built only from your library: quick-access tiles, *Made for you* mixes (On Repeat, Rediscover, what you usually play at this time of day, Calm and Upbeat, one per big genre and decade, reshuffled daily), recently added albums, your top artists and recently played songs.
- **Album and artist pages** with play and shuffle, popular songs ranked by your own plays, the artist's songs you've liked, albums, singles & EPs, "appears on" and the Wikipedia bio.
- **Discography tab:** every release with its songs, newest first.
- **Smart playlists** that fill themselves from rules — genre, artist, year, date added, plays, last played, length, format, sample rate, bit depth, source, liked — with an order and an optional limit.
- **The library panel** puts what you played last on top. Pinned playlists and albums stay above it, in the order you drag them into; the panel folds down to an icon rail (<kbd>Ctrl</kbd>+<kbd>B</kbd>).
- **The right panel** shows the playing song — its title opens the album, its artists their pages — what plays next (drag songs in), the song's story and credits from Genius with its tempo and key, and the artist.

![An artist's page: popular songs ranked by your own plays, and the songs of theirs you've liked as a small playlist](docs/screenshots/local/artist.jpg)

### Fix albums without touching your files

![The album editor: the album's artists as chips, and a split "Bonus Tracks" album offered for merging](docs/screenshots/local/album-editor.jpg)

Tags aren't always right. The album editor — the pencil on an album page, or right-click an album in the library panel — lets you

- **add or remove artists** on an album, with one click back to what the tags say, and
- **merge albums** that show up as several (a "Disc 2", bonus tracks, one song with a different album artist), and separate them again.

Songs whose tags name no album gather under **Songs without an album** in the library panel. *Make an album…* puts them on one — title, artist, year and order — or on an album you already have.

![Make an album: three songs without an album tag, with the album's title taken from their folder, the artist, a year and the order](docs/screenshots/local/make-album.jpg)

Songsta keeps these edits itself; your files and servers stay exactly as they are.

### Lyrics and Now Playing

![Full-screen Now Playing: the cover on the left, synced lyrics on the right](docs/screenshots/local/now-playing.jpg)

- **Synced lyrics, your own first:** a `.lrc` next to the file, lyrics embedded in the tags, or your Jellyfin server's. Otherwise online providers such as LRCLIB and KuGou; answers are cached on disk.
- **Search by lyrics:** a line you remember finds the song, among the lyrics already on this computer.
- **Full-screen Now Playing** (<kbd>N</kbd>) with cover, lyrics and queue, tinted by the cover's colors.
- **Mini player:** an always-on-top picture-in-picture window.
- **A real queue:** drag to reorder. *Add to queue* puts a song behind everything you asked for before it, first come, first played, in an area of its own above the rest of the list; if it's further down the list already, it comes up from there. A branch goes there too, as a block with the list's name: long ones fold, and its cross takes the whole branch back. A song you have in several places still plays only once.
- **Shuffle that goes one way:** it mixes what's coming, so the list you see is what plays, and *Previous* goes back to the song you really heard.
- **Branch off:** a song next, the rest of its list behind it. A small mark shows which song you chose until it comes on, and the same action on that song takes it back.
- **Replay:** your listening over time — top artists and songs, hours listened, monthly and hourly patterns.

### In your language

The computer and the phone speak English and German, following your system unless you choose under *Settings → Appearance*. Another language is one more file in `src/locales`, with the English text as the key.

## Spotify import

![Spotify import: 14 songs in your library, 3 to check with Same song / Different / Choose…, 5 missing](docs/screenshots/local/spotify-import.jpg)

Coming from Spotify? Export your Liked Songs with [Exportify](https://github.com/watsonbox/exportify) (CSV) or take `YourLibrary.json` from Spotify's own data download, then open **Import from Spotify** in Liked Songs or Settings. Songsta sorts every song into three lists:

- **In your library** — songs you already have. *Add to Liked Songs* adds them in Spotify's order, newest first. After buying more, add again: new songs land in their place, and songs you liked only in Songsta stay on top.
- **To check** — the title, length or artist spelling differs. Answer *Same song* or *Different*, or *Choose…* the right song from your library yourself. Decided songs leave the list; *Your decisions* can undo them.
- **Missing — to buy** — your shopping list, to save as a spreadsheet or copy.

The import and your decisions are kept until you start over, so they survive restarts.

**Playlists** come over the same way: **+ → Recover a Spotify playlist** in the library panel, or the button in an empty playlist. Use the playlist's CSV from Exportify, or `Playlist1.json` from the data download — it holds all your playlists, and you pick one. The songs you have go into a Songsta playlist in Spotify's order, and your *Same song* / *Different* answers carry over.

## Discord status (optional)

Show what you're listening to on Discord: title, artist and a progress bar, as *Listening to …*. It is off until you switch it on, because Discord wants an application of your own — free, and done in a minute:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), choose **New Application** and name it, for example *Songsta* — Discord shows this name.
2. Copy the **Application ID** from *General Information*.
3. In Songsta, open **Settings → Discord**, switch on *Discord status* and paste the ID.

The Discord desktop app has to be running; Songsta connects as soon as it starts and clears the status when you pause. Only the Discord app on your computer receives the title and artist — no covers.

## On your phone

![The phone app: Home with your mixes, the player with its quality in gold, and the devices with a group of speakers and a second room playing something else](docs/screenshots/phone/phone.jpg)

The Android app plays the music on your Jellyfin server and in folders you pick on the phone, laid out like the desktop app: Home with your mixes, Search with *Explore your library*, Your Library, album, artist and playlist pages. The player opens from a mini player, you swipe between songs, and the lock screen, notification and headset buttons work. [Install](#android) says how to get it.

- **Away from home:** give your server a second address, a tunnel or proxy, in the app's settings. The app takes the direct way at home and the other one anywhere else, and a song under way goes on from there.
- **The player:** the name of what's playing leads to its album, the artist to the artist, "Playing from" back to where it started. Under it lie the lyrics, what comes next, and about the song and the artist, as in the desktop app's side panel.
- **Your own files:** pick one or more folders in Settings, as on the computer. Their songs join the library, a song your server has too stays one song and plays from the file, and without a server the app works from the folders alone.
- **Swipes:** pull a song right in any list: let go quickly and it joins the queue, behind everything you asked for before it; hold it a moment and it branches off, with the rest of its list behind it. A small mark shows which song you chose, and pulling that song again takes the branch back. Pull a song left to mute it. In the queue a pull to the right or the small cross takes a song out, and in Your Library a pull to the right pins a playlist, album, mix or artist on top. Settings has two feels for this.
- **Settings:** streaming quality, fades between songs, skip silence, playback speed, autoplay, volume leveling, a ten-band equalizer, lyrics, accent colour, reduced animation and more.
- **Devices:** the speaker in the mini player or the player opens them, see [below](#your-devices-in-one-place).
- **Downloads:** the arrow in the player, the ⋮ on a song, or the arrow on an album or playlist, with each song's progress on its row. The app fetches them, also with the screen off, as the file itself or as a 192 kbps MP3; over mobile data only if you allow it.
- **Without a connection** the app opens from what it remembers: the library, playlists, covers and the lyrics it has shown. Downloaded songs play, the rest is greyed out.
- **Quality:** the player shows what really plays, gold for lossless and down to red for a small copy; tap it to choose. *Original* plays the file itself, *Compact* a 128 kbps copy, *Automatic* the best the connection carries, over mobile data up to AAC 256 kbps.

The app is young and has run in an emulator far more than on real phones. [mobile/README.md](mobile/README.md) has more on all of this, and how to build it yourself.

## The same on all your devices

Which songs you like and how often they played go through your server's own favorites and play counts (**Settings → Server sync**). Playlists, where you stopped and the order of Liked Songs need a small [sync service](sync-server/README.md) next to Jellyfin: a Docker container without any music in it, signed in to with your Jellyfin login ([how to set it up](#sync-service)). With it running, a playlist made on one device arrives on the others within moments, the phone lists Liked Songs in the order you have them on the computer, and muted songs stay muted everywhere.

There is one stream, like Spotify Connect: a device that isn't playing shows what another one plays and steers it, itself silent. Pause on the phone and the computer pauses; start a song or change the volume there and the computer does that, and the computer can steer a phone in your pocket the same way. *This phone* or *This computer* under Devices brings the music over: it stops there and goes on here. Only when you choose *Start a second stream* on that same tile does each device go its own way, with its own songs, until you end it. With no device playing, one picks up where another stopped, paused until you press play.

## Your devices in one place

![The devices in the side panel: this computer, a phone with Songsta on it, a speaker playing the app's music and another one with a song of its own](docs/screenshots/local/devices.jpg)

The speaker button next to the volume on the computer, and in the mini player or the player on the phone, opens a small smart-home room for everything that can make sound:

- **One press moves the music:** to this device and its outputs (Bluetooth speakers, headphones), to your other computers and phones with Songsta on them, or to anything on your network that plays by itself: receivers and network speakers over UPnP/DLNA, Chromecast, Google TV and Nest speakers over Cast. It goes on from the same place in the song.
- **Several at once:** the plus lets another device play along, each with its own volume. Or hold a tile on the phone, right-click one on the computer, and choose as many as you like; on the phone this device can be one of them.
- **Different music per device:** a device's menu lets you choose music for it, on the phone right there from your playlists, albums and songs, and a song's own menu has *Play on*. It gets its own queue and controls, while your own music goes on. On the phone it keeps running with the screen off, with a notification to steer it.
- **Rename** anything. On the phone a device that doesn't announce itself can be added by its address.

A group of separate devices isn't sample-exact: each one fetches and buffers by itself, which you can hear between two speakers in one room. A Cast group made in Google's own app is exact, and shows up here as one device. Amazon lets no app send music to an Echo or Fire TV directly, so those are listed with how to pair them over Bluetooth. A song that's only in a folder on the phone can't go to a device on the network, which fetches its songs from your server.

## Muting songs

Pull a song left on the phone, or choose *Mute song* in its menu on either app, and it's greyed out with a red name and skipped in every album, playlist and shuffle. It plays only when you ask for it by name, tap it or put it in the queue. The same way unmutes it.

## Install

### Windows and Linux

**Windows 10 / 11 (64-bit).** Get `Songsta-Setup.exe` from the [Releases page](https://github.com/steggi-bernd/Songsta/releases) or [build it yourself](#build-from-source). The installer isn't code-signed, so SmartScreen asks once: *More info → Run anyway*.

- It installs as **Songsta** and replaces an older ByTune Local (the app's name until November 2026; `com.bytune.local` stays its app id for that). It never replaces an installed original ByTune or shares its data.
- Your data lives in `%APPDATA%\Songsta`; an older `ByTune Local` folder moves there at the first start. **Settings → Your data** exports and imports backups.
- For AIFF, ALAC, WMA, WavPack, APE and DSD, install FFmpeg (`winget install ffmpeg`); Settings shows whether it was found.

**Linux (64-bit).** The Releases page has two packages. The **.deb** is for Debian, Ubuntu, Linux Mint, Pop!_OS and their relatives; it puts Songsta in the app menu and installs FFmpeg along with it:

```bash
sudo apt install ./Songsta-amd64.deb
```

The **AppImage** runs on any other distribution — one file, nothing to install:

```bash
chmod +x Songsta-x86_64.AppImage
./Songsta-x86_64.AppImage
```

- AppImages need FUSE 2: `libfuse2t64` on Ubuntu 24.04 and later (`libfuse2` before), `fuse-libs` on Fedora, `fuse2` on Arch. If one stops at start with a message about the "SUID sandbox helper", your system restricts the sandbox Chromium uses (Ubuntu does since 23.10) — take the .deb there, which sets up the AppArmor profile Ubuntu asks for.
- Your data lives in `~/.config/Songsta`. Without the .deb, install FFmpeg with your package manager (`sudo apt install ffmpeg`, `sudo pacman -S ffmpeg`, …).
- Server sign-ins are sealed by your desktop's keyring (GNOME Keyring, KWallet). Without one, Songsta keeps them unencrypted in its data folder.
- Media keys and the desktop's media controls work through MPRIS. Under Wayland the mini player can't stay on top of other windows; Wayland doesn't let apps do that.

The Linux packages are built by GitHub Actions for every release; this edition is developed and tested on Windows. The macOS build targets from upstream are still in the project, but untested.

### Android

For Android 7 or newer on a 64-bit phone, which is nearly all of them. Get `Songsta.apk` from the [Releases page](https://github.com/steggi-bernd/Songsta/releases/latest) and open it on the phone; Android asks once whether your browser may install apps. At the first start, enter your Jellyfin server's address and your login. A new version installs over the old one the same way.

- The app isn't on a store. Google Play Protect may ask whether you trust it: *More details → Install anyway*.
- It's signed with the standard development key, not one of its own. That's fine for your own phone, but should a later version get a real key, it needs one fresh install.
- At the first start, enter your server or choose *No server* and pick a folder; either can be added later in Settings. Navidrome is the desktop app's only.

### Sync service

On the machine with your Jellyfin container, from `songsta-sync.zip` on the [Releases page](https://github.com/steggi-bernd/Songsta/releases/latest) or the [`sync-server`](sync-server) folder here:

```bash
JELLYFIN_NETWORK=<network Jellyfin is on> DATA_PATH=/path/for/its/data docker compose up -d --build
```

The apps then find it by themselves on your Jellyfin server's host, port 8196, and sign in with your Jellyfin login. [sync-server/README.md](sync-server/README.md) has the settings and how to reach it from outside your home.

## Build from source

You need [Node.js](https://nodejs.org/) (LTS) and Git.

```bash
git clone https://github.com/steggi-bernd/Songsta.git
cd Songsta
npm install
npm run dev        # Vite + Electron with hot reload
```

```bash
npm test           # unit tests (Node's test runner)
npm run typecheck  # tsc --noEmit
npm run dist:win   # installer: release/Songsta-Setup.exe
npm run dist:linux # on Linux: release/Songsta-x86_64.AppImage and -amd64.deb
```

The phone app has its own instructions in [mobile/README.md](mobile/README.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for the project's conventions.

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Play / pause | <kbd>Space</kbd> · media keys |
| Seek ±5 s | <kbd>←</kbd> / <kbd>→</kbd> |
| Previous / next song | <kbd>Shift</kbd>+<kbd>←</kbd> / <kbd>Shift</kbd>+<kbd>→</kbd> |
| Volume · mute | <kbd>↑</kbd> / <kbd>↓</kbd> · <kbd>M</kbd> |
| Shuffle · repeat | <kbd>S</kbd> · <kbd>R</kbd> |
| Queue · lyrics · Now Playing | <kbd>Q</kbd> · <kbd>L</kbd> · <kbd>N</kbd> |
| Search | <kbd>Ctrl</kbd>+<kbd>F</kbd> or <kbd>/</kbd> |
| Fold the library panel | <kbd>Ctrl</kbd>+<kbd>B</kbd> |
| Back / forward | the mouse's back and forward buttons |

Shortcuts never fire while you're typing in a text field.

## Privacy

- **No account, no sign-in, no ads, no analytics.** Your library, likes, playlists and listening history stay on your own devices, and on your own server if you run the sync service.
- **Passwords aren't stored:** Jellyfin keeps a session token (or your API key), Navidrome a salt/token pair — sealed by Windows (on Linux, your desktop's keyring) through Electron's safeStorage.
- **What goes online:** your own servers; the devices on your own network, which fetch songs from your server or this computer themselves; the open-database lookups above, paced to MusicBrainz's one request per second and cached; lyrics providers for songs without lyrics of their own, on the phone LRCLIB; Genius for what's known about a song; the AutoEQ index when you search for headphones; and, only if you switch it on, the animated canvas behind the player (a community index and TIDAL's public search).
- **Discord status** talks to the Discord app on your computer, not to the internet.

## Credits and license

Songsta is a fork of [ByTune](https://github.com/rishiteja21/ByTune) by [rishiteja21](https://github.com/rishiteja21), which began as a desktop port of the BitChord Android player. Like both, it is licensed under the **GNU GPL v3** — see [LICENSE](LICENSE). Thanks to everyone who built them in the open.

Built with Electron, React, TypeScript, Tailwind CSS, Zustand and music-metadata, the phone app with Expo, React Native and Media3. Songsta is not affiliated with Spotify, Discord, Jellyfin or Navidrome.
