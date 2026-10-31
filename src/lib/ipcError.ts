/** "Error invoking remote method '…': Error: The real message" → "The real message". */
export function ipcErrorText(err: unknown, fallback: string): string {
  const text = err instanceof Error ? err.message : "";
  return text.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "") || fallback;
}
