/**
 * Songsta's sync service: a small store next to Jellyfin for what Jellyfin has
 * no place for, the playlists and where playback stopped. It knows nothing
 * about music. Documents go in and come out with a revision number; merging
 * is the apps' job (src/lib/syncEngine.ts).
 *
 * A login here is a Jellyfin login: the header a client sends to Jellyfin is
 * asked of Jellyfin, and each Jellyfin user has their own documents. An API
 * key belongs to no user, so it names the user it acts for (X-Songsta-User).
 *
 *   GET  /health
 *   GET  /v1/docs/:name           { rev, updatedAt, doc }   (rev 0: nothing yet)
 *   PUT  /v1/docs/:name           { rev?, doc } → { rev, seq, updatedAt }, 409 when rev is behind
 *   GET  /v1/changes?since&wait   { seq, revs }: answers at once when seq differs, else within `wait` seconds
 */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** `merged` documents are built on a revision and a write must say which; the rest is last writer wins. */
const DOCS = {
  playlists: { merged: true, keepVersions: 20 },
  queue: {},
  position: {},
  likes: {},
};
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const IDENTITY_TTL_MS = 5 * 60_000;
const MAX_WAIT_SEC = 30;
const JELLYFIN_TIMEOUT_MS = 10_000;

const USER_ID = /^[a-f0-9]{32}$/;
const normalizeId = (id) => String(id ?? "").replace(/-/g, "").toLowerCase();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      // What's left is read and dropped, so the sender gets to hear the answer.
      if (size > MAX_BODY_BYTES) {
        chunks = [];
        return reject(new HttpError(413, "Too large"));
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Not JSON"));
      }
    });
  });
}

