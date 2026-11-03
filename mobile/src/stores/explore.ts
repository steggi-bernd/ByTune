/** What Explore was showing: tab, layout and every tab's order, remembered as on the desktop. */
import { create } from "zustand";
import { DEFAULT_EXPLORE_SORTS, type ExploreSort, type ExploreTab } from "../shared";
import { readJson, writeJson } from "../storage";

const FILE = "explore.json";

export type ExploreLayout = "list" | "grid";

interface Saved {
  tab: ExploreTab;
  layout: ExploreLayout;
  sorts: Record<ExploreTab, ExploreSort>;
}

interface ExploreState extends Saved {
  setTab(tab: ExploreTab): void;
  setLayout(layout: ExploreLayout): void;
  setSort(tab: ExploreTab, sort: ExploreSort): void;
}

export const useExplore = create<ExploreState>((set) => ({
  tab: "albums",
  layout: "grid",
  sorts: DEFAULT_EXPLORE_SORTS,
  setTab: (tab) => set({ tab }),
  setLayout: (layout) => set({ layout }),
  setSort: (tab, sort) => set((s) => ({ sorts: { ...s.sorts, [tab]: sort } })),
}));

void readJson<Saved>(FILE).then((saved) => {
  if (saved) useExplore.setState(saved);
});
useExplore.subscribe(({ tab, layout, sorts }) => writeJson(FILE, { tab, layout, sorts }));
