/** The desktop app's look on the phone: black canvas, white controls, one accent. */
export const colors = {
  base: "#000000",
  panel: "#1C1C1E",
  sheet: "#1F1F21",
  button: "#3A3A3D",
  tile: "rgba(255,255,255,0.11)",
  chip: "rgba(255,255,255,0.13)",
  hairline: "rgba(255,255,255,0.08)",
  ink: "#FFFFFF",
  soft: "#C7C7CC",
  dim: "#A1A1A6",
  accent: "#A78BFA",
  onAccent: "#120B24",
  hiRes: "#E7C67B",
  onHiRes: "#1B1204",
  mutedSong: "#E8A0A0",
};

/** What's playing, in signal colours: gold for lossless, down to red for what you can hear is small. */
export const qualityColors = {
  lossless: colors.hiRes,
  high: "#7FD68E",
  good: "#B7D36B",
  low: "#F0A05A",
  poor: "#EF7064",
};

/** What floats over the bottom of a page: the mini player and the tab bar. */
export const TAB_BAR_HEIGHT = 58;
export const MINI_PLAYER_HEIGHT = 58;
/** Room a scrolling page leaves at its end, under the insets. */
export const PAGE_END = TAB_BAR_HEIGHT + MINI_PLAYER_HEIGHT + 24;
