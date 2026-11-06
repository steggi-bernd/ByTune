// A device on the network that takes its time (electron/device-player.ts, src/lib/deviceStart.ts): a
// receiver coming out of standby says yes to everything and forgets it on the way up. What counts is
// what it says afterwards: it gets the song again until it plays, from the same place, and after long
// enough it counts as not having started. Real HTTP against a stand-in device on this machine.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadFrom(relative) {
  const out = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const { StartWatch, START_PATIENCE_MS } = await loadFrom("../src/lib/deviceStart.ts");
const { upnpPlayer, EndWatch } = await loadFrom("../electron/device-player.ts");
const { Zone } = await loadFrom("../src/lib/zoneEngine.ts");

const tag = (xml, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];
const SERVICE = "urn:schemas-upnp-org:service:AVTransport:1";

/**
 * A renderer. `asleep`: it says yes to everything and nothing sticks. `away`: it doesn't answer at all.
 * `refuse`: the song itself is turned down with this code. `rewrites`: it reports another spelling of the address.
 */
async function device(t) {
  const d = { asleep: false, away: false, refuse: null, rewrites: false, state: "NO_MEDIA_PRESENT", uri: "", position: 0, heard: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (d.away) return req.socket.destroy();
      const action = /#(\w+)"/.exec(req.headers.soapaction ?? "")?.[1];
      d.heard.push(action);
      const answer = (inner) => {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(`<Envelope><Body><${action}Response>${inner}</${action}Response></Body></Envelope>`);
      };
      if (action === "SetAVTransportURI") {
        if (d.refuse) {
          res.writeHead(500, { "Content-Type": "text/xml" });
          return res.end(`<Envelope><errorCode>${d.refuse}</errorCode><errorDescription>Illegal MIME-Type</errorDescription></Envelope>`);
        }
        if (!d.asleep) {
          d.uri = tag(body, "CurrentURI");
          d.state = "STOPPED";
        }
      } else if (action === "Play") {
        if (!d.asleep && d.uri) d.state = "PLAYING";
      } else if (action === "Pause") {
        if (!d.asleep) d.state = "PAUSED_PLAYBACK";
      } else if (action === "Stop") {
        if (!d.asleep) d.state = "STOPPED";
      } else if (action === "Seek") {
        if (!d.asleep) d.position = Number(tag(body, "Target").split(":").reduce((n, p) => n * 60 + Number(p), 0));
        d.lastSeek = tag(body, "Target");
      } else if (action === "GetTransportInfo") {
        return answer(`<CurrentTransportState>${d.state}</CurrentTransportState>`);
      } else if (action === "GetPositionInfo") {
        const at = Math.floor(d.position);
        return answer(`<RelTime>0:${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}</RelTime><TrackDuration>0:03:20</TrackDuration><TrackURI>${d.rewrites && d.uri ? `${d.uri}&amp;by=device` : d.uri.replaceAll("&", "&amp;")}</TrackURI>`);
      }
      answer("");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/av`;
  d.renderer = { id: "uuid:r", name: "Receiver", model: "", location: url, avTransport: { url, type: SERVICE } };
  return d;
}

const SONG = { title: "A", artist: "B", album: "C", duration: 200, mime: "audio/flac" };
const URL_A = "http://192.168.1.2:9000/cast/abc/song.flac";

/** Time goes by when a test says so. */
function clock(t) {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  t.after(() => {
    Date.now = real;
  });
  return { pass: (ms) => (now += ms) };
}

async function until(check, what) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(check(), what);
}

test("the watch: silence gets the song again, less and less often; working on it gets longer; then it's over", () => {
  const w = new StartWatch();
  w.begin(0);
  assert.equal(w.see("stopped", 1000), "wait");
  assert.equal(w.see("stopped", 6000), "hand-again");
  assert.equal(w.see("stopped", 12000), "wait", "a slow one isn't kept from starting");
  assert.equal(w.see(null, 15000), "hand-again", "no answer counts the same");
  assert.equal(w.see("loading", 20000), "wait");
  assert.equal(w.see("loading", 34000), "wait", "it says it's working on it");
  assert.equal(w.see("loading", 36000), "hand-again");
  assert.equal(w.see("stopped", START_PATIENCE_MS), "failed");
  assert.equal(w.active, false);
  w.begin(100);
  assert.equal(w.see("playing", 200), "started");
  assert.equal(w.active, false);
  w.begin(100);
  w.cancel();
  assert.equal(w.see("stopped", 90_000), "started", "nobody waits any more");
});

test("a receiver waking up: yes to everything, then silence; it gets the song again and plays from the same place", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const player = upnpPlayer(d.renderer);
  d.asleep = true;
  await player.load(URL_A, SONG, 42, true);
  assert.equal(player.starting(), true, "having said yes means nothing yet");
  let st = await player.status();
  assert.equal(st.state, "TRANSITIONING");
  assert.equal(st.position, 42, "the place in the song stands");

  // Awake now, with nothing of what it was told.
  d.asleep = false;
  time.pass(3000);
  st = await player.status();
  assert.equal(st.state, "TRANSITIONING");
  assert.equal(d.state, "NO_MEDIA_PRESENT", "not yet");
  time.pass(4000);
  st = await player.status();
  assert.equal(st.state, "TRANSITIONING");
  await until(() => d.state === "PLAYING" && d.position === 42, "it gets the song again");
  assert.equal(d.uri, URL_A);

  st = await player.status();
  assert.equal(st.state, "PLAYING");
  assert.equal(st.position, 42);
  assert.equal(player.starting(), false);
});

test("a device that started without the place it was told gets it once it plays", async (t) => {
  const d = await device(t);
  clock(t);
  const player = upnpPlayer(d.renderer);
  await player.load(URL_A, SONG, 42, true);
  assert.equal(d.state, "PLAYING");
  // It refused the seek on the way up.
  d.position = 0;
  const st = await player.status();
  assert.equal(st.position, 42, "the screen stays where it was");
  await until(() => d.position === 42, "it is told again");
});

test("a device that doesn't answer yet: no error, and it starts as soon as it's there", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const player = upnpPlayer(d.renderer);
  d.away = true;
  await player.load(URL_A, SONG, 0, true);
  assert.equal((await player.status()).state, "TRANSITIONING", "a device that doesn't answer is no failure yet");
  d.away = false;
  time.pass(7000);
  await player.status();
  await until(() => d.state === "PLAYING", "it gets the song");
  assert.equal((await player.status()).state, "PLAYING");
});

test("after long enough it counts as not having started, said once", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const player = upnpPlayer(d.renderer);
  d.asleep = true;
  await player.load(URL_A, SONG, 42, true);
  time.pass(START_PATIENCE_MS + 1);
  const st = await player.status();
  assert.equal(st.notStarted, true);
  assert.equal(st.state, "STOPPED");
  assert.equal(player.starting(), false);
  assert.ok(!(await player.status()).notStarted, "once");
});

test("the song itself refused: at once, no waiting helps with that", async (t) => {
  const d = await device(t);
  const player = upnpPlayer(d.renderer);
  d.refuse = 714;
  await assert.rejects(player.load(URL_A, SONG, 0, true), /Illegal MIME-Type/);
  assert.equal(player.starting(), false);
});

test("paused while it wakes: it isn't handed the song any more; play starts the wait over", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const player = upnpPlayer(d.renderer);
  d.asleep = true;
  await player.load(URL_A, SONG, 10, true);
  await player.pause();
  assert.equal(player.starting(), false);
  d.heard.length = 0;
  time.pass(30_000);
  assert.equal((await player.status()).position, 10, "it has nothing to say about this song, and the place isn't lost");
  assert.deepEqual(d.heard.filter((a) => a === "SetAVTransportURI"), [], "somebody paused it");

  d.asleep = false;
  await player.play();
  assert.equal(player.starting(), true);
  time.pass(7000);
  await player.status();
  await until(() => d.state === "PLAYING" && d.position === 10, "from where it was");
});

test("once it has played, what it says about its place counts, also paused, and it goes on from there", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const player = upnpPlayer(d.renderer);
  await player.load(URL_A, SONG, 10, true);
  assert.equal((await player.status()).state, "PLAYING");
  d.position = 60;
  await player.status();
  await player.pause();
  d.position = 61;
  assert.equal((await player.status()).position, 61);

  // Gone to standby while paused, and it forgot: from the place it had reached.
  d.state = "NO_MEDIA_PRESENT";
  d.uri = "";
  await player.play();
  d.state = "NO_MEDIA_PRESENT";
  time.pass(7000);
  await player.status();
  await until(() => d.state === "PLAYING" && d.position === 60, "it gets the song again");
});

test("moved while it wakes: the new place is where it starts", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const player = upnpPlayer(d.renderer);
  d.asleep = true;
  await player.load(URL_A, SONG, 10, true);
  await player.seek(77);
  d.asleep = false;
  time.pass(7000);
  await player.status();
  await until(() => d.state === "PLAYING" && d.position === 77, "the new place");
  assert.equal((await player.status()).position, 77);
});

test("a device that spells the address its own way isn't handed the song over and over", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const player = upnpPlayer(d.renderer);
  d.rewrites = true;
  await player.load(URL_A, SONG, 0, true);
  assert.equal(d.state, "PLAYING");
  assert.equal((await player.status()).state, "TRANSITIONING", "it could still be the song before");
  time.pass(8000);
  let st = await player.status();
  assert.equal(st.state, "PLAYING", "after a while, that's the song");
  assert.equal(st.uri, URL_A, "under the address it was given, for those who go by that");
  assert.equal(d.heard.filter((a) => a === "SetAVTransportURI").length, 1);
  assert.equal(player.starting(), false);
  d.position = 20;
  st = await player.status();
  assert.equal(st.uri, URL_A);
  assert.equal(st.position, 20, "and what it says from now on counts");
});

test("a song near its end doesn't count as played out while the device is still on its way", async (t) => {
  const d = await device(t);
  clock(t);
  const player = upnpPlayer(d.renderer);
  d.asleep = true;
  const watch = new EndWatch();
  watch.begin(198);
  await player.load(URL_A, SONG, 198, true);
  const seen = watch.see(await player.status(), 200);
  assert.equal(seen.ended, false);
  assert.equal(seen.state, "loading");
});

/* ------------------------------------------------------------ a zone on such a device */

const songs = ["a", "b"].map((id) => ({ id, title: id, artist: "", album: "", duration: 100 }));

function driverOn(player) {
  return {
    load: (song, position, play) => player.load(`http://192.168.1.2/${song.id}`, { ...SONG, ...song }, position, play),
    play: () => player.play(),
    pause: () => player.pause(),
    stop: () => player.stop(),
    seek: (sec) => player.seek(sec),
    starting: () => player.starting(),
    async status() {
      const at = await player.status();
      const state = at.state === "PLAYING" ? "playing" : at.state === "TRANSITIONING" ? "loading" : at.state === "PAUSED_PLAYBACK" ? "paused" : "stopped";
      return { state, position: at.position, duration: at.duration, ended: false, notStarted: at.notStarted };
    },
    setVolume: async () => undefined,
    getVolume: async () => 0.3,
    close: () => undefined,
  };
}

