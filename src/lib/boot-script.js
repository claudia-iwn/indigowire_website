/**
 * The one inline script in <head> (N5), as text. It has to run before first paint, so it
 * can't be a bundled module. BaseLayout prints it with set:html, and astro.config.mjs
 * hashes this same string into the Content Security Policy, so the hash can never go
 * stale: edit the script here and both follow.
 */
export const BOOT_SCRIPT = `
// Mark that JavaScript runs, so the header can show its JS-only buttons before first paint.
document.documentElement.classList.add('js');
// Apply a saved light/dark choice (and text effects off) before first paint so the page never flashes (N5).
try {
  const theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  // Text effects turned off with the header toggle (Decrypt.astro checks this).
  if (localStorage.getItem('effects') === 'off') document.documentElement.dataset.effects = 'off';
} catch {
  // storage blocked: follow the OS theme
}
`;
