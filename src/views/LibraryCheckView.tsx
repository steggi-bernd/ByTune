/**
 * Library check (Settings → Library check, lib/libraryCheck.ts): what looks
 * off in the library, with a fix where ByTune can make one itself — an
 * artist shown under one spelling, album parts merged — and, for files, where
 * they are, to clear away by hand. Nothing here touches the files.
 */
import { useMemo, useState, type ReactNode } from "react";
import { CircleCheckBig, Disc3, FolderOpen, Merge, RotateCcw } from "lucide-react";
import { Artwork, Btn, EmptyState } from "../components/primitives";
import { useLibraryIndex, type LibAlbum } from "../lib/catalogIndex";
import { artistSpellings, missingDetails, spareCopies, splitAlbums } from "../lib/libraryCheck";
import { isLoose } from "../lib/albumEdits";
import { describePlayback, formatLine } from "../lib/playbackFormat";
import { useAlbumEdits } from "../stores/albumEdits";
import { versionsOf } from "../stores/catalog";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import { T } from "../lib/i18n";

/** Rows a section shows before "Show all". */
const FIRST = 12;

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Section({ title, hint, count, children }: { title: string; hint: string; count: number; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h2 className="section-title text-[21px]">{title}</h2>
        <span className="text-[13px] text-ink-faint tabular-nums">{count}</span>
      </div>
      <p className="text-[13px] text-ink-faint mt-1 mb-3">{hint}</p>
      <div className="rounded-xl bg-ink-hi/[0.03] divide-y divide-ink-hi/[0.06]">{children}</div>
    </section>
  );
}

function More({ total, open, onToggle }: { total: number; open: boolean; onToggle: () => void }) {
  if (total <= FIRST) return null;
  return (
    <button onClick={onToggle} className="w-full px-4 py-2.5 text-left text-[13px] font-semibold text-ink-dim hover:text-ink-hi transition-colors">
      {open ? T("Show fewer") : T("Show all {toLocaleString}", { toLocaleString: total.toLocaleString("en-US") })}
    </button>
  );
}

/** "FLAC · 24-bit / 96 kHz", or the file type when nothing more is known. */
function quality(t: Track): string {
  const f = describePlayback(t);
  return f ? formatLine(f) : (t.localPath?.split(".").pop() ?? "").toUpperCase();
}

function AlbumLine({ album, onOpen }: { album: LibAlbum; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-hi/[0.04] transition-colors">
      <Artwork src={album.thumb} className="w-9 h-9 rounded-md shrink-0" iconClassName="w-3.5 h-3.5" alt="" />
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-ink-hi truncate">{album.title}</div>
        <div className="text-[12.5px] text-ink-dim truncate">{album.artist}</div>
      </div>
    </button>
  );
}

