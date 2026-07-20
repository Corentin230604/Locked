/** Keeps a name filesystem-safe across the storage path and any
 * Content-Disposition header built from it. */
export function sanitizeFilename(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned || "fichier";
}
