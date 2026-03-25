const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const themeLabel = document.querySelector("[data-theme-label]");
const themeIcon = document.querySelector("[data-theme-icon]");
const storageKey = "construct-coming-soon-theme";

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;

  if (themeLabel) {
    themeLabel.textContent = theme === "dark" ? "Dark" : "Light";
  }

  if (themeIcon) {
    themeIcon.textContent = theme === "dark" ? "◐" : "◑";
  }
}

function resolveInitialTheme() {
  const stored = window.localStorage.getItem(storageKey);

  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let currentTheme = resolveInitialTheme();
applyTheme(currentTheme);

themeToggle?.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  window.localStorage.setItem(storageKey, currentTheme);
  applyTheme(currentTheme);
});
