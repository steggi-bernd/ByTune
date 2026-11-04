import { T } from "./i18n";
/**
 * The lyric lookup's stand-in copy, BitChord mobile's own word lists
 * (strings.xml `lyrics_intro_lines` / `lyrics_loading_lines`).
 *
 * While a lookup is in flight the loading view shows one of the loading
 * lines instead of a bare spinner, and the player strip shows one of the
 * intro lines while the song is still building toward its first sung line.
 * Callers pick once per track (memo keyed on the track id) and hold the
 * line there — the way the phone keys its pick to the track so the copy
 * never flickers on recomposition.
 */

export const LYRICS_LOADING_LINES: string[] = [
  T("Getting the lyrics"),
  T("Finding the words"),
  T("Fetching the verses"),
  T("Lyrics are loading"),
  T("Checking the lyric sheet"),
  T("Searching the songbook"),
  T("Lining up the lyrics"),
  T("Words are on the way"),
  T("Checking the archives"),
  T("Finding the right words"),
  T("Lyrics are coming together"),
  T("Almost found the words"),
];

export const LYRICS_INTRO_LINES: string[] = [
  T("The beat is landing"),
  T("The song is starting"),
  T("Warming up"),
  T("Setting the mood"),
  T("Bass first, words later"),
  T("Wait for it"),
  T("Feel that build"),
  T("Just the groove for now"),
  T("The hook is on the way"),
  T("Let it breathe"),
  T("Cue the vocals"),
  T("First notes in"),
];

export function pickLyricsLine(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)] ?? list[0];
}
