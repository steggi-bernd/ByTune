/**
 * Import from Spotify: read a Liked Songs export, see which songs are already
 * in the library, add those to Liked Songs in Spotify's order, and keep a
 * list of the rest to buy.
 *
 * The matching (lib/spotifyImport.ts) runs live on the catalogue: buy a song,
 * add it to a folder or to Jellyfin, and it moves from "Missing" to "In your
 * library" on its own. Uncertain matches wait for the user's word — "Same
 * song" sends them to Liked Songs, "Different" onto the shopping list.
 */
import { useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, FileDown, FileUp, Heart, RotateCcw, X } from "lucide-react";
import { TrackList } from "../components/TrackList";
import { Btn } from "../components/primitives";
import { fmtTime } from "../lib/format";
import { matchEntries, shoppingListCsv, shoppingListText, spotifyLink, type ImportRow } from "../lib/spotifyImport";
import { useCatalog } from "../stores/catalog";
import { useLibrary } from "../stores/library";
import { useSpotifyImport } from "../stores/spotifyImport";
import { useUI } from "../stores/ui";

type Tab = "have" | "check" | "missing";

const REASON: Record<NonNullable<ImportRow["reason"]>, string> = {
  title: "The title differs",
  length: "The length differs",
  artist: "The artist is spelled differently",
};

const likedOn = (ms: number | undefined): string =>
  ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

