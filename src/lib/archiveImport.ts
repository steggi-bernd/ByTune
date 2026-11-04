/**
 * Bought music into the library (electron/archive-import.ts): pick a store's
 * ZIP or drop it anywhere on the window, choose the library folder when
 * there are several, unpack, rescan — the new songs then move from "Missing"
 * to "In your library" in the Spotify import by themselves.
 */
import { FolderOpen } from "lucide-react";
import type { LocalFolderEntry } from "../../electron/local-library";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import { ipcErrorText } from "./ipcError";
import { T } from "./i18n";

/**
 * Where a bought album may go: the folders the user picked. Not the
 * subfolders a picked folder lists as collections of their own (an artist's
 * folder is no place for another artist's album), and not the offline
 * downloads folder while there is another.
 */
export function importTargets<F extends { path: string }>(folders: F[]): F[] {
  // Windows paths compare without case and with either slash.
  const key = (p: string): string => {
    const bare = p.replace(/[\\/]+$/, "");
    return /^([a-z]:|\\\\)/i.test(bare) ? bare.toLowerCase().replace(/\//g, "\\") : bare;
  };
  const inside = (child: string, parent: string): boolean => {
    const c = key(child);
    const p = key(parent);
    return c !== p && (c.startsWith(`${p}\\`) || c.startsWith(`${p}/`));
  };
  const picked = folders.filter((f) => !folders.some((o) => inside(f.path, o.path)));
  const kept = picked.filter((f) => !/[\\/](?:ByTune|Songsta) Offline$/i.test(f.path.replace(/[\\/]+$/, "")));
  return kept.length ? kept : picked;
}

export async function importPurchase(zipPath?: string, at?: { x: number; y: number }): Promise<void> {
  const bridge = window.bytune;
  if (!bridge) return;
  const ui = useUI.getState();
  const file = zipPath ?? (await bridge.pickArchive().catch(() => null));
  if (!file) return;
  const lib = await bridge.localLibrary();
  const folders = importTargets(
    ((lib?.folders ?? []) as (LocalFolderEntry | string)[]).map((f) =>
      typeof f === "string" ? { path: f, name: f } : { path: f.path, name: f.displayName ?? f.name }
    )
  );
  if (!folders.length) {
    ui.toast(T("Add a music folder first — Local Music → Add folders"), "info");
    return;
  }
  const name = file.split(/[\\/]/).pop() ?? file;
  const unpack = async (folder: { path: string; name: string }): Promise<void> => {
    ui.toast(T("Unpacking \"{name}\"…", { name }), "info");
    try {
      const res = await bridge.importArchive(file, folder.path);
      const scanned = await bridge.scanLibrary(useSettings.getState().filterNonMusicAudio);
      window.dispatchEvent(new CustomEvent("bytune:local-library-updated", { detail: scanned }));
      const album = res.folder.split(/[\\/]/).pop();
      ui.toast(T("Added {songs} song{value} — \"{album}\" in {name}", { songs: res.songs, value: res.songs === 1 ? "" : "s", album, name: folder.name }), "success");
    } catch (err) {
      ui.toast(ipcErrorText(err, T("Couldn't import that archive")), "error");
    }
  };
  if (folders.length === 1) {
    await unpack(folders[0]);
    return;
  }
  ui.openContextMenu(
    at?.x ?? window.innerWidth / 2,
    at?.y ?? window.innerHeight / 3,
    folders.map((f) => ({ label: T("Into \"{name}\"", { name: f.name }), icon: FolderOpen, action: () => void unpack(f) }))
  );
}

/** ZIPs dropped anywhere on the window are imported; other files are left alone, never opened as a page. */
export function watchArchiveDrops(): () => void {
  const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file");
  const onDragOver = (e: DragEvent): void => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onDrop = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const zips = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.zip$/i.test(f.name));
    if (!zips.length) {
      useUI.getState().toast(T("Drop a store's ZIP here to add the album to your library"), "info");
      return;
    }
    for (const zip of zips) {
      const file = window.bytune?.pathForFile(zip);
      if (file) void importPurchase(file, { x: e.clientX, y: e.clientY });
    }
  };
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);
  return () => {
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
  };
}