/** Whole or not at all: a crash in the middle leaves the last good file. */
async function writeAtomic(file, value) {
  const temp = `${file}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
}

export function createSyncServer({ dataDir, jellyfinUrl }) {
  const jellyfin = String(jellyfinUrl).replace(/\/+$/, "");
  /** sha256 of the login → who it is; the login itself is never kept. */
  const identities = new Map();
  /** user id → their documents, in memory after the first read */
  const users = new Map();

  async function askJellyfin(pathname, authorization) {
    try {
      return await fetch(`${jellyfin}${pathname}`, {
        headers: { Authorization: authorization, Accept: "application/json" },
        signal: AbortSignal.timeout(JELLYFIN_TIMEOUT_MS),
      });
    } catch {
      // Jellyfin being away says nothing about the login: the app keeps its data and tries again.
      throw new HttpError(503, "Jellyfin does not answer");
    }
  }

  async function identify(authorization) {
    const key = createHash("sha256").update(authorization).digest("hex");
    const known = identities.get(key);
    if (known && known.until > Date.now()) return known;

    const me = await askJellyfin("/Users/Me", authorization);
    if (me.status >= 500 && me.status !== 500) throw new HttpError(503, "Jellyfin does not answer");
    if (me.status === 401) throw new HttpError(401, "Jellyfin rejected this login");
    let who = null;
    if (me.ok) {
      const id = normalizeId((await me.json())?.Id);
      if (USER_ID.test(id)) who = { userId: id };
    } else {
      // No user behind the login: an API key may still see the server's users.
      const list = await askJellyfin("/Users", authorization);
      if (list.ok) {
        const all = await list.json();
        who = { allowed: new Set((Array.isArray(all) ? all : []).map((u) => normalizeId(u?.Id)).filter((id) => USER_ID.test(id))) };
      }
    }
    if (!who) throw new HttpError(401, "Jellyfin rejected this login");
    who.until = Date.now() + IDENTITY_TTL_MS;
    identities.set(key, who);
    return who;
  }

  async function authenticate(req) {
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || authorization.length > 2048 || !/Token="[^"]+"/.test(authorization)) {
      throw new HttpError(401, "No login");
    }
    const who = await identify(authorization);
    if (who.userId) return who.userId;
    const claimed = normalizeId(req.headers["x-songsta-user"]);
    if (!claimed) throw new HttpError(400, "An API key must name a user");
    if (!who.allowed.has(claimed)) throw new HttpError(403, "No such user on this server");
    return claimed;
  }

  function userState(userId) {
    let user = users.get(userId);
    if (!user) {
      user = (async () => {
        const dir = path.join(dataDir, "users", userId);
        await mkdir(dir, { recursive: true });
        const docs = {};
        let seq = 0;
        for (const name of Object.keys(DOCS)) {
          try {
            const stored = JSON.parse(await readFile(path.join(dir, `${name}.json`), "utf8"));
            docs[name] = stored;
            seq = Math.max(seq, stored.seq ?? 0);
          } catch (err) {
            if (err.code !== "ENOENT") console.error(`[sync] unreadable ${name} of ${userId}:`, err.message);
          }
        }
        return { dir, docs, seq, waiters: new Set(), writing: Promise.resolve() };
      })();
      users.set(userId, user);
    }
    return user;
  }

  /** The version being replaced stays for a while: the apps merge, and a bug there must not cost anyone a playlist. */
  async function keepVersion(user, name, current, keep) {
    const dir = path.join(user.dir, "versions");
    await mkdir(dir, { recursive: true });
    await writeAtomic(path.join(dir, `${name}.${current.rev}.json`), current);
    const prefix = `${name}.`;
    const revOf = (file) => Number(file.slice(prefix.length, -".json".length));
    const old = (await readdir(dir))
      .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
      .sort((a, b) => revOf(b) - revOf(a))
      .slice(keep);
    await Promise.all(old.map((file) => rm(path.join(dir, file), { force: true })));
  }

  /** One write at a time per user, so a revision check and its write can't be overtaken. */
  function write(user, name, expected, doc) {
    const run = user.writing.then(async () => {
      const spec = DOCS[name];
      const current = user.docs[name];
      const rev = current?.rev ?? 0;
      if (spec.merged && expected !== rev) return { conflict: true, current: current ?? { rev: 0, updatedAt: 0, doc: null } };
      const next = { rev: rev + 1, seq: user.seq + 1, updatedAt: Date.now(), doc };
      if (spec.keepVersions && current) await keepVersion(user, name, current, spec.keepVersions);
      await writeAtomic(path.join(user.dir, `${name}.json`), next);
      user.docs[name] = next;
      user.seq = next.seq;
      for (const wake of [...user.waiters]) wake();
      return { next };
    });
    // A failed write fails its own request, not the ones behind it.
    user.writing = run.catch(() => undefined);
    return run;
  }

  const summary = (user) => ({
    seq: user.seq,
    revs: Object.fromEntries(Object.keys(DOCS).map((name) => [name, user.docs[name]?.rev ?? 0])),
  });

  function changes(res, user, since, waitSec) {
    if (user.seq !== since || waitSec <= 0) return send(res, 200, summary(user));
    let timer = null;
    const finish = () => {
      clearTimeout(timer);
      user.waiters.delete(wake);
    };
    const wake = () => {
      finish();
      if (!res.writableEnded && !res.destroyed) send(res, 200, summary(user));
    };
    timer = setTimeout(wake, waitSec * 1000);
    user.waiters.add(wake);
    res.on("close", finish);
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://service");
    // Behind a proxy or tunnel it shares Jellyfin's name, under this path.
    const pathname = url.pathname.replace(/^\/songsta-sync(?=\/)/, "");
    if (req.method === "GET" && pathname === "/health") {
      return send(res, 200, { ok: true, service: "songsta-sync", api: 1 });
    }

    const docMatch = /^\/v1\/docs\/([a-z]+)$/.exec(pathname);
    if (pathname !== "/v1/changes" && !docMatch) throw new HttpError(404, "Not found");
    if (docMatch && !Object.hasOwn(DOCS, docMatch[1])) throw new HttpError(404, "No such document");

    const user = await userState(await authenticate(req));

    if (pathname === "/v1/changes") {
      if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
      const since = Number(url.searchParams.get("since"));
      const wait = Math.min(MAX_WAIT_SEC, Math.max(0, Number(url.searchParams.get("wait")) || 0));
      return changes(res, user, Number.isSafeInteger(since) ? since : -1, wait);
    }

    const name = docMatch[1];
    if (req.method === "GET") {
      const stored = user.docs[name];
      return send(res, 200, stored ? { rev: stored.rev, updatedAt: stored.updatedAt, doc: stored.doc } : { rev: 0, updatedAt: 0, doc: null });
    }
    if (req.method !== "PUT") throw new HttpError(405, "Method not allowed");
    const body = await readBody(req);
    if (!body || typeof body !== "object" || !body.doc || typeof body.doc !== "object" || Array.isArray(body.doc)) {
      throw new HttpError(400, "A document is an object");
    }
    const result = await write(user, name, body.rev, body.doc);
    if (result.conflict) {
      const { rev, updatedAt, doc } = result.current;
      return send(res, 409, { rev, updatedAt, doc });
    }
    return send(res, 200, { rev: result.next.rev, seq: result.next.seq, updatedAt: result.next.updatedAt });
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!(err instanceof HttpError)) console.error("[sync] request failed:", err);
      if (res.headersSent) return res.destroy();
      send(res, err instanceof HttpError ? err.status : 500, { error: err instanceof HttpError ? err.message : "Something went wrong" });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8196);
  const server = createSyncServer({
    dataDir: process.env.DATA_DIR || "./data",
    jellyfinUrl: process.env.JELLYFIN_URL || "http://jellyfin:8096",
  });
  server.listen(port, () => console.log(`[sync] listening on ${port}`));
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      // Long polls would hold the door open; everything on disk is already whole.
      server.closeAllConnections();
    });
  }
}
