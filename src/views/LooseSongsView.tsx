/**
 * Songs whose tags name no album: they'd show on no album, artist or home
 * page, so they gather here — the latest added first — until they're put on
 * an album by hand ("Make an album…": a title, an artist, a year, the songs
 * in their order). Typing an album you have puts them on that one. Like every
 * album correction it stays in ByTune (stores/albumEdits.ts) — the files keep
 * their tags, and the album editor takes the songs off again.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Disc3, X } from "lucide-react";
import { CollectionHeader } from "../components/LibraryCards";
import { TrackList } from "../components/TrackList";
import { Btn, EmptyState, IconBtn } from "../components/primitives";
import { applySongEdits, isLoose, type SongEdit } from "../lib/albumEdits";
import { useLibraryIndex } from "../lib/catalogIndex";
import { albumKeyOf } from "../lib/libraryTracks";
import { useAlbumEdits } from "../stores/albumEdits";
import { versionsOf } from "../stores/catalog";
import { useUI } from "../stores/ui";
import type { Track } from "../types";

/** A credited artist, or "" where the tags name none. */
const known = (artist: string | undefined): string => {
  const name = artist?.trim() ?? "";
  return name.toLowerCase() === "unknown artist" ? "" : name;
};

/** File order, numbers by value: "2 - B" before "10 - A". */
const byFile = (a: Track, b: Track): number =>
  (a.localPath ?? a.title).localeCompare(b.localPath ?? b.title, undefined, { numeric: true, sensitivity: "base" });

/** The folder a file sits in, by name. */
const folderOf = (path: string | undefined): string => (path ? (path.split(/[\\/]/).slice(-2, -1)[0] ?? "") : "");

/** Songs added within this long of the latest one are taken as one batch — likely one album. */
const BATCH_MS = 10 * 60 * 1000;

export function LooseSongsView() {
  const { tracks, loaded } = useLibraryIndex();
  const [making, setMaking] = useState(false);
  const loose = useMemo(() => tracks.filter(isLoose).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || byFile(a, b)), [tracks]);

  if (!loaded) return null;
  if (!loose.length) {
    return <EmptyState icon={Disc3} title="Every song is on an album" body="Songs whose tags name no album gather here, to be put on one." />;
  }
  return (
    <div className="space-y-6">
      <CollectionHeader
        label="Collection"
        title="Songs without an album"
        subtitle="Their tags name no album"
        tracks={loose}
        actions={
          <Btn variant="glass" size="md" icon={Disc3} onClick={() => setMaking(true)}>
            Make an album…
          </Btn>
        }
      />
      <TrackList tracks={loose} showAlbum={false} sourceName="Songs without an album" emptyLabel="No songs." />
      {making && <MakeAlbumDialog songs={loose} onClose={() => setMaking(false)} />}
    </div>
  );
}

/**
 * Put songs on an album: the latest added batch is picked, in file order;
 * the title starts as their folder's name and the artist as theirs, where
 * they share one. Songs with no artist of their own take the album's.
 */
