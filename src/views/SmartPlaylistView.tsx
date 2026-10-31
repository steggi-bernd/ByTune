/**
 * A smart playlist's page: its live songs (worked out from the rules every
 * time the catalogue changes), the rules as a subtitle, edit and delete.
 */
import { useMemo } from "react";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { CollectionHeader } from "../components/LibraryCards";
import { useSmartEditor } from "../components/SmartPlaylistEditor";
import { TrackList } from "../components/TrackList";
import { EmptyState } from "../components/primitives";
import { describeRules, evaluateSmartPlaylist } from "../lib/smartPlaylists";
import { useCatalog, useFreshPlayCounts } from "../stores/catalog";
import { useLibrary } from "../stores/library";
import { useSmartPlaylists } from "../stores/smartPlaylists";
import { useUI } from "../stores/ui";

export function SmartPlaylistView({ id }: { id: string }) {
  const sp = useSmartPlaylists((s) => s.playlists.find((p) => p.id === id) ?? null);
  const tracks = useCatalog((s) => s.tracks);
  const loaded = useCatalog((s) => s.loaded);
  const counts = useCatalog((s) => s.playCounts);
  const liked = useLibrary((s) => s.liked);
  useFreshPlayCounts();
  const likedIds = useMemo(() => new Set(liked.map((t) => t.id)), [liked]);
  const songs = useMemo(() => (sp ? evaluateSmartPlaylist(sp, tracks, counts, likedIds) : []), [sp, tracks, counts, likedIds]);

  if (!sp) return <EmptyState icon={Sparkles} title="Smart playlist not found" body="It may have been deleted." />;
  if (!loaded) return null;

  const remove = (): void =>
    useUI.getState().openDialog({
      title: `Delete “${sp.name}”?`,
      body: "Only the rules are deleted — your songs stay where they are.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        useSmartPlaylists.getState().remove(sp.id);
        useUI.getState().navigate({ name: "home" });
      },
    });

  return (
    <div className="space-y-6">
      <CollectionHeader
        label="Smart playlist"
        title={sp.name}
        subtitle={describeRules(sp)}
        tracks={songs}
        actions={
          <>
            <button
              onClick={() => useSmartEditor.getState().open(sp, false)}
              title="Edit rules"
              aria-label="Edit rules"
              className="w-10 h-10 grid place-items-center rounded-full text-ink-hi/70 hover:text-ink-hi hover:scale-105 transition-all"
            >
              <Pencil className="w-5 h-5" />
            </button>
            <button
              onClick={remove}
              title="Delete smart playlist"
              aria-label="Delete smart playlist"
              className="w-10 h-10 grid place-items-center rounded-full text-ink-hi/70 hover:text-red-400 hover:scale-105 transition-all"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </>
        }
      />
      {songs.length ? (
        <TrackList tracks={songs} showAlbum emptyLabel="No songs." />
      ) : (
        <EmptyState icon={Sparkles} title="No songs match yet" body="Change the rules, or add music that fits them." />
      )}
    </div>
  );
}
