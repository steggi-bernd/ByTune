/** Small JSON files in the app's own folder: the library's copy and where the player stopped. */
import { File, Paths } from "expo-file-system";

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const file = new File(Paths.document, name);
    return file.exists ? (JSON.parse(await file.text()) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(name: string, value: unknown): void {
  try {
    const file = new File(Paths.document, name);
    if (!file.exists) file.create();
    file.write(JSON.stringify(value));
  } catch {
    /* a copy for next time: the app runs on without it */
  }
}

export function removeJson(name: string): void {
  try {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  } catch {
    /* gone either way next time it is written */
  }
}
