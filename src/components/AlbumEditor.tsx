/**
 * Album editor: fix an album's artists and gather the albums its tags split
 * off ("Disc 2", a song tagged with another album artist) back into it.
 * The corrections live in ByTune only (stores/albumEdits.ts) — files and
 * servers stay as they are — and show everywhere at once.
 */
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Plus, RotateCcw, Search, Split, X } from "lucide-react";
import { resolveAlbumKey } from "../lib/albumEdits";
import { useLibraryIndex, type LibAlbum } from "../lib/catalogIndex";
import { foldTag } from "../lib/duplicates";
import { albumKeyOf, splitCredits } from "../lib/libraryTracks";
import { RELEASE_LABEL } from "../lib/releases";
import { useAlbumEdits } from "../stores/albumEdits";
import { useUI } from "../stores/ui";
import { Artwork, Btn, IconBtn } from "./primitives";

/** Which album page should open its editor (set by the library panel's "Edit album…"). */
export const useAlbumEditorRequest = create<{ key: string | null }>(() => ({ key: null }));

/** The title without disc/edition markers: "Album (Disc 2)", "Album [CD1]", "Album (Deluxe)" → "album". */
function baseTitle(title: string): string {
  return foldTag(
    title
      .replace(/\s*[([][^)\]]*\b(?:disc|disk|cd|deluxe|bonus|edition|remaster(?:ed)?|expanded|anniversary|b-sides?)\b[^)\]]*[)\]]/gi, "")
      .replace(/\s*[-–:]\s*(?:disc|disk|cd)\s*\d+\s*$/i, "")
  );
}

function AlbumRow({ album, action }: { album: LibAlbum; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-ink-hi/[0.05]">
      <Artwork src={album.thumb} className="w-10 h-10 rounded-md shrink-0" iconClassName="w-4 h-4" alt="" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink-hi truncate">{album.title}</div>
        <div className="text-[12.5px] text-ink-dim truncate">
          {album.artist} · {album.year ? `${album.year} · ` : ""}
          {RELEASE_LABEL[album.kind]} · {album.tracks.length} {album.tracks.length === 1 ? "song" : "songs"}
        </div>
      </div>
      {action}
    </div>
  );
}

