/**
 * Artist page for the library, Spotify-style: a full-width photo banner with
 * the name over it, play/shuffle, then two tabs.
 *
 *  - Overview: a strip leading to the songs of theirs you've liked (a small
 *    playlist of their own, ArtistLikedView), the artist's most played songs
 *    (from your own listening history), their albums, singles & EPs and
 *    compilations (newest first), the releases they appear on, and an About
 *    card with the Wikipedia bio
 *  - Discography: every release of theirs in the library, newest on top,
 *    each with its cover, type, year and full track list — filterable by type
 *
 * Release types come from the tags where present, else from the title and
 * size (lib/releases.ts). Photo, bio and facts come from the open databases
 * (artistAbout.ts); the banner is the sharpest of the artist's pictures
 * (lib/artistBanner.ts); everything else is your own library.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Shuffle, User } from "lucide-react";
import { BannerPicture } from "../components/BannerPicture";
import { AlbumTile, BigPlayButton, playCollection } from "../components/LibraryCards";
import { TrackList } from "../components/TrackList";
import { Artwork, EmptyState, ShelfScroller } from "../components/primitives";
import { LikedCover } from "../components/LikedCover";
import { resolveArtistAbout, useArtistPicture, type ArtistAbout } from "../lib/artistAbout";
import { bannerCandidates } from "../lib/artistBanner";
import { artistAlbums, artistTracks, byPlays, useLibraryIndex, useLikedAmong, type LibAlbum } from "../lib/catalogIndex";
import { fmtLength } from "../lib/format";
import { parseRoute } from "../lib/libraryTracks";
import { RELEASE_LABEL } from "../lib/releases";
import { useArtistImages } from "../lib/songInfo";
import { useCatalog, useFreshPlayCounts } from "../stores/catalog";
import { useUI } from "../stores/ui";
import { T } from "../lib/i18n";

type Tab = "overview" | "discography";
type DiscFilter = "all" | "albums" | "eps" | "compilations";
const DISC_FILTER_LABEL: Record<DiscFilter, string> = {
  all: T("All"),
  albums: T("Albums"),
  eps: T("Singles & EPs"),
  compilations: T("Compilations"),
};

function inFilter(a: LibAlbum, f: DiscFilter): boolean {
  if (f === "all") return true;
  if (f === "albums") return a.kind === "album";
  if (f === "eps") return a.kind === "ep" || a.kind === "single";
  return a.kind === "compilation";
}

/** "2014 · EP" for the release shelves. */
const releaseLine = (a: LibAlbum): string => `${a.year ? `${a.year} · ` : ""}${RELEASE_LABEL[a.kind]}`;

/** One release in the discography: cover, title, type · year · length, play, and its songs. */
function DiscographyRelease({ album }: { album: LibAlbum }) {
  const navigate = useUI((s) => s.navigate);
  const open = (): void => navigate({ name: "album", param: album.route });
  return (
    <section className="space-y-3">
      <div className="flex items-end gap-5">
        <button onClick={open} className="shrink-0" title={T("Open {title}", { title: album.title })} aria-label={T("Open {title}", { title: album.title })}>
          <Artwork src={album.thumb} rounded="rounded-md" className="w-[136px] h-[136px] shadow-elev" iconClassName="w-8 h-8" />
        </button>
        <div className="min-w-0 pb-1">
          <button
            onClick={open}
            className="block max-w-full truncate text-left text-[26px] font-extrabold tracking-[-0.02em] text-ink-hi hover:underline"
          >
            {album.title}
          </button>
          <div className="text-[14px] text-ink-dim mt-1">
            {RELEASE_LABEL[album.kind]}
            {album.year ? ` · ${album.year}` : ""} · {album.tracks.length} {album.tracks.length === 1 ? T("song") : T("songs")},{" "}
            {fmtLength(album.duration)}
          </div>
          <div className="mt-3">
            <BigPlayButton onClick={() => playCollection(album.tracks)} label={T("Play {title}", { title: album.title })} tracks={album.tracks} />
          </div>
        </div>
      </div>
      <TrackList tracks={album.tracks} showAlbum={false} showHeader={false} sourceName={album.title} emptyLabel={T("No songs.")} />
    </section>
  );
}