function Stat({ label, value, tone, active, onClick }: { label: string; value: number; tone: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 min-w-[160px] rounded-2xl p-4 text-left transition-colors ${
        active ? "bg-ink-hi/[0.12] ring-1 ring-inset ring-ink-hi/20" : "bg-ink-hi/[0.05] hover:bg-ink-hi/[0.08]"
      }`}
    >
      <div className={`text-[30px] font-extrabold leading-none tabular-nums ${tone}`}>{value}</div>
      <div className="text-[13px] text-ink-dim mt-2">{label}</div>
    </button>
  );
}

/** How to get the export — shown until a file is loaded. */
function HowToExport({ onPick, error }: { onPick: () => void; error: string | null }) {
  return (
    <div className="space-y-4 max-w-[760px]">
      <div className="rounded-2xl bg-ink-hi/[0.04] p-6 space-y-4">
        <h2 className="text-[17px] font-bold text-ink-hi">1 · Export your Liked Songs</h2>
        <div className="text-[14px] text-ink-hi/85 leading-relaxed space-y-3">
          <p>
            <span className="font-semibold text-ink-hi">Exportify</span> (recommended): open{" "}
            <button onClick={() => window.open("https://exportify.net", "_blank")} className="font-semibold text-ink-hi underline">
              exportify.net
            </button>
            , sign in with Spotify and click Export next to “Liked Songs”. The CSV says when you liked each song, so the
            order comes over exactly.
          </p>
          <p>
            <span className="font-semibold text-ink-hi">Spotify's own data download</span>: Spotify account → Privacy
            settings → “Download your data” → Account data. The ZIP arrives within a few days; use the{" "}
            <code className="text-[13px]">YourLibrary.json</code> inside. It has no like dates, so the file's order is used.
          </p>
        </div>
      </div>
      <div className="rounded-2xl bg-ink-hi/[0.04] p-6 space-y-4">
        <h2 className="text-[17px] font-bold text-ink-hi">2 · Choose the file</h2>
        <Btn variant="white" icon={FileUp} onClick={onPick}>
          Choose export file
        </Btn>
        {error && <p className="text-[13px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}

export function SpotifyImportView() {
  const { fileName, entries, dated, error, verdicts, load, setVerdict, setVerdicts, reset } = useSpotifyImport();
  const tracks = useCatalog((s) => s.tracks);
  const navigate = useUI((s) => s.navigate);
  const toast = useUI((s) => s.toast);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<Tab>("have");

  const rows = useMemo(() => matchEntries(entries, tracks), [entries, tracks]);
  const indexed = useMemo(() => rows.map((row, i) => ({ row, i })), [rows]);
  const have = indexed.filter((x) => x.row.kind === "match");
  const check = indexed.filter((x) => x.row.kind === "check");
  const undecided = check.filter((x) => verdicts[x.i] === undefined).length;
  // "Different" puts a song on the shopping list; "Same song" sends it to Liked Songs.
  const missing = indexed.filter((x) => x.row.kind === "missing" || (x.row.kind === "check" && verdicts[x.i] === false));
  const toLike = indexed
    .filter((x) => x.row.kind === "match" || (x.row.kind === "check" && verdicts[x.i] === true))
    .map((x) => x.row.track!);
  const missingEntries = missing.map((x) => x.row.entry);

  const pick = (): void => fileInput.current?.click();

  const addToLiked = (): void => {
    const added = useLibrary.getState().importLikes(toLike);
    toast(
      added > 0
        ? `Added ${added} ${added === 1 ? "song" : "songs"} to Liked Songs, in Spotify's order`
        : "Your Liked Songs now follow Spotify's order",
      "success"
    );
  };

  const saveList = async (): Promise<void> => {
    try {
      const saved = await window.bytune?.saveTextFile("Spotify songs to buy.csv", shoppingListCsv(missingEntries));
      if (saved) toast(`Saved the list of ${missingEntries.length} songs`, "success");
    } catch {
      toast("Couldn't save the list", "error");
    }
  };

  const copyList = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(shoppingListText(missingEntries));
      toast(`Copied ${missingEntries.length} ${missingEntries.length === 1 ? "song" : "songs"}`);
    } catch {
      toast("Couldn't copy the list", "error");
    }
  };

  return (
    <div className="space-y-6 pb-14">
      <input
        ref={fileInput}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            setTab("have");
            void load(file);
          }
        }}
      />
      <header className="pt-2">
        <h1 className="font-display text-[34px] font-extrabold tracking-[-0.03em] text-ink-hi">Import from Spotify</h1>
        <p className="text-[14px] text-ink-dim mt-2 max-w-[760px]">
          Bring your Spotify Liked Songs over: see which songs you already have, add them to your Liked Songs in
          Spotify's order, and keep a list of the ones you still want to buy.
        </p>
      </header>

      {!entries.length ? (
        <HowToExport onPick={pick} error={error} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-dim">
            <span className="text-ink-hi font-semibold">{fileName}</span>
            <span>
              · {entries.length} {entries.length === 1 ? "song" : "songs"} ·{" "}
              {dated ? "in the order you liked them" : "in the file's order (no like dates)"}
            </span>
            <div className="ml-auto flex gap-2">
              <Btn variant="glass" size="sm" icon={FileUp} onClick={pick}>
                Choose another file
              </Btn>
              <Btn variant="glass" size="sm" icon={RotateCcw} onClick={reset}>
                Start over
              </Btn>
            </div>
          </div>
          {error && <p className="text-[13px] text-red-400">{error}</p>}

          <div className="flex flex-wrap gap-3">
            <Stat label="In your library" value={have.length} tone="text-emerald-400" active={tab === "have"} onClick={() => setTab("have")} />
            <Stat
              label={undecided ? `To check · ${undecided} open` : "Checked"}
              value={check.length}
              tone="text-amber-300"
              active={tab === "check"}
              onClick={() => setTab("check")}
            />
            <Stat label="Missing — to buy" value={missing.length} tone="text-ink-hi" active={tab === "missing"} onClick={() => setTab("missing")} />
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-ink-hi/[0.04] p-4">
            <Btn variant="white" icon={Heart} onClick={addToLiked} disabled={!toLike.length}>
              Add {toLike.length} to Liked Songs
            </Btn>
            <p className="text-[13px] text-ink-dim flex-1 min-w-[240px]">
              In Spotify's order, newest first. Songs you liked in ByTune keep their place on top
              {undecided ? `; the ${undecided} still to check stay out until you decide` : ""}.
            </p>
            <Btn variant="glass" size="sm" onClick={() => navigate({ name: "library", param: "liked" })}>
              Open Liked Songs
            </Btn>
          </div>

          {tab === "have" && (
            <TrackList
              tracks={have.map((x) => x.row.track!)}
              showAlbum
              emptyTitle="None of these songs are in your library yet"
              emptyLabel="Add music folders or connect your server — songs you add show up here by themselves."
            />
          )}

          {tab === "check" && (
            <section className="space-y-3">
              {check.length === 0 ? (
                <p className="text-[14px] text-ink-dim">Every song matched clearly — nothing to check.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] text-ink-dim mr-auto">
                      These look like songs you have, but something differs. Same song → Liked Songs; different → the
                      shopping list.
                    </p>
                    <Btn variant="glass" size="sm" icon={Check} onClick={() => setVerdicts(check.map((x) => x.i), true)}>
                      All the same
                    </Btn>
                    <Btn variant="glass" size="sm" icon={X} onClick={() => setVerdicts(check.map((x) => x.i), false)}>
                      All different
                    </Btn>
                  </div>
                  {check.map(({ row, i }) => {
                    const verdict = verdicts[i];
                    const t = row.track!;
                    return (
                      <div
                        key={i}
                        className={`flex flex-wrap items-center gap-4 rounded-xl p-3 transition-colors ${
                          verdict === undefined ? "bg-ink-hi/[0.05]" : "bg-ink-hi/[0.025]"
                        }`}
                      >
                        <div className="flex-1 min-w-[280px] grid grid-cols-2 gap-4">
                          <div className="min-w-0">
                            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Spotify</div>
                            <div className="text-[14px] font-semibold text-ink-hi truncate">{row.entry.title}</div>
                            <div className="text-[12.5px] text-ink-dim truncate">
                              {row.entry.artists.join(", ")}
                              {row.entry.album ? ` · ${row.entry.album}` : ""}
                              {row.entry.durationMs ? ` · ${fmtTime(row.entry.durationMs / 1000)}` : ""}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Your library</div>
                            <div className="text-[14px] font-semibold text-ink-hi truncate">{t.title}</div>
                            <div className="text-[12.5px] text-ink-dim truncate">
                              {t.artist}
                              {t.album ? ` · ${t.album}` : ""}
                              {t.duration ? ` · ${fmtTime(t.duration)}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="w-44 text-[12px] text-amber-300/90">{row.reason ? REASON[row.reason] : ""}</div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setVerdict(i, true)}
                            aria-pressed={verdict === true}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors ${
                              verdict === true ? "bg-emerald-400 text-black" : "bg-ink-hi/[0.08] text-ink-hi hover:bg-ink-hi/[0.14]"
                            }`}
                          >
                            Same song
                          </button>
                          <button
                            onClick={() => setVerdict(i, false)}
                            aria-pressed={verdict === false}
                            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors ${
                              verdict === false ? "bg-ink-hi text-black" : "bg-ink-hi/[0.08] text-ink-hi hover:bg-ink-hi/[0.14]"
                            }`}
                          >
                            Different
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </section>
          )}

          {tab === "missing" && (
            <section className="space-y-3">
              {missing.length === 0 ? (
                <p className="text-[14px] text-ink-dim">You have every one of these songs.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] text-ink-dim mr-auto">
                      Songs not in your library{dated ? ", newest like first" : ""}. The list saves as a spreadsheet that
                      opens in Excel.
                    </p>
                    <Btn variant="white" size="sm" icon={FileDown} onClick={() => void saveList()}>
                      Save as list…
                    </Btn>
                    <Btn variant="glass" size="sm" icon={Copy} onClick={() => void copyList()}>
                      Copy
                    </Btn>
                  </div>
                  <div>
                    <div className="flex items-center gap-3 px-3 pb-2.5 mb-1 border-b border-ink-hi/[0.06] text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-ghost">
                      <div className="w-8 shrink-0">#</div>
                      <div className="flex-1 min-w-0">Title</div>
                      <div className="w-56 hidden lg:block">Album</div>
                      <div className="w-28 hidden md:block">Liked</div>
                      <div className="w-8" />
                    </div>
                    {missing.map(({ row, i }, n) => {
                      const link = spotifyLink(row.entry.uri);
                      return (
                        <div key={i} className="flex items-center gap-3 h-[52px] px-3 rounded-lg hover:bg-ink-hi/[0.05]">
                          <div className="w-8 shrink-0 text-[13px] text-ink-faint tabular-nums">{n + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[14.5px] font-semibold text-ink-hi truncate">{row.entry.title}</div>
                            <div className="text-[13px] text-ink-dim truncate">{row.entry.artists.join(", ")}</div>
                          </div>
                          <div className="w-56 hidden lg:block text-[12.5px] text-ink-faint truncate">{row.entry.album}</div>
                          <div className="w-28 hidden md:block text-[12.5px] text-ink-faint tabular-nums">{likedOn(row.entry.addedAt)}</div>
                          <div className="w-8 flex justify-end">
                            {link && (
                              <button
                                onClick={() => window.open(link, "_blank")}
                                title="Open in Spotify"
                                aria-label={`Open ${row.entry.title} in Spotify`}
                                className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
