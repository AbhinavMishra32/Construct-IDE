/**
 * Every language server Construct knows how to obtain, as data.
 *
 * The point of this file is that adding a language is an entry here and nothing
 * else. Construct implements no language intelligence and no per-language
 * plumbing: it installs the canonical server the language's own community
 * maintains — the same binary Neovim, Helix and VS Code drive — and speaks LSP
 * to it. `LspService` spawns a command; `monaco-languageclient` speaks the
 * protocol. Neither knows what a language is.
 *
 * There is no package that ships every language server, and there is no
 * registry that installs them all the same way, so the honest shape is a
 * catalog with four acquisition routes:
 *
 *   bundled   — already an npm dependency of the app. Nothing to install, and
 *               the two languages a learner most often starts in are here so
 *               that a fresh Construct is useful before anybody visits
 *               Settings.
 *   npm       — installed into a Construct-owned prefix. Needs npm on PATH,
 *               which is stated in Settings rather than assumed.
 *   release   — a single binary from the project's own GitHub releases. No
 *               toolchain at all: download, extract, mark executable.
 *   toolchain — installed by the language's own tool (`go install`, `gem
 *               install`). Only used where the project publishes no binary,
 *               and always labelled with what it needs.
 *
 * Release assets are matched by pattern against the *latest* release rather
 * than pinned by filename. A pinned name carries a version in it, so every
 * upstream release would silently break the entry until somebody noticed.
 */

/** The platforms Construct resolves a release asset for. */
export type ServerPlatform = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "win32-x64";

export const SERVER_PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"] as const;

export type ServerSource =
  /** Resolved out of the app's own node_modules. */
  | { via: "bundled"; module: string; entry: string }
  /** `npm install <package>` into Construct's own prefix. */
  | { via: "npm"; package: string; bin: string }
  /** A binary from the project's GitHub releases. `match` is a regular
   *  expression tested against asset names; `bin` is the path to the executable
   *  inside the extracted archive, or the asset itself when it is a bare
   *  binary. */
  | { via: "release"; repo: string; match: Partial<Record<ServerPlatform, string>>; bin: string }
  /** The language's own installer. `probe` is the command that says whether
   *  the toolchain is even present. */
  | { via: "toolchain"; tool: string; probe: readonly string[]; install: readonly string[]; bin: string };

export type LanguageServerEntry = {
  /** Stable id. Used as the install directory name and as the settings key, so
   *  it never changes once shipped. */
  id: string;
  /** What it is called by the people who make it. */
  name: string;
  /** What it gives the learner, in one line, for Settings. */
  blurb: string;
  /** The languages it serves, as the ids Monaco uses. A server claims a file by
   *  extension; these are what the editor and the protocol call it. */
  languages: readonly string[];
  /** Extensions it claims, without the dot. First match wins, so a more
   *  specific server must come earlier in the catalog. */
  extensions: readonly string[];
  /** Arguments after the executable. Almost always the stdio flag — the
   *  protocol's default transport, and the only one Construct speaks. */
  args: readonly string[];
  source: ServerSource;
};

/**
 * Ordered, because extensions overlap. A `.ts` file is claimed by
 * typescript-language-server rather than by anything downstream that also lists
 * it, and the first entry whose extensions match wins.
 */