function MakeAlbumDialog({ songs, onClose }: { songs: Track[]; onClose: () => void }) {
  const { albums, artists } = useLibraryIndex();
  const toast = useUI((s) => s.toast);
  const navigate = useUI((s) => s.navigate);
  const latest = Math.max(...songs.map((t) => t.addedAt ?? 0));
  const [order, setOrder] = useState<Track[]>(() => [...songs].sort(byFile));
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(songs.filter((t) => !latest || (t.addedAt ?? 0) >= latest - BATCH_MS).map((t) => t.id))
  );
  const [title, setTitle] = useState(() => {
    const folders = new Set(songs.filter((t) => picked.has(t.id)).map((t) => folderOf(t.localPath)));
    return folders.size === 1 ? [...folders][0] : "";
  });
  const [artist, setArtist] = useState(() => {
    const names = new Set(songs.filter((t) => picked.has(t.id)).map((t) => known(t.artist)));
    return names.size === 1 ? [...names][0] : "";
  });
  const [year, setYear] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chosen = order.filter((t) => picked.has(t.id));
  // Songs by different artists and no album artist given: "Various Artists" holds them together.
  const credited = new Set(chosen.map((t) => known(t.artist)).filter(Boolean));
  const albumArtist = artist.trim() || (credited.size > 1 ? "Various Artists" : "");
  const yearNo = /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : undefined;
  const editOf = (t: Track, i: number): SongEdit => ({
    album: title.trim(),
    albumArtist: albumArtist || undefined,
    artist: artist.trim() && !known(t.artist) ? artist.trim() : undefined,
    trackNo: i + 1,
    year: yearNo,
  });
  // Where they'd land — an album you have, if the title and artist name one.
  const landsOn = chosen.length && title.trim() ? applySongEdits([chosen[0]], { [chosen[0].id]: editOf(chosen[0], 0) })[0] : null;
  const joins = landsOn ? albums.find((a) => a.key === albumKeyOf(landsOn)) : undefined;

  const move = (id: string, by: -1 | 1): void =>
    setOrder((list) => {
      const at = list.findIndex((t) => t.id === id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= list.length) return list;
      const next = [...list];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    });
  const toggle = (id: string): void =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = (): void => {
    if (!landsOn || !chosen.length) return;
    const edits: Record<string, SongEdit> = {};
    chosen.forEach((t, i) => {
      // Under every copy's id: a song found twice keeps it whichever copy leads.
      for (const v of versionsOf(t)) edits[v.id] = editOf(t, i);
      edits[t.id] = editOf(t, i);
    });
    useAlbumEdits.getState().setSongs(edits);
    const n = chosen.length;
    toast(
      joins ? `Put ${n} ${n === 1 ? "song" : "songs"} on “${joins.title}”` : `Made “${title.trim()}” from ${n} ${n === 1 ? "song" : "songs"}`,
      "success"
    );
    onClose();
    if (landsOn.albumId) navigate({ name: "album", param: landsOn.albumId });
  };

  const field = "w-full h-9 px-4 rounded-full bg-ink-hi/[0.07] text-[13.5px] text-ink-hi placeholder:text-ink-hi/45 outline-none focus:bg-ink-hi/[0.1]";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-label="Make an album" className="w-[min(680px,94vw)] max-h-[86vh] flex flex-col rounded-2xl glass-strong-solid shadow-float">
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Make an album</div>
            <div className="text-[18px] font-bold text-ink-hi">Put songs on an album</div>
            <div className="text-[12.5px] text-ink-dim">It stays in Songsta — your files keep their tags. The album editor takes them off again.</div>
          </div>
          <IconBtn icon={X} title="Close" onClick={onClose} className="rounded-full" />
        </div>

        <form
          className="overflow-y-auto min-h-0 px-5 pb-5 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid grid-cols-[1fr_1fr_96px] gap-2">
            <label className="space-y-1">
              <span className="block text-[12px] font-semibold text-ink-dim px-1">Album</span>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} list="make-album-titles" placeholder="Title" className={field} />
            </label>
            <label className="space-y-1">
              <span className="block text-[12px] font-semibold text-ink-dim px-1">Artist</span>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} list="make-album-artists" placeholder={credited.size > 1 ? "Various Artists" : "Artist"} className={field} />
            </label>
            <label className="space-y-1">
              <span className="block text-[12px] font-semibold text-ink-dim px-1">Year</span>
              <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" maxLength={4} placeholder="—" className={field} />
            </label>
            <datalist id="make-album-titles">
              {[...new Set(albums.map((a) => a.title))].slice(0, 400).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <datalist id="make-album-artists">
              {artists.slice(0, 400).map((a) => (
                <option key={a.route} value={a.name} />
              ))}
            </datalist>
          </div>
          {joins && (
            <p className="text-[12.5px] text-ink-dim -mt-2 px-1">
              Joins your album “{joins.title}” by {joins.artist} ({joins.tracks.length} {joins.tracks.length === 1 ? "song" : "songs"}).
            </p>
          )}

          <section>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[14px] font-bold text-ink-hi">
                Songs <span className="text-ink-faint font-normal">· {chosen.length} of {order.length}</span>
              </h3>
              <button
                type="button"
                onClick={() => setPicked(chosen.length === order.length ? new Set() : new Set(order.map((t) => t.id)))}
                className="text-[12.5px] font-semibold text-ink-dim hover:text-ink-hi"
              >
                {chosen.length === order.length ? "Pick none" : "Pick all"}
              </button>
            </div>
            <div className="mt-2 space-y-0.5">
              {order.map((t, i) => {
                const on = picked.has(t.id);
                const no = on ? chosen.indexOf(t) + 1 : null;
                return (
                  <div key={t.id} className={`flex items-center gap-3 px-2 h-12 rounded-lg hover:bg-ink-hi/[0.05] ${on ? "" : "opacity-55"}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(t.id)} aria-label={`Put “${t.title}” on the album`} className="w-4 h-4 accent-[rgb(var(--accent))] shrink-0" />
                    <span className="w-6 text-right text-[13px] tabular-nums text-ink-faint shrink-0">{no ?? ""}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] text-ink-hi truncate">{t.title}</div>
                      <div className="text-[12px] text-ink-dim truncate" title={t.localPath}>
                        {known(t.artist) || "No artist"}
                        {t.localPath ? ` · ${t.localPath.split(/[\\/]/).pop()}` : ""}
                      </div>
                    </div>
                    <IconBtn type="button" icon={ArrowUp} title="Earlier" onClick={() => move(t.id, -1)} disabled={i === 0} className="rounded-full" />
                    <IconBtn type="button" icon={ArrowDown} title="Later" onClick={() => move(t.id, 1)} disabled={i === order.length - 1} className="rounded-full" />
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex justify-end gap-2 pt-1">
            <Btn type="button" variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Btn>
            <Btn type="submit" variant="accent" size="md" icon={Disc3} disabled={!title.trim() || !chosen.length}>
              {joins ? "Put on album" : "Make album"}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
