/**
 * Import from Spotify: read a Liked Songs export, see which songs are already
 * in the library, add those to Liked Songs in Spotify's order, and keep a
 * list of the rest to buy.
 *
 * The matching (lib/spotifyImport.ts) runs live on the catalogue: buy a song,
 * add it to a folder or to Jellyfin, and it moves from "Missing" to "In your
 * library" on its own. Uncertain matches wait for the user's word: "Same
 * song" makes them a match, "Different" puts them on the shopping list, and
 * "Choose…" (or "I have it…" on a missing song) picks the library song by
 * hand. Decided songs leave the check list; "Your decisions" undoes them.
 *
 * With the param "playlist" (the + menu) or "playlist:<id>" (an empty
 * playlist) it recovers a Spotify playlist the same way: its export —
 * Exportify's CSV, or Playlist1.json with every playlist to pick from — is
 * matched, and the songs found go into a ByTune playlist in Spotify's order.
 * The decisions are the Liked import's: a song settled once is settled.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, FileDown, FileUp, Heart, ListMusic, ListPlus, PackageOpen, RotateCcw, Search, ShoppingBag, Undo2, X } from "lucide-react";
import { importPurchase } from "../lib/archiveImport";
import { storeLinks } from "../lib/storeLinks";
import { useSettings } from "../stores/settings";
import { TrackList } from "../components/TrackList";
import { Artwork, Btn, IconBtn } from "../components/primitives";
import { fmtTime } from "../lib/format";
import { matchesQuery } from "../lib/libraryTracks";
import {
  applyDecisions,
  entryKey,
  importOrder,
  matchEntries,
  mergeImportedPlaylist,
  shoppingListCsv,
  shoppingListText,
  spotifyLink,
  type ImportRow,
  type SpotifyEntry,
} from "../lib/spotifyImport";
import { songKey, useCatalog } from "../stores/catalog";
import { useLibrary } from "../stores/library";
import { useSpotifyImport } from "../stores/spotifyImport";
import { useUI } from "../stores/ui";
import type { Track } from "../types";

type Tab = "have" | "check" | "missing";

const REASON: Record<NonNullable<ImportRow["reason"]>, string> = {
  title: "The title differs",
  length: "The length differs",
  artist: "The artist is spelled differently",
};

const DECIDED: Record<NonNullable<ImportRow["decided"]>, string> = {
  same: "Same song",
  different: "Marked different",
  picked: "Chosen by you",
};

const likedOn = (ms: number | undefined): string =>
  ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

const describe = (e: SpotifyEntry): string =>
  `${e.artists.join(", ")}${e.album ? ` · ${e.album}` : ""}${e.durationMs ? ` · ${fmtTime(e.durationMs / 1000)}` : ""}`;

function Stat({ label, value, tone, active, onClick }: { label: string; value: number; tone: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 min-w-[160px] rounded-2xl p-4 text-left transition-colors ${
        active ? "bg-ink-hi/[0.12] ring-1 ring-inset ring-ink-hi/20" : "bg-ink-hi/[0.05] hover:bg-ink-hi/[0.08]"
      }`}
    >
      <div className={`text-[30px] font-extrabold leading-none tabular-nums ${tone}`}>{value}</div>
      <div className="text-[13px] text-ink-dim mt-2">{label}</div>
    </button>
  );
}

/** How to get the export — shown until a file is loaded. */
function HowToExport({ onPick, error, playlist = false }: { onPick: () => void; error: string | null; playlist?: boolean }) {
  return (
    <div className="space-y-4 max-w-[760px]">
      <div className="rounded-2xl bg-ink-hi/[0.04] p-6 space-y-4">
        <h2 className="text-[17px] font-bold text-ink-hi">1 · {playlist ? "Export the playlist" : "Export your Liked Songs"}</h2>
        <div className="text-[14px] text-ink-hi/85 leading-relaxed space-y-3">
          <p>
            <span className="font-semibold text-ink-hi">Exportify</span> (recommended): open{" "}
            <button onClick={() => window.open("https://exportify.net", "_blank")} className="font-semibold text-ink-hi underline">
              exportify.net
            </button>
            {playlist
              ? ", sign in with Spotify and click Export next to the playlist. The CSV keeps the playlist's order."
              : ", sign in with Spotify and click Export next to “Liked Songs”. The CSV says when you liked each song, so the order comes over exactly."}
          </p>
          <p>
            <span className="font-semibold text-ink-hi">Spotify's own data download</span>: Spotify account → Privacy
            settings → “Download your data” → Account data. The ZIP arrives within a few days; use the{" "}
            {playlist ? (
              <>
                <code className="text-[13px]">Playlist1.json</code> inside — it holds all your playlists; you pick one next.
              </>
            ) : (
              <>
                <code className="text-[13px]">YourLibrary.json</code> inside. It has no like dates, so the file's order is used.
              </>
            )}
          </p>
        </div>
      </div>
      <div className="rounded-2xl bg-ink-hi/[0.04] p-6 space-y-4">
        <h2 className="text-[17px] font-bold text-ink-hi">2 · Choose the file</h2>
        <Btn variant="white" icon={FileUp} onClick={onPick}>
          Choose export file
        </Btn>
        {error && <p className="text-[13px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}

/** Pick the library song a Spotify song is, by searching the library. */
function TrackPicker({ entry, onPick, onClose }: { entry: SpotifyEntry; onPick: (t: Track) => void; onClose: () => void }) {
  const tracks = useCatalog((s) => s.tracks);
  const [query, setQuery] = useState(() => `${entry.title.replace(/\s+-\s+.*$/, "").replace(/\s*[([][^)\]]*[)\]]/g, "")} ${entry.artists[0] ?? ""}`.trim());
  const results = useMemo(() => {
    const q = query.trim();
    return q ? tracks.filter((t) => matchesQuery(t, q)).slice(0, 60) : [];
  }, [tracks, query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-label="Choose the song" className="w-[min(640px,92vw)] max-h-[80vh] flex flex-col rounded-2xl glass-strong-solid shadow-float p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Which song in your library is</div>
            <div className="text-[17px] font-bold text-ink-hi truncate mt-1">{entry.title}</div>
            <div className="text-[13px] text-ink-dim truncate">{describe(entry)}</div>
          </div>
          <IconBtn icon={X} title="Close" onClick={onClose} className="rounded-full" />
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-hi/50 pointer-events-none" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your library"
            className="w-full h-10 pl-9 pr-4 rounded-full bg-ink-hi/[0.07] text-[14px] text-ink-hi placeholder:text-ink-hi/45 outline-none focus:bg-ink-hi/[0.1]"
          />
        </div>
        <div className="mt-3 overflow-y-auto min-h-0 flex-1 space-y-0.5">
          {results.length === 0 ? (
            <p className="text-[13px] text-ink-dim px-2 py-6 text-center">No songs match — try fewer words.</p>
          ) : (
            results.map((t) => (
              <button
                key={t.id}
                onClick={() => onPick(t)}
                className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-ink-hi/[0.07] transition-colors"
              >
                <Artwork src={t.thumb} className="w-10 h-10 rounded-md shrink-0" iconClassName="w-4 h-4" alt="" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink-hi truncate">{t.title}</div>
                  <div className="text-[12.5px] text-ink-dim truncate">
                    {t.artist}
                    {t.album ? ` · ${t.album}` : ""}
                  </div>
                </div>
                <span className="text-[12px] text-ink-faint tabular-nums">{t.duration ? fmtTime(t.duration) : ""}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const chip = (on: boolean, onTone: string): string =>
  `h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors ${
    on ? onTone : "bg-ink-hi/[0.08] text-ink-hi hover:bg-ink-hi/[0.14]"
  }`;

/** Of a data download's playlists, the one to recover — a search when there are many. */
function PlaylistChooser({ lists, onChoose }: { lists: { name: string; entries: SpotifyEntry[] }[]; onChoose: (index: number) => void }) {
  const [query, setQuery] = useState("");
  const shown = lists.map((l, i) => ({ ...l, i })).filter((l) => !query.trim() || l.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="space-y-3 max-w-[760px]">
      <div className="flex items-center gap-3">
        <h2 className="text-[17px] font-bold text-ink-hi mr-auto">Which playlist?</h2>
        {lists.length > 8 && (
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-hi/50 pointer-events-none" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${lists.length} playlists`}
              className="w-full h-9 pl-9 pr-4 rounded-full bg-ink-hi/[0.07] text-[13.5px] text-ink-hi placeholder:text-ink-hi/45 outline-none focus:bg-ink-hi/[0.1]"
            />
          </div>
        )}
      </div>
      <div className="space-y-0.5">
        {shown.map((l) => (
          <button
            key={l.i}
            onClick={() => onChoose(l.i)}
            className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-ink-hi/[0.07] transition-colors"
          >
            <span className="w-10 h-10 rounded-md bg-ink-hi/[0.06] grid place-items-center shrink-0">
              <ListMusic className="w-4 h-4 text-ink-hi/55" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink-hi truncate">{l.name}</span>
              <span className="block text-[12.5px] text-ink-dim">
                {l.entries.length} {l.entries.length === 1 ? "song" : "songs"}
              </span>
            </span>
          </button>
        ))}
        {!shown.length && <p className="text-[13px] text-ink-dim px-2 py-4">No playlist by that name.</p>}
      </div>
    </div>
  );
}

const NO_ENTRIES: SpotifyEntry[] = [];
const NO_TRACKS: Track[] = [];

/** A playlist named as ByTune names a new one — taken over by the Spotify playlist's name. */
const DEFAULT_NAME = /^(my playlist #\d+|new playlist)$/i;

export function SpotifyImportView({ param }: { param?: string }) {
  const imp = useSpotifyImport();
  const { verdicts, picks, likedIds, setVerdict, setVerdicts, pick, noteLiked } = imp;
  // "playlist" recovers a Spotify playlist into a new one; "playlist:<id>" into that one.
  const playlistMode = !!param?.startsWith("playlist");
  const into = param?.startsWith("playlist:") ? param.slice("playlist:".length) : undefined;
  const recovering = playlistMode && imp.playlist && (!into || imp.playlist.playlistId === into) ? imp.playlist : null;
  const choices = playlistMode && imp.playlistChoices && imp.playlistChoices.into === into ? imp.playlistChoices : null;
  const fileName = playlistMode ? (recovering?.fileName ?? null) : imp.fileName;
  const entries = playlistMode ? (recovering?.entries ?? NO_ENTRIES) : imp.entries;
  const dated = playlistMode ? false : imp.dated;
  const error = playlistMode ? imp.playlistError : imp.error;
  const load = (file: File): Promise<void> => (playlistMode ? imp.loadPlaylist(file, into) : imp.load(file));
  const reset = playlistMode ? imp.resetPlaylist : imp.reset;
  const playlists = useLibrary((s) => s.playlists);
  const target = playlistMode ? (playlists.find((p) => p.id === (recovering?.playlistId ?? into)) ?? null) : null;
  const tracks = useCatalog((s) => s.tracks);
  const byId = useCatalog((s) => s.byId);
  const versions = useCatalog((s) => s.versions);
  const liked = useLibrary((s) => s.liked);
  const showStores = useSettings((s) => s.storeLinks);
  const setStoreLinks = useSettings((s) => s.setStoreLinks);
  const navigate = useUI((s) => s.navigate);
  const toast = useUI((s) => s.toast);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<Tab>("have");
  const [picking, setPicking] = useState<SpotifyEntry | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  const matched = useMemo(() => matchEntries(entries, tracks), [entries, tracks]);
  const rows = useMemo(() => {
    // A hand-picked id may be a copy the catalogue merged into another song: play the merged song.
    const findSong = (id: string): Track | undefined => {
      const group = versions.get(id);
      const primary = group?.[0]?.id ?? id;
      return tracks.find((t) => t.id === primary) ?? byId.get(id);
    };
    return applyDecisions(matched, { verdicts, picks }, findSong);
  }, [matched, verdicts, picks, tracks, byId, versions]);

  const have = rows.filter((r) => r.kind === "match");
  const check = rows.filter((r) => r.kind === "check");
  const missing = rows.filter((r) => r.kind === "missing");
  const decided = rows.filter((r) => r.decided);
  // One per song: two Spotify entries can lead to the same song here (a remaster and the original, a pick).
  const songs = new Set<string>();
  const toLike = have.map((r) => r.track!).filter((t) => !songs.has(songKey(t.id)) && !!songs.add(songKey(t.id)));
  // What the button lays out: the matches, and liked songs still to check in their Spotify place.
  // The songs the target already holds: Liked Songs, or the playlist being recovered into.
  const held = playlistMode ? (target?.tracks ?? NO_TRACKS) : liked;
  const likedSongs = useMemo(() => new Set(held.map((t) => songKey(t.id))), [held, versions]);
  const order = importOrder(rows, likedSongs, songKey);
  const missingEntries = missing.map((r) => r.entry);

  const pickFile = (): void => fileInput.current?.click();
  const undo = (row: ImportRow): void => {
    const key = entryKey(row.entry);
    setVerdict(key, null);
    pick(key, null);
  };

  const addToLiked = (): void => {
    const added = useLibrary.getState().importLikes(order, likedIds);
    noteLiked(order.map((t) => t.id));
    toast(
      added > 0
        ? `Added ${added} ${added === 1 ? "song" : "songs"} to Liked Songs, in Spotify's order`
        : "Your Liked Songs now follow Spotify's order",
      "success"
    );
  };

  /** The songs found go into the playlist, in Spotify's order; songs added to it here stay, after them. */
  const addToPlaylist = (): void => {
    if (!recovering) return;
    const lib = useLibrary.getState();
    let playlist = target;
    if (!playlist) {
      playlist = lib.createPlaylist(recovering.name);
      imp.notePlaylist(playlist.id);
    } else if (!playlist.tracks.length && DEFAULT_NAME.test(playlist.name.trim())) {
      lib.renamePlaylist(playlist.id, recovering.name);
    }
    const before = new Set(playlist.tracks.map((t) => songKey(t.id)));
    lib.setPlaylistTracks(playlist.id, mergeImportedPlaylist(playlist.tracks, order, songKey));
    const added = order.filter((t) => !before.has(songKey(t.id))).length;
    const name = lib.getPlaylist(playlist.id)?.name ?? recovering.name;
    toast(
      added > 0 ? `Added ${added} ${added === 1 ? "song" : "songs"} to “${name}”, in Spotify's order` : `“${name}” now follows Spotify's order`,
      "success"
    );
  };

  const saveList = async (): Promise<void> => {
    try {
      const listName = playlistMode && recovering ? `${recovering.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Spotify playlist"} — songs to buy.csv` : "Spotify songs to buy.csv";
      const saved = await window.bytune?.saveTextFile(listName, shoppingListCsv(missingEntries));
      if (saved) toast(`Saved the list of ${missingEntries.length} songs`, "success");
    } catch {
      toast("Couldn't save the list", "error");
    }
  };

  const copyList = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(shoppingListText(missingEntries));
      toast(`Copied ${missingEntries.length} ${missingEntries.length === 1 ? "song" : "songs"}`);
    } catch {
      toast("Couldn't copy the list", "error");
    }
  };

  return (
    <div className="space-y-6 pb-14">
      <input
        ref={fileInput}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            setTab("have");
            void load(file);
          }
        }}
      />
      {picking && (
        <TrackPicker
          entry={picking}
          onClose={() => setPicking(null)}
          onPick={(t) => {
            pick(entryKey(picking), t.id);
            setPicking(null);
            toast(`“${picking.title}” is “${t.title}” in your library`, "success");
          }}
        />
      )}
      <header className="pt-2">
        <h1 className="font-display text-[34px] font-extrabold tracking-[-0.03em] text-ink-hi">
          {playlistMode ? "Recover a Spotify playlist" : "Import from Spotify"}
        </h1>
        <p className="text-[14px] text-ink-dim mt-2 max-w-[760px]">
          {playlistMode
            ? `Bring a Spotify playlist over: see which of its songs you already have, put them in ${
                target ? `“${target.name}”` : "a playlist"
              } in Spotify's order, and keep a list of the ones you still want to buy. Come back after buying songs and add again.`
            : "Bring your Spotify Liked Songs over: see which songs you already have, add them to your Liked Songs in Spotify's order, and keep a list of the ones you still want to buy. The import stays here until you start over, so you can come back after buying songs and add again."}
        </p>
      </header>

      {choices && !entries.length ? (
        <>
          <PlaylistChooser lists={choices.lists} onChoose={(i) => imp.choosePlaylist(i)} />
          <Btn variant="glass" size="sm" icon={FileUp} onClick={pickFile}>
            Choose another file
          </Btn>
        </>
      ) : !entries.length ? (
        <HowToExport onPick={pickFile} error={error} playlist={playlistMode} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-dim">
            <span className="text-ink-hi font-semibold">{playlistMode && recovering ? recovering.name : fileName}</span>
            <span>
              · {entries.length} {entries.length === 1 ? "song" : "songs"} ·{" "}
              {playlistMode ? "in the playlist's order" : dated ? "in the order you liked them" : "in the file's order (no like dates)"}
            </span>
            <div className="ml-auto flex gap-2">
              <Btn variant="glass" size="sm" icon={FileUp} onClick={pickFile}>
                Choose another file
              </Btn>
              <Btn variant="glass" size="sm" icon={RotateCcw} onClick={reset} title="Forget the file — your decisions stay for the next export">
                Start over
              </Btn>
            </div>
          </div>
          {error && <p className="text-[13px] text-red-400">{error}</p>}

          <div className="flex flex-wrap gap-3">
            <Stat label="In your library" value={have.length} tone="text-emerald-400" active={tab === "have"} onClick={() => setTab("have")} />
            <Stat label="To check" value={check.length} tone="text-amber-300" active={tab === "check"} onClick={() => setTab("check")} />
            <Stat label="Missing — to buy" value={missing.length} tone="text-ink-hi" active={tab === "missing"} onClick={() => setTab("missing")} />
          </div>

          {playlistMode && recovering ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-ink-hi/[0.04] p-4">
              <Btn variant="white" icon={ListPlus} onClick={addToPlaylist} disabled={!toLike.length}>
                {target ? `Add ${toLike.length} to “${target.name}”` : `Make “${recovering.name}” with ${toLike.length} ${toLike.length === 1 ? "song" : "songs"}`}
              </Btn>
              <p className="text-[13px] text-ink-dim flex-1 min-w-[240px]">
                In the playlist's order — adding again later puts newly found songs in their place. Songs you added to it in
                Songsta stay, after them{check.length ? `; the ${check.length} still to check aren't added until you decide` : ""}.
              </p>
              {target && (
                <Btn variant="glass" size="sm" onClick={() => navigate({ name: "playlist", param: target.id })}>
                  Open playlist
                </Btn>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-ink-hi/[0.04] p-4">
              <Btn variant="white" icon={Heart} onClick={addToLiked} disabled={!toLike.length}>
                Add {toLike.length} to Liked Songs
              </Btn>
              <p className="text-[13px] text-ink-dim flex-1 min-w-[240px]">
                In Spotify's order, newest first — adding again later puts newly found songs in their place. Songs you liked
                only in Songsta stay on top{check.length ? `; the ${check.length} still to check aren't added until you decide` : ""}.
              </p>
              <Btn variant="glass" size="sm" onClick={() => navigate({ name: "library", param: "liked" })}>
                Open Liked Songs
              </Btn>
            </div>
          )}

          {tab === "have" && (
            <TrackList
              tracks={toLike}
              showAlbum
              emptyTitle="None of these songs are in your library yet"
              emptyLabel="Add music folders or connect your server — songs you add show up here by themselves."
            />
          )}

          {tab === "check" && (
            <section className="space-y-3">
              {check.length === 0 ? (
                <p className="text-[14px] text-ink-dim">Nothing left to check.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] text-ink-dim mr-auto">
                      These look like songs you have, but something differs. Same song → {playlistMode ? "the playlist" : "Liked Songs"};
                      different → the shopping list; or choose the right song yourself.
                    </p>
                    <Btn variant="glass" size="sm" icon={Check} onClick={() => setVerdicts(check.map((r) => entryKey(r.entry)), "same")}>
                      All the same
                    </Btn>
                    <Btn variant="glass" size="sm" icon={X} onClick={() => setVerdicts(check.map((r) => entryKey(r.entry)), "different")}>
                      All different
                    </Btn>
                  </div>
                  {check.map((row) => {
                    const key = entryKey(row.entry);
                    const t = row.track!;
                    return (
                      <div key={key} className="flex flex-wrap items-center gap-4 rounded-xl p-3 bg-ink-hi/[0.05]">
                        <div className="flex-1 min-w-[280px] grid grid-cols-2 gap-4">
                          <div className="min-w-0">
                            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Spotify</div>
                            <div className="text-[14px] font-semibold text-ink-hi truncate">{row.entry.title}</div>
                            <div className="text-[12.5px] text-ink-dim truncate">{describe(row.entry)}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Your library</div>
                            <div className="text-[14px] font-semibold text-ink-hi truncate">{t.title}</div>
                            <div className="text-[12.5px] text-ink-dim truncate">
                              {t.artist}
                              {t.album ? ` · ${t.album}` : ""}
                              {t.duration ? ` · ${fmtTime(t.duration)}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="w-44 text-[12px] text-amber-300/90">{row.reason ? REASON[row.reason] : ""}</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => setVerdict(key, "same")} className={chip(false, "")}>
                            Same song
                          </button>
                          <button onClick={() => setVerdict(key, "different")} className={chip(false, "")}>
                            Different
                          </button>
                          <button onClick={() => setPicking(row.entry)} className={chip(false, "")}>
                            Choose…
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {decided.length > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => setShowDecided((v) => !v)}
                    className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-dim hover:text-ink-hi transition-colors"
                  >
                    {showDecided ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    Your decisions ({decided.length})
                  </button>
                  {showDecided && (
                    <div className="mt-2 space-y-0.5">
                      {decided.map((row) => (
                        <div key={entryKey(row.entry)} className="flex items-center gap-3 h-[52px] px-3 rounded-lg hover:bg-ink-hi/[0.05]">
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold text-ink-hi truncate">{row.entry.title}</div>
                            <div className="text-[12.5px] text-ink-dim truncate">
                              {row.decided === "different" || !row.track
                                ? describe(row.entry)
                                : `→ ${row.track.title} · ${row.track.artist}${row.track.album ? ` · ${row.track.album}` : ""}`}
                            </div>
                          </div>
                          <span className={`text-[12px] font-semibold ${row.decided === "different" ? "text-ink-dim" : "text-emerald-400"}`}>
                            {DECIDED[row.decided!]}
                          </span>
                          <Btn variant="ghost" size="sm" icon={Undo2} onClick={() => undo(row)}>
                            Undo
                          </Btn>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === "missing" && (
            <section className="space-y-3">
              {missing.length === 0 ? (
                <p className="text-[14px] text-ink-dim">You have every one of these songs.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] text-ink-dim mr-auto">
                      Songs not in your library{dated ? ", newest like first" : playlistMode ? ", in the playlist's order" : ""}. The list saves as a spreadsheet that
                      opens in Excel. Have one under another name? Use “I have it…”. Bought one? Drop the store's ZIP
                      anywhere on Songsta.
                    </p>
                    <Btn variant="white" size="sm" icon={FileDown} onClick={() => void saveList()}>
                      Save as list…
                    </Btn>
                    <Btn variant="glass" size="sm" icon={Copy} onClick={() => void copyList()}>
                      Copy
                    </Btn>
                    <Btn variant="glass" size="sm" icon={PackageOpen} onClick={() => void importPurchase()}>
                      Import ZIP…
                    </Btn>
                    <button
                      onClick={() => setStoreLinks(!showStores)}
                      role="switch"
                      aria-checked={showStores}
                      title="Search links to Qobuz, Bandcamp, 7digital and Amazon"
                      className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors ${
                        showStores ? "bg-accent/20 text-ink-hi" : "bg-ink-hi/[0.06] text-ink-dim hover:text-ink-hi"
                      }`}
                    >
                      Shop links {showStores ? "on" : "off"}
                    </button>
                  </div>
                  <div>
                    <div className="flex items-center gap-3 px-3 pb-2.5 mb-1 border-b border-ink-hi/[0.06] text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-ghost">
                      <div className="w-8 shrink-0">#</div>
                      <div className="flex-1 min-w-0">Title</div>
                      <div className="w-56 hidden lg:block">Album</div>
                      <div className="w-28 hidden md:block">{playlistMode ? "Added" : "Liked"}</div>
                      <div className={showStores ? "w-[210px]" : "w-[150px]"} />
                    </div>
                    {missing.map((row, n) => {
                      const link = spotifyLink(row.entry.uri);
                      return (
                        <div key={entryKey(row.entry)} className="group flex items-center gap-3 h-[52px] px-3 rounded-lg hover:bg-ink-hi/[0.05]">
                          <div className="w-8 shrink-0 text-[13px] text-ink-faint tabular-nums">{n + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[14.5px] font-semibold text-ink-hi truncate">{row.entry.title}</div>
                            <div className="text-[13px] text-ink-dim truncate">
                              {row.entry.artists.join(", ")}
                              {row.decided === "different" && <span className="text-ink-faint"> · marked different</span>}
                            </div>
                          </div>
                          <div className="w-56 hidden lg:block text-[12.5px] text-ink-faint truncate">{row.entry.album}</div>
                          <div className="w-28 hidden md:block text-[12.5px] text-ink-faint tabular-nums">{likedOn(row.entry.addedAt)}</div>
                          <div className={`${showStores ? "w-[210px]" : "w-[150px]"} flex items-center justify-end gap-1`}>
                            {showStores && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const ui = useUI.getState();
                                  if (ui.contextMenu) {
                                    ui.closeContextMenu();
                                    return;
                                  }
                                  ui.openContextMenu(
                                    rect.right,
                                    rect.bottom + 6,
                                    storeLinks(row.entry, navigator.language).map((l) => ({
                                      label: `Search on ${l.store}`,
                                      icon: ExternalLink,
                                      action: () => window.open(l.url, "_blank"),
                                    })),
                                    { alignRight: true }
                                  );
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                aria-label={`Where to buy ${row.entry.title}`}
                                className="h-7 px-2.5 rounded-full inline-flex items-center gap-1 text-[12px] font-semibold text-ink-hi bg-accent/15 hover:bg-accent/25 transition-colors"
                              >
                                <ShoppingBag className="w-3.5 h-3.5" />
                                Buy
                              </button>
                            )}
                            {row.decided === "different" ? (
                              <Btn variant="ghost" size="sm" icon={Undo2} onClick={() => undo(row)}>
                                Undo
                              </Btn>
                            ) : (
                              <button
                                onClick={() => setPicking(row.entry)}
                                className="h-7 px-2.5 rounded-full text-[12px] font-semibold text-ink-hi bg-ink-hi/[0.08] hover:bg-ink-hi/[0.14] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                              >
                                I have it…
                              </button>
                            )}
                            {link && (
                              <button
                                onClick={() => window.open(link, "_blank")}
                                title="Open in Spotify"
                                aria-label={`Open ${row.entry.title} in Spotify`}
                                className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
