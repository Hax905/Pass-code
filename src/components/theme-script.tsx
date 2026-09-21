// Applies the saved colour scheme before the browser paints.
//
// The scheme lives in localStorage, which the server cannot read, so the HTML
// is always sent in the light theme. This script runs synchronously while the
// document is still being parsed — before the first paint and long before
// React hydrates — so a dark-mode user never sees a white flash.
// See node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
//
// The page inherits the system preference until someone picks a side; from
// then on their choice wins.

export const THEME_STORAGE_KEY = "passcode-theme";

// Kept as a single expression so it stays small in <head>. The try/catch
// matters: reading localStorage throws outright in some privacy modes, and a
// theme preference must never be able to break the page.
const SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
