import { initialize as initializeVscodeServices } from "@codingame/monaco-vscode-api/services";
import getConfigurationServiceOverride, { initUserConfiguration, updateUserConfiguration } from "@codingame/monaco-vscode-configuration-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getLanguagesServiceOverride from "@codingame/monaco-vscode-languages-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import { configureDefaultWorkerFactory } from "monaco-languageclient/workerFactory";

/* Themes. Colour comes from a real VSCode theme now rather than a Monaco theme
   object, so the built-in set has to be present before one can be selected. */
import "@codingame/monaco-vscode-theme-defaults-default-extension";

/* Grammars, one package per language.
 *
 * This is the list that used to be four `basic-languages/*.contribution`
 * imports and a hard limit on what Construct could colour. Each of these is the
 * grammar VSCode itself ships for that language, and every one of them lines up
 * with a row in the language-server catalog — a learner who installs the Python
 * server was already looking at Python that was coloured properly. */
import "@codingame/monaco-vscode-typescript-basics-default-extension";
import "@codingame/monaco-vscode-javascript-default-extension";
import "@codingame/monaco-vscode-python-default-extension";
import "@codingame/monaco-vscode-rust-default-extension";
import "@codingame/monaco-vscode-cpp-default-extension";
import "@codingame/monaco-vscode-go-default-extension";
import "@codingame/monaco-vscode-java-default-extension";
import "@codingame/monaco-vscode-ruby-default-extension";
import "@codingame/monaco-vscode-php-default-extension";
import "@codingame/monaco-vscode-html-default-extension";
import "@codingame/monaco-vscode-css-default-extension";
import "@codingame/monaco-vscode-json-default-extension";
import "@codingame/monaco-vscode-yaml-default-extension";
import "@codingame/monaco-vscode-shellscript-default-extension";
import "@codingame/monaco-vscode-lua-default-extension";
import "@codingame/monaco-vscode-sql-default-extension";
import "@codingame/monaco-vscode-markdown-basics-default-extension";
import "@codingame/monaco-vscode-docker-default-extension";

/**
 * Starting the editor platform, once, before anything draws code.
 *
 * Construct used to run standalone Monaco: four Monarch grammars, a bundled
 * TypeScript worker, and a hand-written LSP client that spoke to three servers.
 * It runs the VSCode editor API now, which is the same editor with VSCode's own
 * services underneath it — so grammars are TextMate, themes are VSCode themes,
 * and a language server is a `MonacoLanguageClient` rather than four provider
 * registrations per feature.
 *
 * Only the services the editor actually needs are enabled. The full set would
 * bring a workbench with it — an explorer, a panel, a title bar — and Construct
 * has its own.
 *
 * Called once from `main.tsx` and awaited before the first render, because a
 * model created before the services exist is a model with no language and no
 * colour, and nothing repaints it afterwards.
 */
let started: Promise<void> | null = null;

export function startEditorPlatform(configuration: string): Promise<void> {
  return (started ??= (async () => {
    /* Workers first: the services expect a factory to already be in place when
       they spin up the ones they own. */
    configureDefaultWorkerFactory();
    /* Written before `initialize`, not after. The configuration service reads
       the user's file as it starts; updating afterwards works, but it would
       mean a first frame painted in the default theme. */
    await initUserConfiguration(configuration);
    await initializeVscodeServices({
      ...getConfigurationServiceOverride(),
      ...getKeybindingsServiceOverride(),
      /* Files and models together, and neither is optional.
         
         The editor resolves a URI to a text model whenever it has to show a
         file it is not already showing: the preview under a control-click, the
         peek window, the definition it is about to open. Standalone Monaco can
         only resolve models it already has, so every one of those asks failed
         against a file the learner had not opened — which is why following
         `console.log` into its declaration did nothing. The model service can
         resolve any URI, and it reads through the file service to do it. */
      ...getFilesServiceOverride(),
      ...getModelServiceOverride(),
      ...getLanguagesServiceOverride(),
      ...getTextmateServiceOverride(),
      ...getThemeServiceOverride(),
    });
  })());
}

/** Applies a palette change to a platform that is already running. */
export function applyEditorConfiguration(configuration: string): void {
  void started?.then(() => updateUserConfiguration(configuration));
}
