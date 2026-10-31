/**
 * Where a missing song can be bought — search links for download stores,
 * next to the Spotify import's "Missing — to buy" list. Off unless Settings
 * (or the list itself) switches them on.
 *
 * Qobuz leads for Hi-Res downloads, Bandcamp pays artists the most, 7digital
 * and Amazon cover what the others lack. Each link is a plain search for the
 * lead artist and title in the store of the user's country; no store learns
 * anything until a link is opened.
 */

export interface StoreLink {
  store: string;
  url: string;
}

/** Qobuz's storefront per country (it wants country + language). */
const QOBUZ: Record<string, string> = {
  de: "de-de", at: "at-de", ch: "ch-de", lu: "lu-de", fr: "fr-fr", be: "be-fr", nl: "nl-nl", it: "it-it", es: "es-es",
  gb: "gb-en", ie: "ie-en", us: "us-en", ca: "ca-en", au: "au-en", nz: "nz-en", dk: "dk-en", se: "se-en", no: "no-en", fi: "fi-en",
};
const AMAZON: Record<string, string> = {
  de: "amazon.de", at: "amazon.de", ch: "amazon.de", fr: "amazon.fr", be: "amazon.fr", it: "amazon.it", es: "amazon.es",
  nl: "amazon.nl", gb: "amazon.co.uk", ie: "amazon.co.uk", us: "amazon.com", ca: "amazon.ca", au: "amazon.com.au", jp: "amazon.co.jp",
};
const SEVEN_DIGITAL: Record<string, string> = {
  de: "de", at: "de", ch: "de", fr: "fr", be: "fr", it: "it", es: "es", nl: "nl", gb: "uk", ie: "uk", us: "us", ca: "ca", au: "au",
};

/** "de-DE" → "de"; a bare language guesses its usual country ("de" → "de", "en" → "us"). */
function countryOf(locale: string): string {
  const [lang, region] = locale.toLowerCase().split(/[-_]/);
  if (region && /^[a-z]{2}$/.test(region)) return region;
  return { en: "us", de: "de", fr: "fr", it: "it", es: "es", nl: "nl", da: "dk", sv: "se", nb: "no", fi: "fi", ja: "jp" }[lang] ?? "us";
}

export function storeLinks(song: { title: string; artists: string[] }, locale = "en-US"): StoreLink[] {
  const query = [song.artists[0] ?? "", song.title].join(" ").replace(/\s+/g, " ").trim();
  const q = encodeURIComponent(query);
  const country = countryOf(locale);
  return [
    { store: "Qobuz", url: `https://www.qobuz.com/${QOBUZ[country] ?? "us-en"}/search/tracks/${q}` },
    { store: "Bandcamp", url: `https://bandcamp.com/search?q=${q}&item_type=t` },
    { store: "7digital", url: `https://${SEVEN_DIGITAL[country] ?? "us"}.7digital.com/search?q=${q}` },
    { store: "Amazon", url: `https://www.${AMAZON[country] ?? "amazon.com"}/s?k=${q}&i=digital-music` },
  ];
}
