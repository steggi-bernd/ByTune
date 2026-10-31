/**
 * Cyrillic in Latin letters, to read along with lyrics (Settings → Lyrics).
 * The international style song titles already use — "Zvyozdnoe Leto",
 * "Trava u Doma": ж zh, х kh, ц ts, ч ch, ш sh, щ shch, ю yu, я ya, ё yo, е
 * ye where a word starts with it, the soft and hard signs silent.
 *
 * A text's own letters say which language it is closest to: Ukrainian (і ї
 * є ґ) reads г as h and и as y; Bulgarian (ъ inside words, no ы э ё) reads щ
 * as sht and ъ as a; Serbian and Macedonian letters have their usual forms.
 * Capitals stay capitals, and an all-caps word stays all caps.
 */
const LETTERS: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "",
  ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // Ukrainian, Belarusian
  і: "i", ї: "yi", є: "ye", ґ: "g", ў: "w",
  // Serbian, Macedonian
  ђ: "dj", ј: "j", љ: "lj", њ: "nj", ћ: "c", џ: "dz", ѓ: "gj", ќ: "kj", ѕ: "dz",
};

const isLetter = (ch: string | undefined): boolean => !!ch && /\p{L}/u.test(ch);
const isUpper = (ch: string | undefined): boolean => !!ch && ch !== ch.toLowerCase();

export function hasCyrillic(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text);
}

export function toLatin(text: string): string {
  const ukrainian = /[іїєґ]/i.test(text);
  const bulgarian = !ukrainian && !/[ыэё]/i.test(text) && /ъ[а-я]/i.test(text);
  const chars = [...text];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const lower = ch.toLowerCase();
    let latin = LETTERS[lower];
    if (latin === undefined) {
      out += ch;
      continue;
    }
    const prev = chars[i - 1]?.toLowerCase();
    if (ukrainian && lower === "г") latin = "h";
    else if (ukrainian && lower === "и") latin = "y";
    else if (bulgarian && lower === "щ") latin = "sht";
    else if (bulgarian && lower === "ъ") latin = "a";
    else if (lower === "е" && !bulgarian && (!isLetter(prev) || prev === "ъ" || prev === "ь")) latin = "ye";
    else if (lower === "й" && prev === "ы" && !isLetter(chars[i + 1])) latin = "";
    if (isUpper(ch) && latin) {
      // ЖИЗНЬ → ZHIZN, Жизнь → Zhizn
      const shout = (isUpper(chars[i + 1]) && isLetter(chars[i + 1])) || (isUpper(chars[i - 1]) && isLetter(chars[i - 1]));
      latin = shout ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1);
    }
    out += latin;
  }
  return out;
}
