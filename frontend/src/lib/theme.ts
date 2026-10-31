export type Theme = "light" | "dark";
const STORAGE_KEY = "journaly.theme";

/** Saved choice, else light (the original look). Storage can be unavailable; that just means "light". */
export function loadTheme(): Theme {
  try { return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* preference simply isn't remembered */ }
}
