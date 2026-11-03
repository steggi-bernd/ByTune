/**
 * The page behind "Playing from …". A queue only knows the name it was started
 * under, here or on the computer, so the name is looked up: first what the song
 * itself belongs to, then the lists the app has. Search results and the like have
 * no page of their own; there the song's album is the way on.
 */
export interface PageRoute {
  screen: string;
  params: object;
}

export interface PlayingFrom {
  /** "Playing from album" */
  label: string;
  name: string;
  page: PageRoute | null;
}

/** The library's own key of a song's album; songs not on an album of the library have none. */
export function albumKeyOf(track: { albumId?: string }): string | null {
  return track.albumId?.startsWith("lib:album:") ? decodeURIComponent(track.albumId.slice("lib:album:".length)) : null;
}

/** Branching off, as on the computer: the rest of the list next, then what was coming, minus what the branch already plays. */
export function branched<T extends { id: string }>(coming: T[], rest: T[]): T[] {
  const inBranch = new Set(rest.map((t) => t.id));
  return [...rest, ...coming.filter((t) => !inBranch.has(t.id))];
}

const albumPage = (albumKey: string): PageRoute => ({ screen: "Album", params: { albumKey } });
const listPage = (params: object): PageRoute => ({ screen: "Collection", params });

export function playingFrom(
  context: string,
  track: { album?: string; albumId?: string },
  known: {
    albums: { key: string; title: string }[];
    artists: { name: string }[];
    mixes: { id: string; title: string }[];
    genres: { key: string; name: string }[];
    playlists: { id: string; name: string }[];
  }
): PlayingFrom {
  const own = albumKeyOf(track);
  const ownPage = own ? albumPage(own) : null;
  const fromList = (kind: string, params: object): PlayingFrom => ({ label: `Playing from ${kind}`, name: context, page: listPage(params) });

  if (!context || context === track.album) return { label: "Playing from album", name: track.album || context, page: ownPage };
  if (context === "Liked Songs") return fromList("playlist", { kind: "liked" });
  if (context === "Downloads") return fromList("your downloads", { kind: "downloads" });
  const playlist = known.playlists.find((p) => p.name === context);
  if (playlist) return fromList("playlist", { kind: "playlist", id: playlist.id });
  const mix = known.mixes.find((m) => m.title === context);
  if (mix) return fromList("mix", { kind: "mix", id: mix.id });
  const genre = known.genres.find((g) => g.name === context);
  if (genre) return fromList("genre", { kind: "genre", key: genre.key });
  const liked = /^Liked songs by (.+)$/.exec(context);
  if (liked) return fromList("liked songs", { kind: "artistLiked", name: liked[1] });
  const album = known.albums.find((a) => a.title === context);
  if (album) return { label: "Playing from album", name: context, page: albumPage(album.key) };
  const artist = known.artists.find((a) => a.name === context);
  if (artist) return { label: "Playing from artist", name: context, page: { screen: "Artist", params: { name: artist.name } } };
  return { label: "Playing from", name: context, page: ownPage };
}
