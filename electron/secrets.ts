/**
 * Secret storage — wraps Electron's safeStorage (DPAPI on Windows, Keychain
 * on macOS, libsecret on Linux) so credentials never sit in the JSON stores
 * as plaintext. Values come back prefixed: `enc:` = safeStorage ciphertext,
 * `plain:` = sealed by a fallback because the OS facility was unavailable.
 * Unprefixed legacy values are treated as plaintext during the migration
 * window and re-sealed on their next save.
 */
import { safeStorage } from "electron";

/**
 * Whether the OS really seals. On Linux without a keyring (GNOME Keyring,
 * KWallet) Chromium falls back to "basic_text", a fixed key everyone knows —
 * such a value is kept as what it is, `plain:`, and sealed properly on its
 * first save once a keyring is there.
 */
function canSeal(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

export function sealSecret(value: string): string {
  if (!value) return "";
  if (!canSeal()) return `plain:${value}`;
  return `enc:${safeStorage.encryptString(value).toString("base64")}`;
}

export function openSecret(sealed: string | null | undefined): string {
  if (!sealed) return "";
  if (sealed.startsWith("enc:")) {
    try {
      return safeStorage.decryptString(Buffer.from(sealed.slice(4), "base64"));
    } catch {
      // Undecryptable (OS user change, moved profile) — treat as gone rather
      // than crash; the user re-authenticates.
      return "";
    }
  }
  if (sealed.startsWith("plain:")) return sealed.slice(6);
  // Legacy plaintext written before this module existed.
  return sealed;
}