export function AlbumEditor({ album, onClose }: { album: LibAlbum; onClose: () => void }) {
  const credit = useAlbumEdits((s) => s.artists[album.key]);
  const mergedInto = useAlbumEdits((s) => s.mergedInto);
  const { albums, artists } = useLibraryIndex();
  const toast = useUI((s) => s.toast);
  const [adding, setAdding] = useState("");
  const [query, setQuery] = useState("");
  const names = splitCredits(album.artist);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setNames = (next: string[]): void => useAlbumEdits.getState().setArtists(album.key, next.join(", "));
  const addArtist = (): void => {
    const name = adding.trim();
    if (!name) return;
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) setNames([...names, name]);
    setAdding("");
  };

  /** Albums shown as part of this one, by their own tag key — with the title their songs carry. */
  const parts = useMemo(
    () =>
      Object.keys(mergedInto)
        .filter((k) => k !== album.key && resolveAlbumKey(k, mergedInto) === album.key)
        .map((k) => {
          const songs = album.tracks.filter((t) => albumKeyOf(t) === k);
          return { key: k, title: songs[0]?.album ?? k.split("|")[1] ?? k, artist: songs[0]?.albumArtist || songs[0]?.artist || "", count: songs.length };
        }),
    [mergedInto, album]
  );

  // With no search: albums that look like parts of this one first (same base title), then the same artist's.
  const candidates = useMemo(() => {
    const others = albums.filter((a) => a.key !== album.key);
    const q = foldTag(query);
    if (q) return others.filter((a) => foldTag(`${a.title} ${a.artist}`).includes(q)).slice(0, 40);
    const base = baseTitle(album.title);
    const mine = new Set(names.map((n) => n.toLowerCase()));
    const sameTitle = others.filter((a) => baseTitle(a.title) === base);
    const sameArtist = others.filter(
      (a) => !sameTitle.includes(a) && splitCredits(a.artist).some((n) => mine.has(n.toLowerCase()))
    );
    return [...sameTitle, ...sameArtist].slice(0, 20);
  }, [albums, album, query, names]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-label="Edit album" className="w-[min(680px,94vw)] max-h-[86vh] flex flex-col rounded-2xl glass-strong-solid shadow-float">
        <div className="flex items-start gap-3 p-5 pb-3">
          <Artwork src={album.thumb} className="w-14 h-14 rounded-md shrink-0" iconClassName="w-5 h-5" alt="" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Edit album</div>
            <div className="text-[18px] font-bold text-ink-hi truncate">{album.title}</div>
            <div className="text-[12.5px] text-ink-dim">Changes stay in ByTune — your files and servers aren't touched.</div>
          </div>
          <IconBtn icon={X} title="Close" onClick={onClose} className="rounded-full" />
        </div>

        <div className="overflow-y-auto min-h-0 px-5 pb-5 space-y-6">
          <section>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[14px] font-bold text-ink-hi">Artists</h3>
              {credit && (
                <button
                  onClick={() => useAlbumEdits.getState().setArtists(album.key, null)}
                  className="inline-flex items-center gap-1 text-[12.5px] text-ink-dim hover:text-ink-hi"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Back to the tags
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {names.map((n) => (
                <span key={n} className="inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full bg-ink-hi/[0.08] text-[13px] text-ink-hi">
                  {n}
                  <button
                    onClick={() => setNames(names.filter((x) => x !== n))}
                    disabled={names.length < 2}
                    title={names.length < 2 ? "An album keeps at least one artist" : `Remove ${n}`}
                    aria-label={`Remove ${n}`}
                    className="w-6 h-6 grid place-items-center rounded-full text-ink-hi/60 hover:text-ink-hi hover:bg-ink-hi/[0.1] disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex gap-2 mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                addArtist();
              }}
            >
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                list="album-editor-artists"
                placeholder="Add an artist"
                className="flex-1 h-9 px-4 rounded-full bg-ink-hi/[0.07] text-[13.5px] text-ink-hi placeholder:text-ink-hi/45 outline-none focus:bg-ink-hi/[0.1]"
              />
              <datalist id="album-editor-artists">
                {artists.slice(0, 400).map((a) => (
                  <option key={a.route} value={a.name} />
                ))}
              </datalist>
              <Btn variant="glass" size="md" icon={Plus} type="submit" disabled={!adding.trim()}>
                Add
              </Btn>
            </form>
          </section>

          <section>
            <h3 className="text-[14px] font-bold text-ink-hi">Parts of this album</h3>
            {parts.length === 0 ? (
              <p className="text-[13px] text-ink-dim mt-2">
                No other album is shown as part of this one. If your tags split it — “Disc 2”, or a song with another album
                artist — add that album below.
              </p>
            ) : (
              <div className="mt-2 space-y-0.5">
                {parts.map((p) => (
                  <div key={p.key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-ink-hi/[0.05]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-ink-hi truncate">{p.title}</div>
                      <div className="text-[12.5px] text-ink-dim truncate">
                        {p.artist} · {p.count} {p.count === 1 ? "song" : "songs"}
                      </div>
                    </div>
                    <Btn
                      variant="glass"
                      size="sm"
                      icon={Split}
                      onClick={() => {
                        useAlbumEdits.getState().split(p.key);
                        toast(`“${p.title}” is its own album again`);
                      }}
                    >
                      Separate
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[14px] font-bold text-ink-hi">Add an album to this one</h3>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-hi/50 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search albums"
                className="w-full h-9 pl-9 pr-4 rounded-full bg-ink-hi/[0.07] text-[13.5px] text-ink-hi placeholder:text-ink-hi/45 outline-none focus:bg-ink-hi/[0.1]"
              />
            </div>
            <div className="mt-2 space-y-0.5">
              {candidates.length === 0 ? (
                <p className="text-[13px] text-ink-dim py-3">{query ? "No album matches." : "No similar albums — search for one."}</p>
              ) : (
                candidates.map((a) => (
                  <AlbumRow
                    key={a.key}
                    album={a}
                    action={
                      <Btn
                        variant="glass"
                        size="sm"
                        icon={Plus}
                        onClick={() => {
                          useAlbumEdits.getState().merge(a.key, album.key);
                          toast(`“${a.title}” is now part of “${album.title}”`, "success");
                        }}
                      >
                        Merge
                      </Btn>
                    }
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
