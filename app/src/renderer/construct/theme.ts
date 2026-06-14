export type ThemeMode = "light" | "dark" | "system";

export function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem("construct.theme") as ThemeMode | null;
  if (saved === "light" || saved === "dark" || saved === "system") {
    return saved;
  }
  return "system";
}

export function resolveActiveTheme(theme: ThemeMode): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function applyDocumentTheme(active: "light" | "dark"): void {
  const root = document.documentElement;
  root.dataset.constructTheme = active;
  root.dataset.opalineTheme = active;
  root.dataset.theme = active;
  root.classList.toggle("dark", active === "dark");
  root.style.colorScheme = active;

  if (document.body) {
    document.body.dataset.constructTheme = active;
    document.body.dataset.opalineTheme = active;
    document.body.dataset.theme = active;
    document.body.classList.toggle("dark", active === "dark");
    document.body.style.colorScheme = active;
  }
}

