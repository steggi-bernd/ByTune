import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCyrillic, toLatin } from "../.test-build/transliterate.mjs";

test("Russian reads the way song titles spell it", () => {
  assert.equal(toLatin("Звёздное лето"), "Zvyozdnoe leto");
  assert.equal(toLatin("Трава у дома"), "Trava u doma");
  assert.equal(toLatin("Комарово"), "Komarovo");
  assert.equal(toLatin("Арлекино"), "Arlekino");
  assert.equal(toLatin("Если б не было тебя"), "Yesli b ne bylo tebya");
  assert.equal(toLatin("Ещё одна жизнь, счастье и любовь"), "Yeshchyo odna zhizn, schastye i lyubov");
  assert.equal(toLatin("Новый день"), "Novy den");
});

test("capitals stay capitals; Latin, digits and punctuation pass through", () => {
  assert.equal(toLatin("ЖИЗНЬ"), "ZHIZN");
  assert.equal(toLatin("Жизнь"), "Zhizn");
  assert.equal(toLatin("Я"), "Ya");
  assert.equal(toLatin("Хорошо — OK! 2024 (ремикс)"), "Khorosho — OK! 2024 (remiks)");
});

test("Ukrainian, Bulgarian and Serbian letters read as their own languages do", () => {
  assert.equal(toLatin("Гарна дівчина"), "Harna divchyna");
  assert.equal(toLatin("Їжак"), "Yizhak");
  assert.equal(toLatin("България щастие"), "Balgariya shtastie");
  assert.equal(toLatin("Љубав и њега"), "Ljubav i njega");
});

test("only text with Cyrillic in it gets a Latin line", () => {
  assert.equal(hasCyrillic("Komarovo (DVRST Phonk Remix)"), false);
  assert.equal(hasCyrillic("Комарово"), true);
});