export function LibraryArtistView({ param }: { param: string }) {
  const name = parseRoute(param, "artist") ?? "";
  const { tracks, albums, loaded } = useLibraryIndex();
  const playCounts = useCatalog((s) => s.playCounts);
  const navigate = useUI((s) => s.navigate);
  const [about, setAbout] = useState<ArtistAbout | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [discFilter, setDiscFilter] = useState<DiscFilter>("all");
  useFreshPlayCounts();

  useEffect(() => {
    let alive = true;
    setAbout(null);
    setShowAll(false);
    setTab("overview");
    setDiscFilter("all");
    void resolveArtistAbout(name).then((a) => {
      if (alive) setAbout(a);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  const images = useArtistImages(name);
  const picture = useArtistPicture(name);
  const songs = useMemo(() => artistTracks(tracks, name), [tracks, name]);
  const popular = useMemo(() => byPlays(songs, playCounts), [songs, playCounts]);
  const likedHere = useLikedAmong(songs);
  const { own, appearsOn } = useMemo(() => artistAlbums(albums, name), [albums, name]);
  const byType = useMemo(
    () => ({
      albums: own.filter((a) => inFilter(a, "albums")),
      eps: own.filter((a) => inFilter(a, "eps")),
      compilations: own.filter((a) => inFilter(a, "compilations")),
    }),
    [own]
  );

  if (!loaded) return null;
  if (!songs.length) {
    return <EmptyState icon={User} title={T("No songs by {name}", { name })} body={T("Nothing in your library credits this artist.")} />;
  }

  // The banner: the artist's sharpest picture, else a cover (lib/artistBanner.ts).
  const banner = bannerCandidates({ picture, genius: images, photo: about?.thumb ?? null, covers: [own[0]?.thumb, songs[0]?.thumb] });
  const counts = [
    byType.albums.length ? `${byType.albums.length} ${byType.albums.length === 1 ? T("album") : T("albums")}` : null,
    byType.eps.length ? `${byType.eps.length} ${byType.eps.length === 1 ? "single or EP" : "singles & EPs"}` : null,
  ].filter(Boolean);
  const filters = (Object.keys(DISC_FILTER_LABEL) as DiscFilter[]).filter(
    (f) => f === "all" || own.some((a) => inFilter(a, f))
  );

  return (
    <div className="space-y-7">
      {/* Banner: the photo bleeds to the panel edges, the name sits on it. */}
      <header className="relative page-bleed -mt-5 h-[340px] overflow-hidden animate-fade-in">
        <BannerPicture key={name} candidates={banner} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/10" />
        <div className="absolute inset-x-0 page-pad bottom-7">
          <h1 className="font-display font-extrabold tracking-[-0.04em] text-white leading-none drop-shadow-lg" style={{ fontSize: name.length > 18 ? 56 : 88 }}>
            {name}
          </h1>
          <div className="text-[15px] text-white/85 mt-4">
            {T("{count} {value}{value2} in your library", { count: songs.length, value: songs.length === 1 ? T("song") : T("songs"), value2: counts.length > 0 ? ` · ${counts.join(" · ")}` : "" })}{about?.facts && <span className="text-white/65"> · {about.facts}</span>}
          </div>
        </div>
      </header>

      <div className="flex items-center gap-5">
        <BigPlayButton onClick={() => playCollection(popular)} label={T("Play {name}", { name })} tracks={songs} />
        <button
          onClick={() => playCollection(songs, true)}
          title={T("Shuffle play")}
          aria-label={T("Shuffle play")}
          className="w-10 h-10 grid place-items-center rounded-full text-ink-hi/70 hover:text-ink-hi hover:scale-105 transition-all"
        >
          <Shuffle className="w-6 h-6" />
        </button>
      </div>

      <div className="flex items-center gap-6 border-b border-ink-hi/[0.08]" role="tablist" aria-label={T("Artist sections")}>
        {(["overview", "discography"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`relative pb-3 text-[15px] font-bold transition-colors ${tab === t ? "text-ink-hi" : "text-ink-hi/55 hover:text-ink-hi/85"}`}
          >
            {t === "overview" ? T("Overview") : T("Discography{value}", { value: own.length ? ` · ${own.length}` : "" })}
            <span className={`absolute left-0 right-0 -bottom-px h-[3px] rounded-full ${tab === t ? "bg-ink-hi" : "bg-transparent"}`} />
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          {likedHere.length > 0 && (
            <button
              onClick={() => navigate({ name: "artistliked", param })}
              className="group w-full flex items-center gap-3.5 h-[68px] pl-2 pr-4 rounded-lg bg-ink-hi/[0.05] hover:bg-ink-hi/[0.1] transition-colors text-left"
            >
              <LikedCover className="w-[52px] h-[52px] rounded-md shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink-hi truncate">{T("Liked songs")}</span>
                <span className="block text-[13px] text-ink-dim truncate mt-0.5">
                  {T("{count} {value} by {name}", { count: likedHere.length, value: likedHere.length === 1 ? T("song") : T("songs"), name })}
                </span>
              </span>
              <ChevronRight className="w-5 h-5 shrink-0 text-ink-dim group-hover:text-ink-hi transition-colors" />
            </button>
          )}
          <section>
            <h2 className="section-title text-[21px] mb-3">{T("Popular")}</h2>
            <TrackList tracks={popular.slice(0, showAll ? 10 : 5)} showAlbum emptyLabel={T("No songs.")} />
            {popular.length > 5 && (
              <button onClick={() => setShowAll((v) => !v)} className="mt-2 ml-3 text-[13px] font-bold text-ink-dim hover:text-ink-hi transition-colors">
                {showAll ? T("Show less") : T("See more")}
              </button>
            )}
          </section>


          {(
            [
              [T("Albums"), byType.albums],
              [T("Singles & EPs"), byType.eps],
              [T("Compilations"), byType.compilations],
              [T("Appears on"), appearsOn],
            ] as const
          ).map(
            ([title, list]) =>
              list.length > 0 && (
                <section key={title}>
                  <div className="flex items-baseline justify-between mb-4">
                    <h2 className="section-title text-[21px]">{title}</h2>
                    {title !== T("Appears on") && own.length > 0 && (
                      <button
                        onClick={() => {
                          setDiscFilter(title === T("Albums") ? "albums" : title === T("Compilations") ? "compilations" : "eps");
                          setTab("discography");
                        }}
                        className="text-[13px] font-bold text-ink-dim hover:text-ink-hi hover:underline transition-colors"
                      >{T("Show discography")}</button>
                    )}
                  </div>
                  <ShelfScroller>
                    {list.map((a) => (
                      <AlbumTile key={a.key} album={a} subtitle={title === T("Appears on") ? `${a.year ? `${a.year} · ` : ""}${a.artist}` : releaseLine(a)} />
                    ))}
                  </ShelfScroller>
                </section>
              )
          )}

          {about?.description && (
            <section className="max-w-[860px]">
              <h2 className="section-title text-[21px] mb-4">{T("About")}</h2>
              <div className="rounded-2xl bg-ink-hi/[0.04] overflow-hidden flex flex-col md:flex-row">
                {about.thumb && <img src={about.thumb} alt="" className="md:w-[280px] h-[220px] md:h-auto object-cover object-top" />}
                <div className="p-6 min-w-0">
                  {about.genres.length > 0 && <div className="text-[13px] text-ink-dim mb-3">{about.genres.join(" · ")}</div>}
                  <p className="text-[15px] leading-relaxed text-ink-hi/85 whitespace-pre-line">{about.description}</p>
                  {about.wikiUrl && (
                    <button
                      onClick={() => window.open(about.wikiUrl as string, "_blank")}
                      className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-ink-hi hover:underline"
                    >{T("Read more on Wikipedia")}{" "}<ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      ) : own.length === 0 ? (
        <EmptyState
          icon={User}
          title={T("No releases of their own yet")}
          body={T("{name} appears on other artists' albums in your library — see Overview.", { name })}
        />
      ) : (
        <>
          {filters.length > 2 && (
            <div className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <button
                  key={f}
                  onClick={() => setDiscFilter(f)}
                  aria-pressed={discFilter === f}
                  className={`h-8 px-3 rounded-full text-[13px] font-medium transition-colors ${
                    discFilter === f ? "bg-ink-hi text-black" : "bg-ink-hi/[0.07] text-ink-hi hover:bg-ink-hi/[0.12]"
                  }`}
                >
                  {DISC_FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-10">
            {own
              .filter((a) => inFilter(a, filters.length > 2 ? discFilter : "all"))
              .map((a) => (
                <DiscographyRelease key={a.key} album={a} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}
