/** A library mix (genre, decade, On Repeat, Rediscover) as a playable page. */
import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { CollectionHeader } from "../components/LibraryCards";
import { TrackList } from "../components/TrackList";
import { EmptyState } from "../components/primitives";
import { useLibraryIndex } from "../lib/catalogIndex";
import { mixById } from "../lib/mixes";
import { useCatalog, useFreshPlayCounts } from "../stores/catalog";

export function MixView({ param }: { param: string }) {
  const { tracks, loaded } = useLibraryIndex();
  const playCounts = useCatalog((s) => s.playCounts);
  useFreshPlayCounts();
  const mix = useMemo(() => mixById(param, tracks, playCounts), [param, tracks, playCounts]);

  if (!loaded) return null;
  if (!mix) return <EmptyState icon={Sparkles} title="This mix is empty" body="Mixes need at least eight matching songs." />;

  return (
    <div className="space-y-6">
      <CollectionHeader label="Mix" title={mix.title} subtitle={mix.subtitle} tracks={mix.tracks} />
      <TrackList tracks={mix.tracks} showAlbum sourceName={mix.title} emptyLabel="No songs." />
    </div>
  );
}