test("a zone on a device that wakes: waiting says waiting, then it plays", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const zone = new Zone([{ deviceId: "r", name: "Receiver", driver: driverOn(upnpPlayer(d.renderer)), volume: null }], () => undefined);
  d.asleep = true;
  await zone.play(songs, 0, 12);
  assert.equal(zone.state.state, "loading", "not playing yet, whatever it said");
  await zone.tick();
  assert.equal(zone.state.state, "loading");
  assert.equal(zone.state.position, 12);
  d.asleep = false;
  time.pass(7000);
  await zone.tick();
  await until(() => d.state === "PLAYING", "it gets the song again");
  await zone.tick();
  assert.equal(zone.state.state, "playing");
  await until(() => zone.members[0].volume === 0.3, "and now it can tell its volume");
});

test("a zone on a device that never starts says so and lets it go", async (t) => {
  const d = await device(t);
  const time = clock(t);
  const zone = new Zone([{ deviceId: "r", name: "Receiver", driver: driverOn(upnpPlayer(d.renderer)), volume: null }], () => undefined);
  d.asleep = true;
  await zone.play(songs, 0, 12);
  time.pass(START_PATIENCE_MS + 1);
  await zone.tick();
  assert.equal(zone.state.state, "stopped");
  assert.match(zone.state.error, /Receiver didn't start/);
  assert.equal(zone.members.length, 0);
});

test("in a group the one still waking is looked after too, and goes if it never starts; the others play on", async (t) => {
  const first = await device(t);
  const second = await device(t);
  const time = clock(t);
  const zone = new Zone(
    [
      { deviceId: "one", name: "One", driver: driverOn(upnpPlayer(first.renderer)), volume: null },
      { deviceId: "two", name: "Two", driver: driverOn(upnpPlayer(second.renderer)), volume: null },
    ],
    () => undefined
  );
  second.asleep = true;
  await zone.play(songs, 0, 5);
  await zone.tick();
  assert.equal(zone.state.state, "playing", "the first one goes ahead");
  second.asleep = false;
  time.pass(7000);
  await zone.tick();
  await until(() => second.state === "PLAYING", "the second one gets the song again");

  second.asleep = true;
  second.state = "STOPPED";
  await zone.members[1].driver.load(songs[0], 5, true);
  time.pass(START_PATIENCE_MS + 1);
  await zone.tick();
  await until(() => zone.members.length === 1, "it goes");
  assert.equal(zone.members[0].deviceId, "one");
  assert.match(zone.state.error, /Two didn't start/);
  assert.equal(zone.state.state, "playing");
});

test("the last song played out says so: the phone's queue may go on from there", async () => {
  const quiet = { load: async () => undefined, play: async () => undefined, pause: async () => undefined, stop: async () => undefined, seek: async () => undefined, status: async () => ({ state: "stopped", position: 0, duration: 100, ended: true }), setVolume: async () => undefined, getVolume: async () => null, close: () => undefined };
  const zone = new Zone([{ deviceId: "r", name: "R", driver: quiet, volume: null }], () => undefined);
  await zone.play(songs, 1);
  assert.ok(!zone.state.ranOut);
  await zone.tick();
  assert.equal(zone.state.ranOut, true);
  zone.setRepeat("off");
  await zone.jump(0);
  assert.equal(zone.state.ranOut, false);
});
