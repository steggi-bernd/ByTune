/**
 * Artist page for the library, Spotify-style: a full-width photo banner with
 * the name over it, play/shuffle, the artist's most played songs (from your
 * own listening history), their albums, the albums they appear on, and an
 * About card with the Wikipedia bio. Photo, bio and facts come from the open
 * databases (artistAbout.ts); everything else is your own library.
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Shuffle, User } from "lucide-react";
import { AlbumTile, BigPlayButton } from "../components/LibraryCards";
import { TrackList } from "../components/TrackList";
import { EmptyState, ShelfScroller } from "../components/primitives";
import { resolveArtistAbout, type ArtistAbout } from "../lib/artistAbout";
import { artistAlbums, artistTracks, byPlays, useLibraryIndex } from "../lib/catalogIndex";
import { parseRoute } from "../lib/libraryTracks";
import { useCatalog, useFreshPlayCounts } from "../stores/catalog";
import { usePlayer } from "../stores/player";

export function LibraryArtistView({ param }: { param: string }) {
  const name = parseRoute(param, "artist") ?? "";
  const { tracks, albums, loaded } = useLibraryIndex();
  const playCounts = useCatalog((s) => s.playCounts);
  const playQueue = usePlayer((s) => s.playQueue);
  const [about, setAbout] = useState<ArtistAbout | null>(null);
  const [showAll, setShowAll] = useState(false);
  useFreshPlayCounts();

  useEffect(() => {
    let alive = true;
    setAbout(null);
    void resolveArtistAbout(name).then((a) => {
      if (alive) setAbout(a);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  const songs = useMemo(() => artistTracks(tracks, name), [tracks, name]);
  const popular = useMemo(() => byPlays(songs, playCounts), [songs, playCounts]);
  const { own, appearsOn } = useMemo(() => artistAlbums(albums, name), [albums, name]);

  if (!loaded) return null;
  if (!songs.length) {
    return <EmptyState icon={User} title={`No songs by ${name}`} body="Nothing in your library credits this artist." />;
  }

  const photo = about?.thumb ?? own[0]?.thumb ?? songs[0]?.thumb ?? "";
  const shuffle = (): void => playQueue([...songs].sort(() => Math.random() - 0.5), 0);

  return (
    <div className="space-y-7">
      {/* Banner: the photo bleeds to the panel edges, the name sits on it. */}
      <header className="relative -mx-10 -mt-5 h-[340px] overflow-hidden animate-fade-in">
        {photo ? (
          <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover object-[center_25%]" />
        ) : (
          <div className="absolute inset-0 bg-ink-hi/[0.06]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/10" />
        <div className="absolute left-10 right-10 bottom-7">
          <h1 className="font-display font-extrabold tracking-[-0.04em] text-white leading-none drop-shadow-lg" style={{ fontSize: name.length > 18 ? 56 : 88 }}>
            {name}
          </h1>
          <div className="text-[15px] text-white/85 mt-4">
            {songs.length} {songs.length === 1 ? "song" : "songs"}
            {own.length > 0 && ` · ${own.length} ${own.length === 1 ? "album" : "albums"}`} in your library
            {about?.facts && <span className="text-white/65"> · {about.facts}</span>}
          </div>
        </div>
      </header>

      <div className="flex items-center gap-5">
        <BigPlayButton onClick={() => playQueue(popular, 0)} label={`Play ${name}`} />
        <button
          onClick={shuffle}
          title="Shuffle play"
          aria-label="Shuffle play"
          className="w-10 h-10 grid place-items-center rounded-full text-ink-hi/70 hover:text-ink-hi hover:scale-105 transition-all"
        >
          <Shuffle className="w-6 h-6" />
        </button>
      </div>

      <section>
        <h2 className="section-title text-[21px] mb-3">Popular</h2>
        <TrackList tracks={popular.slice(0, showAll ? 10 : 5)} showAlbum emptyLabel="No songs." />
        {popular.length > 5 && (
          <button onClick={() => setShowAll((v) => !v)} className="mt-2 ml-3 text-[13px] font-bold text-ink-dim hover:text-ink-hi transition-colors">
            {showAll ? "Show less" : "See more"}
          </button>
        )}
      </section>

      {own.length > 0 && (
        <section>
          <h2 className="section-title text-[21px] mb-4">Albums</h2>
          <ShelfScroller>
            {own.map((a) => (
              <AlbumTile key={a.key} album={a} subtitle={a.year ? `${a.year} · Album` : "Album"} />
            ))}
          </ShelfScroller>
        </section>
      )}

      {appearsOn.length > 0 && (
        <section>
          <h2 className="section-title text-[21px] mb-4">Appears on</h2>
          <ShelfScroller>
            {appearsOn.map((a) => (
              <AlbumTile key={a.key} album={a} />
            ))}
          </ShelfScroller>
        </section>
      )}

      {about?.description && (
        <section className="max-w-[860px]">
          <h2 className="section-title text-[21px] mb-4">About</h2>
          <div className="rounded-2xl bg-ink-hi/[0.04] overflow-hidden flex flex-col md:flex-row">
            {about.thumb && <img src={about.thumb} alt="" className="md:w-[280px] h-[220px] md:h-auto object-cover object-top" />}
            <div className="p-6 min-w-0">
              {about.genres.length > 0 && <div className="text-[13px] text-ink-dim mb-3">{about.genres.join(" · ")}</div>}
              <p className="text-[15px] leading-relaxed text-ink-hi/85 whitespace-pre-line">{about.description}</p>
              {about.wikiUrl && (
                <button
                  onClick={() => window.open(about.wikiUrl as string, "_blank")}
                  className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-ink-hi hover:underline"
                >
                  Read more on Wikipedia <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
