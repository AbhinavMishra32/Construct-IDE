import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDocker,
  faGitAlt,
  faGolang,
  faCss3Alt,
  faHtml5,
  faJava,
  faJs,
  faMarkdown,
  faNodeJs,
  faPhp,
  faPython,
  faReact,
  faRust,
  faSass,
  faSwift,
  faVuejs,
} from "@fortawesome/free-brands-svg-icons";
import {
  faFile as faRegularFile,
  faFolder as faRegularFolder,
} from "@fortawesome/free-regular-svg-icons";
import {
  faBookOpen,
  faCode,
  faDatabase,
  faFileAudio,
  faFileCode,
  faFileCsv,
  faFileExcel,
  faFileImage,
  faFileLines,
  faFilePdf,
  faFilePowerpoint,
  faFileVideo,
  faFileWord,
  faFileZipper,
  faGear,
  faLock,
  faTable,
  faTerminal,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

type IconOptions = {
  size?: number;
  type?: "file" | "directory";
};

type FileIconConfig = {
  color: string;
  icon: IconDefinition;
};

const PACKAGE_DIRECTORIES = new Set(["playground", "xcodeproj", "xcworkspace"]);
const NEUTRAL_ICON_COLOR = "color-mix(in srgb, var(--muted-foreground) 70%, transparent)";

const EXTENSION_ICONS: Record<string, FileIconConfig> = {
  "7z": { icon: faFileZipper, color: "#a16207" },
  avif: { icon: faFileImage, color: "#10b981" },
  bash: { icon: faTerminal, color: "#16a34a" },
  bat: { icon: faTerminal, color: "#16a34a" },
  c: { icon: faCode, color: "#5c6bc0" },
  cjs: { icon: faJs, color: "#e9c46a" },
  cmd: { icon: faTerminal, color: "#16a34a" },
  conf: { icon: faGear, color: "#6b7280" },
  cpp: { icon: faCode, color: "#00599c" },
  cs: { icon: faCode, color: "#68217a" },
  cts: { icon: faCode, color: "#3178c6" },
  csv: { icon: faFileCsv, color: "#15803d" },
  css: { icon: faCss3Alt, color: "#663399" },
  dart: { icon: faCode, color: "#0ea5e9" },
  db: { icon: faDatabase, color: "#336791" },
  dockerfile: { icon: faDocker, color: "#2496ed" },
  doc: { icon: faFileWord, color: "#2b579a" },
  docx: { icon: faFileWord, color: "#2b579a" },
  env: { icon: faLock, color: "#8a6f2a" },
  fish: { icon: faTerminal, color: "#16a34a" },
  gif: { icon: faFileImage, color: "#10b981" },
  git: { icon: faGitAlt, color: "#f05033" },
  go: { icon: faGolang, color: "#00add8" },
  gz: { icon: faFileZipper, color: "#a16207" },
  h: { icon: faCode, color: "#5c6bc0" },
  html: { icon: faHtml5, color: "#e34f26" },
  htm: { icon: faHtml5, color: "#e34f26" },
  icns: { icon: faFileImage, color: "#10b981" },
  ico: { icon: faFileImage, color: "#10b981" },
  ini: { icon: faGear, color: "#6b7280" },
  ipynb: { icon: faPython, color: "#3572a5" },
  java: { icon: faJava, color: "#b07219" },
  jpeg: { icon: faFileImage, color: "#10b981" },
  jpg: { icon: faFileImage, color: "#10b981" },
  js: { icon: faJs, color: "#e9c46a" },
  json: { icon: faFileCode, color: "#cb8e00" },
  jsonc: { icon: faFileCode, color: "#cb8e00" },
  jsx: { icon: faReact, color: "#61dafb" },
  key: { icon: faFilePowerpoint, color: "#d24726" },
  kt: { icon: faCode, color: "#0ea5e9" },
  kts: { icon: faCode, color: "#0ea5e9" },
  less: { icon: faCss3Alt, color: "#663399" },
  lock: { icon: faLock, color: "#64748b" },
  log: { icon: faFileLines, color: "#64748b" },
  lua: { icon: faCode, color: "#0ea5e9" },
  m: { icon: faCode, color: "#0ea5e9" },
  map: { icon: faFileCode, color: "#cb8e00" },
  md: { icon: faMarkdown, color: "#4d7bbd" },
  mdx: { icon: faMarkdown, color: "#4d7bbd" },
  mjs: { icon: faJs, color: "#e9c46a" },
  mm: { icon: faCode, color: "#0ea5e9" },
  mov: { icon: faFileVideo, color: "#a855f7" },
  mp3: { icon: faFileAudio, color: "#06b6d4" },
  mp4: { icon: faFileVideo, color: "#a855f7" },
  mts: { icon: faCode, color: "#3178c6" },
  ogg: { icon: faFileAudio, color: "#06b6d4" },
  pdf: { icon: faFilePdf, color: "#e11d48" },
  php: { icon: faPhp, color: "#777bb4" },
  plist: { icon: faTable, color: "#f05138" },
  png: { icon: faFileImage, color: "#10b981" },
  postcss: { icon: faCss3Alt, color: "#663399" },
  ppt: { icon: faFilePowerpoint, color: "#d24726" },
  pptx: { icon: faFilePowerpoint, color: "#d24726" },
  ps1: { icon: faTerminal, color: "#16a34a" },
  py: { icon: faPython, color: "#3572a5" },
  pyw: { icon: faPython, color: "#3572a5" },
  r: { icon: faCode, color: "#0ea5e9" },
  rar: { icon: faFileZipper, color: "#a16207" },
  rb: { icon: faCode, color: "#0ea5e9" },
  rs: { icon: faRust, color: "#dea584" },
  rtf: { icon: faFileWord, color: "#2b579a" },
  sass: { icon: faSass, color: "#663399" },
  scala: { icon: faCode, color: "#0ea5e9" },
  scss: { icon: faSass, color: "#663399" },
  sh: { icon: faTerminal, color: "#16a34a" },
  sqlite: { icon: faDatabase, color: "#336791" },
  sqlite3: { icon: faDatabase, color: "#336791" },
  sql: { icon: faDatabase, color: "#336791" },
  svg: { icon: faFileImage, color: "#ffb13b" },
  swift: { icon: faSwift, color: "#f05138" },
  tar: { icon: faFileZipper, color: "#a16207" },
  tgz: { icon: faFileZipper, color: "#a16207" },
  toml: { icon: faGear, color: "#6b7280" },
  ts: { icon: faCode, color: "#3178c6" },
  tsx: { icon: faReact, color: "#3178c6" },
  txt: { icon: faFileLines, color: "#64748b" },
  vue: { icon: faVuejs, color: "#42b883" },
  wav: { icon: faFileAudio, color: "#06b6d4" },
  webm: { icon: faFileVideo, color: "#a855f7" },
  webp: { icon: faFileImage, color: "#10b981" },
  xcodeproj: { icon: faSwift, color: "#f05138" },
  xcworkspace: { icon: faSwift, color: "#f05138" },
  xls: { icon: faFileExcel, color: "#217346" },
  xlsx: { icon: faFileExcel, color: "#217346" },
  yaml: { icon: faGear, color: "#6b7280" },
  yml: { icon: faGear, color: "#6b7280" },
  zip: { icon: faFileZipper, color: "#a16207" },
  zsh: { icon: faTerminal, color: "#16a34a" },
};

function extensionForName(filename: string) {
  const name = filename.split("/").pop() || filename;
  const lower = name.toLowerCase();

  if (lower === ".env" || lower.startsWith(".env.")) return "env";
  if (lower === ".gitattributes" || lower === ".gitignore") return "git";
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "package-lock.json") return "json";
  if (lower === "package.json") return "node";
  if (lower === "pnpm-lock.yaml" || lower === "yarn.lock") return "lock";
  if (lower === "readme" || lower.startsWith("readme.")) return "md";

  if (!lower.includes(".")) return lower;
  return lower.slice(lower.lastIndexOf(".") + 1);
}

function iconConfigForFile(filename: string, type?: "file" | "directory"): FileIconConfig {
  const extension = extensionForName(filename);

  if (type === "directory" && !PACKAGE_DIRECTORIES.has(extension)) {
    return { icon: faRegularFolder, color: NEUTRAL_ICON_COLOR };
  }

  if (extension === "node") {
    return { icon: faNodeJs, color: "#68a063" };
  }

  if (extension === "playground") {
    return { icon: faBookOpen, color: "#f05138" };
  }

  return EXTENSION_ICONS[extension] ?? { icon: faRegularFile, color: NEUTRAL_ICON_COLOR };
}

export function iconForFile(filename: string, options: IconOptions = {}) {
  const requestedSize = Math.max(10, (options.size ?? 17) - 1);
  const config = iconConfigForFile(filename, options.type);

  return (
    <FontAwesomeIcon
      aria-hidden="true"
      className="shrink-0"
      color={config.color}
      icon={config.icon}
      style={{ fontSize: requestedSize, height: requestedSize, width: requestedSize }}
    />
  );
}