export const LANGUAGE_SERVERS: readonly LanguageServerEntry[] = [
  {
    id: "typescript",
    name: "typescript-language-server",
    blurb: "TypeScript and JavaScript, including JSX.",
    languages: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
    extensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    args: ["--stdio"],
    source: { via: "bundled", module: "typescript-language-server/package.json", entry: "lib/cli.mjs" },
  },
  {
    id: "python",
    name: "basedpyright",
    blurb: "Python types, imports and diagnostics.",
    languages: ["python"],
    extensions: ["py", "pyi"],
    args: ["--stdio"],
    source: { via: "bundled", module: "basedpyright/package.json", entry: "langserver.index.js" },
  },
  {
    id: "rust-analyzer",
    name: "rust-analyzer",
    blurb: "Rust, from the language's own team. One binary, no toolchain needed.",
    languages: ["rust"],
    extensions: ["rs"],
    args: [],
    source: {
      via: "release",
      repo: "rust-lang/rust-analyzer",
      match: {
        "darwin-arm64": "^rust-analyzer-aarch64-apple-darwin\\.gz$",
        "darwin-x64": "^rust-analyzer-x86_64-apple-darwin\\.gz$",
        "linux-x64": "^rust-analyzer-x86_64-unknown-linux-gnu\\.gz$",
        "linux-arm64": "^rust-analyzer-aarch64-unknown-linux-gnu\\.gz$",
        "win32-x64": "^rust-analyzer-x86_64-pc-windows-msvc\\.zip$",
      },
      bin: "rust-analyzer",
    },
  },
  {
    id: "clangd",
    name: "clangd",
    blurb: "C and C++, from the LLVM project.",
    languages: ["c", "cpp", "objective-c", "objective-cpp"],
    extensions: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "m", "mm"],
    args: ["--background-index"],
    source: {
      via: "release",
      repo: "clangd/clangd",
      match: {
        "darwin-arm64": "^clangd-mac-.*\\.zip$",
        "darwin-x64": "^clangd-mac-.*\\.zip$",
        "linux-x64": "^clangd-linux-.*\\.zip$",
        "win32-x64": "^clangd-windows-.*\\.zip$",
      },
      bin: "bin/clangd",
    },
  },
  {
    id: "gopls",
    name: "gopls",
    blurb: "Go, from the Go team. Needs the Go toolchain — the project ships no binary.",
    languages: ["go"],
    extensions: ["go"],
    args: [],
    source: {
      via: "toolchain",
      tool: "go",
      probe: ["go", "version"],
      install: ["go", "install", "golang.org/x/tools/gopls@latest"],
      bin: "gopls",
    },
  },
  {
    id: "jdtls",
    name: "Eclipse JDT Language Server",
    blurb: "Java. Needs a Java runtime already on the machine.",
    languages: ["java"],
    extensions: ["java"],
    args: [],
    source: {
      via: "release",
      repo: "eclipse-jdtls/eclipse.jdt.ls",
      match: {
        "darwin-arm64": "^jdt-language-server-.*\\.tar\\.gz$",
        "darwin-x64": "^jdt-language-server-.*\\.tar\\.gz$",
        "linux-x64": "^jdt-language-server-.*\\.tar\\.gz$",
        "linux-arm64": "^jdt-language-server-.*\\.tar\\.gz$",
        "win32-x64": "^jdt-language-server-.*\\.tar\\.gz$",
      },
      bin: "bin/jdtls",
    },
  },
  {
    id: "ruby-lsp",
    name: "Ruby LSP",
    blurb: "Ruby, from Shopify. Needs Ruby and RubyGems.",
    languages: ["ruby"],
    extensions: ["rb", "rake", "gemspec"],
    args: [],
    source: {
      via: "toolchain",
      tool: "gem",
      probe: ["gem", "--version"],
      install: ["gem", "install", "ruby-lsp"],
      bin: "ruby-lsp",
    },
  },
  {
    id: "intelephense",
    name: "Intelephense",
    blurb: "PHP.",
    languages: ["php"],
    extensions: ["php"],
    args: ["--stdio"],
    source: { via: "npm", package: "intelephense", bin: "intelephense" },
  },
  {
    id: "web",
    name: "VS Code language servers",
    blurb: "HTML, CSS and JSON — the servers VS Code itself uses.",
    languages: ["html", "css", "scss", "less", "json", "jsonc"],
    extensions: ["html", "htm", "css", "scss", "less", "json", "jsonc"],
    args: ["--stdio"],
    source: { via: "npm", package: "vscode-langservers-extracted", bin: "vscode-html-language-server" },
  },
  {
    id: "yaml",
    name: "yaml-language-server",
    blurb: "YAML, with schema validation.",
    languages: ["yaml"],
    extensions: ["yaml", "yml"],
    args: ["--stdio"],
    source: { via: "npm", package: "yaml-language-server", bin: "yaml-language-server" },
  },
  {
    id: "bash",
    name: "bash-language-server",
    blurb: "Shell scripts, with shellcheck when it is installed.",
    languages: ["shellscript"],
    extensions: ["sh", "bash", "zsh"],
    args: ["start"],
    source: { via: "npm", package: "bash-language-server", bin: "bash-language-server" },
  },
  {
    id: "lua",
    name: "lua-language-server",
    blurb: "Lua, from LuaLS. One binary, no toolchain needed.",
    languages: ["lua"],
    extensions: ["lua"],
    args: [],
    source: {
      via: "release",
      repo: "LuaLS/lua-language-server",
      match: {
        "darwin-arm64": "darwin-arm64\\.tar\\.gz$",
        "darwin-x64": "darwin-x64\\.tar\\.gz$",
        "linux-x64": "linux-x64\\.tar\\.gz$",
        "linux-arm64": "linux-arm64\\.tar\\.gz$",
        "win32-x64": "win32-x64\\.zip$",
      },
      bin: "bin/lua-language-server",
    },
  },
  {
    id: "sql",
    name: "sql-language-server",
    blurb: "SQL completion and linting.",
    languages: ["sql"],
    extensions: ["sql"],
    args: ["up", "--method", "stdio"],
    source: { via: "npm", package: "sql-language-server", bin: "sql-language-server" },
  },
  {
    id: "markdown",
    name: "Marksman",
    blurb: "Markdown: links, headings and references across the project.",
    languages: ["markdown"],
    extensions: ["md", "markdown"],
    args: ["server"],
    source: {
      via: "release",
      repo: "artempyanykh/marksman",
      match: {
        "darwin-arm64": "^marksman-macos$",
        "darwin-x64": "^marksman-macos$",
        "linux-x64": "^marksman-linux-x64$",
        "linux-arm64": "^marksman-linux-arm64$",
        "win32-x64": "^marksman\\.exe$",
      },
      bin: "marksman",
    },
  },
  {
    id: "docker",
    name: "dockerfile-language-server",
    blurb: "Dockerfiles.",
    languages: ["dockerfile"],
    extensions: ["dockerfile"],
    args: ["--stdio"],
    source: { via: "npm", package: "dockerfile-language-server-nodejs", bin: "docker-langserver" },
  },
];

/** The server that claims a file, or nothing. First match wins — see the note
 *  on ordering above. */
export function serverForPath(filePath: string): LanguageServerEntry | null {
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (!name) return null;
  /* Dockerfiles are named rather than extensioned, and the catalog is keyed on
     extensions — so the one file in common use with no dot is folded in here
     rather than given a field nothing else would ever use. */
  const extension = name.startsWith("dockerfile") ? "dockerfile" : name.includes(".") ? name.split(".").pop()! : "";
  if (!extension) return null;
  return LANGUAGE_SERVERS.find((entry) => entry.extensions.includes(extension)) ?? null;
}

export function serverById(id: string): LanguageServerEntry | null {
  return LANGUAGE_SERVERS.find((entry) => entry.id === id) ?? null;
}

/** This machine, in the catalog's terms. Anything else has no release assets
 *  and is told so rather than offered a download that cannot exist. */
export function currentPlatform(platform: string, arch: string): ServerPlatform | null {
  const key = `${platform}-${arch}`;
  return (SERVER_PLATFORMS as readonly string[]).includes(key) ? (key as ServerPlatform) : null;
}
