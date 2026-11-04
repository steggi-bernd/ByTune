/** A library mix (genre, decade, On Repeat, Rediscover, this time of day) as a playable page. */
import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { CollectionHeader } from "../components/LibraryCards";
import { TrackList } from "../components/TrackList";
import { EmptyState } from "../components/primitives";
import { useLibraryIndex } from "../lib/catalogIndex";
import { mixById, momentMix } from "../lib/mixes";
import { useMomentScores } from "../lib/moments";
import { energyOf, useSound } from "../stores/sound";
import { songKey, useCatalog, useFreshPlayCounts } from "../stores/catalog";
import { T } from "../lib/i18n";

export function MixView({ param }: { param: string }) {
  const { tracks, loaded } = useLibraryIndex();
  const playCounts = useCatalog((s) => s.playCounts);
  useFreshPlayCounts();
  const moment = useMomentScores();
  const sound = useSound((s) => s.facts);
  const mix = useMemo(
    () =>
      param === "moment"
        ? momentMix(tracks, moment.scores, songKey, moment.at || Date.now())
        : mixById(param, tracks, playCounts, (t) => energyOf(t, sound)),
    [param, tracks, playCounts, moment.scores, moment.at, sound]
  );

  if (!loaded) return null;
  if (!mix) return <EmptyState icon={Sparkles} title={T("This mix is empty")} body={T("Mixes need at least eight matching songs.")} />;

  return (
    <div className="space-y-6">
      <CollectionHeader label={T("Mix")} title={mix.title} subtitle={mix.subtitle} tracks={mix.tracks} />
      <TrackList tracks={mix.tracks} showAlbum sourceName={mix.title} emptyLabel={T("No songs.")} />
    </div>
  );
}