export function LibraryCheckView() {
  const { tracks, albums, loaded } = useLibraryIndex();
  const aliases = useAlbumEdits((s) => s.aliases);
  const navigate = useUI((s) => s.navigate);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string): void => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const shown = <T,>(key: string, list: T[]): T[] => (open[key] ? list : list.slice(0, FIRST));

  const spellings = useMemo(() => artistSpellings(tracks), [tracks]);
  const splits = useMemo(() => splitAlbums(albums), [albums]);
  const spares = useMemo(() => spareCopies(tracks, versionsOf), [tracks]);
  const missing = useMemo(() => missingDetails(albums), [albums]);
  const loose = useMemo(() => tracks.filter(isLoose).length, [tracks]);
  const spellingEdits = Object.entries(aliases ?? {});

  if (!loaded) return null;
  const found = spellings.length + splits.length + spares.length + missing.cover.length + missing.year.length + missing.genre.length + (loose ? 1 : 0);
  const openAlbum = (a: LibAlbum) => () => navigate({ name: "album", param: a.route });
  const useSpelling = (names: string[], chosen: string): void => {
    for (const name of names) if (name !== chosen) useAlbumEdits.getState().setAlias(name, chosen);
  };

  return (
    <div className="space-y-9">
      <header className="animate-slide-up">
        <h1 className="font-display text-[30px] font-bold tracking-[-0.03em] text-ink-hi">{T("Library check")}</h1>
        <p className="text-[13px] text-ink-faint mt-1">
          {T("{value} · Songsta only changes how it shows your music — your files stay as they are.", { value: found ? T("{count} to look at", { count: plural(found, "thing") }) : T("Nothing to fix") })}</p>
      </header>

      {loose > 0 && (
        <Section title={T("Songs without an album")} count={loose} hint={T("Their tags name no album, so they show on no album page. Put them on one by hand — or fix their tags.")}>
          <div className="px-4 py-3 flex items-center gap-4">
            <div className="min-w-0 flex-1 text-[14px] text-ink-hi">
              {T("{count} on no album", { count: plural(loose, "song") })}</div>
            <Btn size="sm" variant="accent" icon={Disc3} onClick={() => navigate({ name: "loose" })}>{T("Show them")}</Btn>
          </div>
        </Section>
      )}

      {spellings.length > 0 && (
        <Section title={T("Artists written different ways")} count={spellings.length} hint={T("Pick the spelling to show; every song credited under the others appears under it.")}>
          {shown("spell", spellings).map((g) => (
            <div key={g.names.map((n) => n.name).join("|")} className="px-4 py-3 flex items-center gap-4 flex-wrap">
              <div className="min-w-0 flex-1 text-[14px] text-ink-hi">
                {g.names.map((n, i) => (
                  <span key={n.name}>
                    {i > 0 && <span className="text-ink-faint"> · </span>}
                    <span className="font-semibold">{n.name}</span>
                    <span className="text-ink-faint"> {plural(n.songs, "song")}</span>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {g.names.map((n) => (
                  <Btn key={n.name} size="sm" variant={n.name === g.suggested ? "accent" : "glass"} onClick={() => useSpelling(g.names.map((x) => x.name), n.name)}>{T("Show as “{name}”", { name: n.name })}</Btn>
                ))}
              </div>
            </div>
          ))}
          <More total={spellings.length} open={!!open.spell} onToggle={() => toggle("spell")} />
        </Section>
      )}

      {splits.length > 0 && (
        <Section title={T("Albums in several parts")} count={splits.length} hint={T("A disc, a bonus or a deluxe part tagged as an album of its own. Merged, they show as one; the album editor splits them again.")}>
          {shown("split", splits).map(({ parts, into }) => (
            <div key={into.key} className="px-4 py-3 flex items-center gap-4 flex-wrap">
              <Artwork src={into.thumb} className="w-11 h-11 rounded-md shrink-0" iconClassName="w-4 h-4" alt="" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink-hi truncate">{into.title}</div>
                <div className="text-[12.5px] text-ink-dim truncate">
                  {T("{artist} · also as", { artist: into.artist })}{" "}{parts.map((p) => `“${p.title}”`).join(", ")}
                </div>
              </div>
              <Btn size="sm" variant="accent" icon={Merge} onClick={() => parts.forEach((p) => useAlbumEdits.getState().merge(p.key, into.key))}>{T("Merge into one")}</Btn>
            </div>
          ))}
          <More total={splits.length} open={!!open.split} onToggle={() => toggle("split")} />
        </Section>
      )}

      {spares.length > 0 && (
        <Section title={T("Songs you have twice")} count={spares.length} hint={T("Songsta plays the best copy. The others only take up space — clear them away in their folder if you like.")}>
          {shown("spare", spares).map(({ song, keep, spare }) => (
            <div key={song.id} className="px-4 py-3">
              <div className="text-[14px] text-ink-hi truncate">
                <span className="font-semibold">{song.title}</span>
                <span className="text-ink-dim"> · {song.artist}</span>
              </div>
              <div className="text-[12.5px] text-ink-dim mt-0.5">{T("Plays: {quality}", { quality: quality(keep) })}</div>
              {spare.map((copy) => (
                <div key={copy.id} className="mt-1.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1 text-[12.5px] text-ink-dim truncate" title={copy.localPath}>{T("Also here: {quality} — {localPath}", { quality: quality(copy), localPath: copy.localPath })}
                  </div>
                  <Btn size="sm" variant="glass" icon={FolderOpen} onClick={() => copy.localPath && void window.bytune?.revealPath(copy.localPath)}>{T("Show in folder")}</Btn>
                </div>
              ))}
            </div>
          ))}
          <More total={spares.length} open={!!open.spare} onToggle={() => toggle("spare")} />
        </Section>
      )}

      {(
        [
          ["cover", T("Albums without a cover"), T("The open databases had none either. A cover.jpg in the album's folder shows up on the next scan.")],
          ["year", T("Albums without a year"), T("Without one they sort last in an artist's discography.")],
          ["genre", T("Albums without a genre"), T("They stay out of the genre pages and genre mixes.")],
        ] as const
      ).map(([key, title, hint]) =>
        missing[key].length ? (
          <Section key={key} title={title} count={missing[key].length} hint={hint}>
            {shown(key, missing[key]).map((album) => (
              <AlbumLine key={album.key} album={album} onOpen={openAlbum(album)} />
            ))}
            <More total={missing[key].length} open={!!open[key]} onToggle={() => toggle(key)} />
          </Section>
        ) : null
      )}

      {spellingEdits.length > 0 && (
        <Section title={T("Your spellings")} count={spellingEdits.length} hint={T("Artists shown under another spelling. Undo shows them as tagged again.")}>
          {spellingEdits.map(([from, to]) => (
            <div key={from} className="px-4 py-2.5 flex items-center gap-4">
              <div className="min-w-0 flex-1 text-[14px] text-ink-hi truncate">
                {from} <span className="text-ink-faint">→</span> {to}
              </div>
              <Btn size="sm" variant="ghost" icon={RotateCcw} onClick={() => useAlbumEdits.getState().setAlias(from, null)}>{T("Undo")}</Btn>
            </div>
          ))}
        </Section>
      )}

      {found === 0 && (
        <EmptyState icon={CircleCheckBig} title={T("Your library looks tidy")} body={T("Every song on an album, no artist under two spellings, no album in parts, no song twice on this computer, and every album has its cover, year and genre.")} />
      )}
    </div>
  );
}
