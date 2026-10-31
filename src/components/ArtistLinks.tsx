/**
 * A credit line as links: every credited artist opens their own page —
 * "A, B feat. C" is three links with the separators between them, never one
 * page for the whole line. Inline spans, so a long line still truncates with
 * an ellipsis; clicks stop at the link, so the row or card around it doesn't
 * also play or open.
 */
import { Fragment, type KeyboardEvent, type MouseEvent } from "react";
import { artistRoute, creditParts } from "../lib/libraryTracks";
import { useUI } from "../stores/ui";

export function ArtistLinks({ artist, className = "" }: { artist: string; className?: string }) {
  const navigate = useUI((s) => s.navigate);
  return (
    <>
      {creditParts(artist).map((p, i) => {
        const go = (e: MouseEvent | KeyboardEvent): void => {
          e.stopPropagation();
          navigate({ name: "artist", param: artistRoute(p.name) });
        };
        return (
          <Fragment key={`${p.name}-${i}`}>
            <span
              role="link"
              tabIndex={0}
              onClick={go}
              onKeyDown={(e) => {
                if (e.key === "Enter") go(e);
              }}
              className={`cursor-pointer hover:underline ${className}`}
            >
              {p.name}
            </span>
            {p.sep}
          </Fragment>
        );
      })}
    </>
  );
}
