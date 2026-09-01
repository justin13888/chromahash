/**
 * HTML escaping for the report.
 *
 * Image names reach the page from `--images`, which is an arbitrary
 * user-supplied glob, so a filename containing `&` or `<` would otherwise emit
 * malformed markup.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
