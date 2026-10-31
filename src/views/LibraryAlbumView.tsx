/**
 * Album page for the library, Spotify-style: big cover beside the title, the
 * artist (opens the artist page), year, song count and length, a play and a
 * shuffle button, the tracks in disc/track order, then more by the artist.
 * Songs from every source that share album artist + title form one album.
 */
import { useMemo } from "react";
import { Disc3, Shuffle } from "lucide-react";
import { AlbumTile, BigPlayButton } from "../components/LibraryCards";
import { TrackList } from "../components/TrackList";
import { Artwork, EmptyState, ShelfScroller } from "../components/primitives";
import { artistAlbums, useLibraryIndex } from "../lib/catalogIndex";
import { fmtLength } from "../lib/format";
import { artistRoute, parseRoute } from "../lib/libraryTracks";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";

const SOURCE_LABEL = { local: "On this device", jellyfin: "Jellyfin", subsonic: "Navidrome" } as const;

export function LibraryAlbumView({ param }: { param: string }) {
  const { albums, loaded } = useLibraryIndex();
  const navigate = useUI((s) => s.navigate);
  const playQueue = usePlayer((s) => s.playQueue);
  const key = parseRoute(param, "album");
  const album = useMemo(() => albums.find((a) => a.key === key) ?? null, [albums, key]);
  const more = useMemo(
    () => (album ? artistAlbums(albums, album.artist).own.filter((a) => a.key !== album.key) : []),
    [albums, album]
  );

  if (!loaded) return null;
  if (!album) {
    return <EmptyState icon={Disc3} title="Album not found" body="It may have been removed from your library." />;
  }

  const sources = [...new Set(album.tracks.map((t) => t.source).filter(Boolean))] as (keyof typeof SOURCE_LABEL)[];
  const shuffle = (): void => {
    const shuffled = [...album.tracks].sort(() => Math.random() - 0.5);
    playQueue(shuffled, 0);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end gap-6 pt-4 animate-slide-up">
        <Artwork src={album.thumb} rounded="rounded-lg" className="w-[232px] h-[232px] shrink-0 shadow-elev" iconClassName="w-12 h-12" />
        <div className="min-w-0 pb-1">
          <div className="text-[13px] font-semibold text-ink-hi/80">Album</div>
          <h1
            className="font-display font-extrabold tracking-[-0.04em] text-ink-hi leading-[1.02] mt-1 line-clamp-2"
            style={{ fontSize: album.title.length > 28 ? 44 : 64 }}
          >
            {album.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[14px] text-ink-hi/80 mt-4">
            <button
              onClick={() => navigate({ name: "artist", param: artistRoute(album.artist) })}
              className="font-bold text-ink-hi hover:underline"
            >
              {album.artist}
            </button>
            {album.year && <span>· {album.year}</span>}
            <span>
              · {album.tracks.length} {album.tracks.length === 1 ? "song" : "songs"}, {fmtLength(album.duration)}
            </span>
            {sources.length > 0 && <span className="text-ink-dim">· {sources.map((s) => SOURCE_LABEL[s]).join(" + ")}</span>}
          </div>
        </div>
      </header>

      <div className="flex items-center gap-5">
        <BigPlayButton onClick={() => playQueue(album.tracks, 0)} label={`Play ${album.title}`} />
        <button
          onClick={shuffle}
          title="Shuffle play"
          aria-label="Shuffle play"
          className="w-10 h-10 grid place-items-center rounded-full text-ink-hi/70 hover:text-ink-hi hover:scale-105 transition-all"
        >
          <Shuffle className="w-6 h-6" />
        </button>
      </div>

      <TrackList tracks={album.tracks} emptyLabel="No songs." />

      {more.length > 0 && (
        <section className="pt-2">
          <h2 className="section-title text-[21px] mb-4">More by {album.artist}</h2>
          <ShelfScroller>
            {more.map((a) => (
              <AlbumTile key={a.key} album={a} subtitle={a.year ? String(a.year) : "Album"} />
            ))}
          </ShelfScroller>
        </section>
      )}
    </div>
  );
}
