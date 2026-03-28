/** Returns just the filename from an absolute path (cross-platform). */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
