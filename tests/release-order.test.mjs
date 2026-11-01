// The discography's "newest first" (src/lib/releases.ts): each release's place in time
// (releaseOrder — its day, or its year alone, with a series' parts kept in their numbers' order),
// then a series' parts highest first — and the release days the sources give (release-date.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { compareReleases, releaseDate, releaseOrder } from "../.test-build/releases.mjs";
import { isoDate } from "../.test-build/release-date.mjs";

// As the catalogue does it: places for the whole list first, then the sort.
const order = (list) => {
  const places = releaseOrder(list);
  return list.map((r, i) => ({ ...r, order: places[i] })).sort(compareReleases).map((r) => r.title);
};

test("same year, no days known: a series runs from its highest part down (Season 9 before Season 6)", () => {
  const seasons = [6, 7, 8, 9].map((n) => ({ title: `Show (Soundtrack) Season ${n}`, year: 2020 }));
  assert.deepEqual(order(seasons), [9, 8, 7, 6].map((n) => `Show (Soundtrack) Season ${n}`));
  // Two digits sort as numbers, not as text ("Season 10" is not between 1 and 2).
  assert.deepEqual(order([{ title: "Season 2", year: 2020 }, { title: "Season 10", year: 2020 }, { title: "Season 1", year: 2020 }]), ["Season 10", "Season 2", "Season 1"]);
});

test("the day decides within a year; a known day goes before the year alone — but a series keeps its order", () => {
  const list = [
    { title: "Season 1", year: 2019, date: "2019-02-01" },
    { title: "Show EP", year: 2019, date: "2019-11-20" },
    { title: "Show Soundtrack", year: 2019, date: "2019-06-07" },
    { title: "Season 3", year: 2019 },
    { title: "Season 12", year: 2023, date: "2023-05-05" },
    { title: "Season 11", year: 2022 },
    { title: "Untitled", year: undefined },
  ];
  // Season 3 has no day, but it can't have come out before Season 1: right after it.
  assert.deepEqual(order(list), ["Season 12", "Season 11", "Show EP", "Show Soundtrack", "Season 3", "Season 1", "Untitled"]);
  // Without a series around it, a release with only a year goes after the dated ones of that year.
  assert.deepEqual(order([{ title: "Blue", year: 2019 }, { title: "Red", year: 2019, date: "2019-03-01" }]), ["Red", "Blue"]);
});

test("THE FINALS: Jellyfin's 1 January is no day, and the seasons stay in order", () => {
  // As a Jellyfin library lists them: a real day for some, 1 January (the year only) for the rest.
  const t = (title, year, date) => ({ title: `THE FINALS (${title} Original Soundtrack)`, artist: "Embark Studios", year, date: releaseDate([{ date }], year) });
  const list = [
    t("S11", 2026, "2026-01-01"),
    t("PRIME TIME", 2026, "2026-01-01"),
    t("S3", 2024, "2024-06-13"),
    t("S4", 2024, "2024-01-01"),
    t("S5", 2024, "2024-01-01"),
    t("S6", 2025, "2025-01-01"),
    t("S7", 2025, "2025-06-12"),
    t("S8", 2025, "2025-09-10"),
    t("S9", 2025, "2025-01-01"),
    { title: "ABSORBE", artist: "Embark Studios", year: 2024, date: "2024-11-14" },
    { title: "THE_FINALS_CNS.lha", artist: "Embark Studios", year: 2024, date: "2024-03-14" },
  ];
  assert.deepEqual(
    order(list).map((x) => x.replace(/^THE FINALS \((.*) Original Soundtrack\)$/, "$1")),
    ["PRIME TIME", "S11", "S9", "S8", "S7", "S6", "ABSORBE", "S5", "S4", "S3", "THE_FINALS_CNS.lha"]
  );
});

test("other titles keep alphabetical order", () => {
  assert.deepEqual(order([{ title: "Blue", year: 2001 }, { title: "Amber", year: 2001 }, { title: "Crimson", year: 2001 }]), ["Amber", "Blue", "Crimson"]);
});

test("a release's day: the most precise one in its own year, never a reissue's", () => {
  const t = (over) => ({ id: "x", title: "t", artist: "a", duration: 1, thumb: "", ...over });
  assert.equal(releaseDate([t({ date: "2019-05" }), t({ date: "2019-05-03" })], 2019), "2019-05-03");
  assert.equal(releaseDate([t({ date: "2019-06-01" }), t({ date: "2019-05-03" })], 2019), "2019-05-03");
  // The remaster's own day (2011) says nothing about the 1973 album.
  assert.equal(releaseDate([t({ year: 2011, date: "2011-09-26", originalYear: 1973 })], 1973), undefined);
  assert.equal(releaseDate([t({ originalDate: "1973-03-01", date: "2011-09-26" })], 1973), "1973-03-01");
  assert.equal(releaseDate([t({ date: "2019" })], 2019), undefined);
  // 1 January is what a server fills in when only the year is known.
  assert.equal(releaseDate([t({ date: "2025-01-01" })], 2025), undefined);
  assert.equal(releaseDate([t({ date: "2025-01-01" }), t({ date: "2025-01-02" })], 2025), "2025-01-02");
  assert.equal(releaseDate([t({ date: "2019-05-03" })], undefined), undefined);
});

test("release days from tags, Jellyfin and OpenSubsonic come out as YYYY-MM-DD", () => {
  assert.equal(isoDate("2019-05-03"), "2019-05-03");
  assert.equal(isoDate("2019-05-03T00:00:00.0000000Z"), "2019-05-03");
  assert.equal(isoDate("2019-5-3"), "2019-05-03");
  assert.equal(isoDate("2019-05"), "2019-05");
  assert.equal(isoDate("2019"), "2019");
  assert.equal(isoDate({ year: 2019, month: 5, day: 3 }), "2019-05-03");
  assert.equal(isoDate({ year: 2019 }), "2019");
  assert.equal(isoDate("0001-01-01T00:00:00Z"), undefined); // Jellyfin's "no date"
  assert.equal(isoDate("2019-13-40"), "2019");
  assert.equal(isoDate("May 2019"), undefined);
  assert.equal(isoDate(undefined), undefined);
  assert.equal(isoDate(2019), undefined);
});
