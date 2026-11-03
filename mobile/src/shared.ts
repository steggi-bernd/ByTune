/** What the phone takes from the desktop app's library logic: pure code, one copy for both. */
export type { Track } from "../../src/types";
export { jellyfinStreamPlan } from "../../electron/jellyfin-stream";
export { leadArtist, matchesQuery, splitCredits } from "../../src/lib/libraryCore";
export { describePlayback, formatLine } from "../../src/lib/playbackFormat";
export { jellyfinItemToTrack, jellyfinToTrack } from "../../src/lib/jellyfinItem";
export {
  artistAlbums,
  artistTracks,
  buildAlbums,
  buildArtists,
  buildGenres,
  byPlays,
  likedAmong,
  newestFirst,
  type LibAlbum,
  type LibArtist,
  type LibGenre,
  type PlayCounts,
} from "../../src/lib/catalogBuild";
export {
  addedLabel,
  albumOrders,
  albumRowsOf,
  artistOrders,
  artistRowsOf,
  dayLabel,
  DEFAULT_EXPLORE_SORTS,
  genreOrders,
  genreRowsOf,
  nextSort,
  sortRows,
  type AlbumRow,
  type ArtistRow,
  type ExploreSort,
  type ExploreTab,
  type GenreRow,
} from "../../src/lib/exploreRows";
export { allMixes, type Mix } from "../../src/lib/mixes";
export { recordDeletionChanges, type DeletionChange } from "../../src/lib/deletion-sync";
export { likedInOrder, mergePlaylistDocs, songFinder, toPlaylistDoc, toWireTrack, type PlaylistDoc, type WirePlaylist, type WireTrack } from "../../src/lib/playlistSync";
export { createSyncEngine, defaultSyncAddress, type PlaybackNote, type QueueDoc, type SyncEngine, type SyncStatus } from "../../src/lib/syncEngine";
export { playCreditSeconds } from "../../src/lib/favoriteSync";
export { fmtLength, fmtTime, plural } from "../../src/lib/format";
export { RELEASE_LABEL } from "../../src/lib/releases";
