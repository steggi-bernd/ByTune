/**
 * Pure filesystem-path helpers shared by the main process and the renderer's
 * Local Music view. No `electron` imports here: the renderer bundles this
 * file (it can only import electron/local-library.ts as *types*), so both
 * sides must agree on folder scoping without pulling node's path module in.
 */

/** The platform: process.platform in the main process, the browser's own name for it in the renderer. */
function platformName(): string {
  if (typeof process !== "undefined" && typeof process.platform === "string") return process.platform;
  return typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
}

/**
 * How one platform compares paths. Linux tells "Musik" and "musik" apart —
 * two folders — and a backslash is just a character in a name there.
 * Windows and macOS (by default) ignore case, and their paths compare
 * exactly as they always have: lower-cased, either slash. The track ids hash
 * a path folded this way, so off Linux the folding must never change.
 */
export function pathRules(platform: string) {
  const linux = platform.startsWith("linux");
  const foldPathCase = (p: string): string => (linux ? p : p.toLowerCase());
  // Back- and forward-slash roots (e.g. stored by older versions) compare equal off Linux.
  const pathKey = (p: string): string => {
    const s = String(p ?? "");
    return foldPathCase((linux ? s : s.replace(/\\/g, "/")).replace(/\/+$/, ""));
  };
  return {
    /** A path with its case folded where case doesn't count (the form the track ids hash). */
    foldPathCase,
    /**
     * True when `child` is `root` itself or lives anywhere inside it — so a
     * folder can never claim the same file twice under different casing
     * where casing doesn't count.
     */
    isUnderPath(child: string, root: string): boolean {
      const c = pathKey(child);
      const r = pathKey(root);
      if (!c || !r) return false;
      if (c === r) return true;
      return c.startsWith(r + "/");
    },
    /** The same file or folder, however it is written (slashes, a trailing one, case where it doesn't count). */
    samePath(a: string, b: string): boolean {
      const x = pathKey(a);
      return !!x && x === pathKey(b);
    },
  };
}

/** This system's rules. */
export const { foldPathCase, isUnderPath, samePath } = pathRules(platformName());
