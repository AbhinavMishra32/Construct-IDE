import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("Construct project advanced settings", () => {
  it("edits and validates the legacy project tape through a dedicated API", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const preload = readFileSync(fileURLToPath(new URL("../../preload/index.ts", import.meta.url)), "utf8");
    const controller = readFileSync(fileURLToPath(new URL("../../main/ipc/ConstructProjectIpcController.ts", import.meta.url)), "utf8");

    assert.match(source, /id: "project-advanced"/);
    assert.match(source, /Edit legacy project tape/);
    assert.match(source, /validateConstructSource\(tapeSource\)/);
    assert.match(source, /updateProjectTape\(/);
    assert.match(source, /Save and reload tape/);
    assert.match(preload, /construct:project:read-tape/);
    assert.match(preload, /construct:project:update-tape/);
    assert.match(controller, /Tape project id must remain/);
    assert.match(controller, /await writeFile\(project\.sourcePath, project\.source/);
    assert.match(controller, /materializeInitialFiles\(project\)/);
  });

  it("wires the bottom status bar preference through durable app settings", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const app = readFileSync(fileURLToPath(new URL("./ConstructApplication.tsx", import.meta.url)), "utf8");
    const preload = readFileSync(fileURLToPath(new URL("../../preload/index.ts", import.meta.url)), "utf8");
    const controller = readFileSync(fileURLToPath(new URL("../../main/ipc/ConstructSettingsIpcController.ts", import.meta.url)), "utf8");

    assert.match(source, /Bottom status bar/);
    assert.match(source, /updateAppSettings\(\{\s*app:\s*\{\s*showStatusBar: showStatusBarNext/s);
    assert.match(app, /getSettings\(\)\s*\.then\(\(settings\)/);
    assert.match(app, /setShowStatusBar\(settings\.app\?\.showStatusBar !== false\)/);
    assert.match(app, /\{showStatusBar \? <StatusBar theme=\{theme\} onThemeChange=\{setTheme\} \/> : null\}/);
    assert.match(preload, /construct:settings:update-app/);
    assert.match(controller, /ipcMain\.handle\("construct:settings:update-app"/);
  });

  it("uses a transparent Construct logo splash for startup loading states", () => {
    const app = readFileSync(fileURLToPath(new URL("./ConstructApplication.tsx", import.meta.url)), "utf8");
    const css = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8");
    const logo = readFileSync(fileURLToPath(new URL("../components/auth/construct-auth-logo.tsx", import.meta.url)), "utf8");
    const signIn = readFileSync(fileURLToPath(new URL("../components/auth/sign-in.tsx", import.meta.url)), "utf8");
    const signUp = readFileSync(fileURLToPath(new URL("../components/auth/sign-up.tsx", import.meta.url)), "utf8");
    const forgotPassword = readFileSync(fileURLToPath(new URL("../components/auth/forgot-password.tsx", import.meta.url)), "utf8");
    const resetPassword = readFileSync(fileURLToPath(new URL("../components/auth/reset-password.tsx", import.meta.url)), "utf8");
    const verifyEmail = readFileSync(fileURLToPath(new URL("../components/auth/verify-email.tsx", import.meta.url)), "utf8");
    const signOut = readFileSync(fileURLToPath(new URL("../components/auth/sign-out.tsx", import.meta.url)), "utf8");
    const authProvider = readFileSync(fileURLToPath(new URL("../components/auth/auth-provider.tsx", import.meta.url)), "utf8");
    const authFormAlert = readFileSync(fileURLToPath(new URL("../components/auth/auth-form-alert.tsx", import.meta.url)), "utf8");
    const userAvatar = readFileSync(fileURLToPath(new URL("../components/auth/user/user-avatar.tsx", import.meta.url)), "utf8");
    const userView = readFileSync(fileURLToPath(new URL("../components/auth/user/user-view.tsx", import.meta.url)), "utf8");

    assert.match(app, /function ConstructSplashScreen\(\)/);
    assert.match(app, /role="status" aria-label="Loading Construct"/);
    assert.match(app, /<ConstructAuthLogo className="mb-1" markClassName="construct-auth-logo__mark--hero" \/>/);
    assert.match(app, /Construct Cloud is not reachable/);
    assert.match(app, /<ConstructAuthLogo markClassName="construct-auth-logo__mark--sidebar" \/>/);
    assert.match(app, /max-w-\[calc\(100vw-3rem\)\] flex-col gap-7 px-8/);
    assert.match(app, /className="construct-auth-card w-full"/);
    assert.doesNotMatch(app, /Sign in to your Construct account to continue/);
    assert.doesNotMatch(app, /<h1 className="text-2xl font-bold tracking-tight mt-2">Construct<\/h1>/);
    assert.match(app, /return <ConstructSplashScreen \/>;/);
    assert.doesNotMatch(app, />Checking account status\.\.\.</);
    assert.doesNotMatch(app, />Loading settings\.\.\.</);
    assert.doesNotMatch(app, />C<\/div>/);
    assert.match(logo, /export function ConstructAuthLogo/);
    for (const source of [signIn, signUp, forgotPassword, resetPassword, verifyEmail, signOut]) {
      assert.doesNotMatch(source, /ConstructAuthLogo/);
      assert.doesNotMatch(source, /construct-auth-logo__mark--card/);
    }
    assert.doesNotMatch(authProvider, /ErrorToaster/);
    assert.match(authFormAlert, /export function AuthFormAlert/);
    assert.match(userAvatar, /ConstructAuthLogo/);
    assert.match(userAvatar, /construct-auth-logo__mark--user-loading/);
    assert.match(userView, /construct-user-loading-line/);
    assert.match(signIn, /AuthFormAlert/);
    assert.match(signIn, /setAuthError\(authErrorMessage/);
    assert.match(signUp, /AuthFormAlert/);
    assert.match(forgotPassword, /AuthFormAlert/);
    assert.match(resetPassword, /AuthFormAlert/);
    assert.match(verifyEmail, /AuthFormAlert/);
    for (const source of [signIn, signUp, forgotPassword, resetPassword, verifyEmail]) {
      assert.doesNotMatch(source, /toast\.error/);
    }
    for (const source of [signIn, signUp, forgotPassword, resetPassword, verifyEmail]) {
      assert.match(source, /<Card className=\{cn\("w-full max-w-sm", className\)\}>/);
      assert.match(source, /<CardContent>/);
    }
    assert.match(css, /\.construct-startup-splash\s*\{[\s\S]*?background: transparent;/);
    assert.match(css, /\.construct-auth-logo__mark\s*\{/);
    assert.match(css, /\.construct-startup-splash__logo,\s*\.construct-auth-logo__mark--knowledge-web-loading,\s*\.construct-auth-logo__mark--user-loading,\s*\.construct-user-loading-line/);
    assert.match(css, /--construct-loading-shimmer-base: color-mix\(in srgb, var\(--muted-foreground\) 58%, var\(--background\)\)/);
    assert.doesNotMatch(css, /construct-auth-logo__mark--card/);
    assert.match(css, /\.construct-auth-card :where\(input, \[data-slot="input"\], \[data-slot="input-group"\], \[data-slot="button"\]\)/);
    assert.match(css, /border-radius: 8px;/);
    assert.match(css, /@keyframes construct-auth-alert-in/);
    assert.match(css, /\.construct-auth-form-alert/);
    assert.match(css, /box-shadow: 0 0 0 1px color-mix\(in srgb, var\(--destructive\) 18%, transparent\) !important;/);
    assert.match(css, /construct-empty-watermark\.png/);
    assert.match(css, /--construct-startup-logo-color/);
    assert.match(css, /--construct-auth-logo-color/);
  });

  it("wires Construct Cloud UI through durable AI settings", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const aiSection = readFileSync(
      fileURLToPath(new URL("./components/settings/ConstructAiSettingsSection.tsx", import.meta.url)),
      "utf8",
    );
    const cloudPanel = readFileSync(
      fileURLToPath(new URL("./components/settings/ConstructCloudAccountPanel.tsx", import.meta.url)),
      "utf8",
    );
    const preload = readFileSync(fileURLToPath(new URL("../../preload/index.ts", import.meta.url)), "utf8");
    const controller = readFileSync(fileURLToPath(new URL("../../main/ipc/ConstructSettingsIpcController.ts", import.meta.url)), "utf8");

    assert.match(source, /onSourceChange=\{updateAiSource\}/);
    assert.match(source, /onConstructCloudAccessTokenChange=\{\(constructCloudAccessToken: string\) => setAiSettingsDraft/);
    assert.match(aiSection, /Model Source/);
    assert.match(aiSection, /Construct Cloud models load automatically after the Cloud source is selected/);
    assert.match(aiSection, /function ModelSelectionControl/);
    assert.match(aiSection, /readOnlyCatalog=\{usesConstructCloud\}/);
    assert.match(aiSection, /constructCloudModelAvailable/);
    assert.match(aiSection, /ConstructCloudAccountPanel/);
    assert.doesNotMatch(aiSection, /ProviderModelPicker/);
    assert.doesNotMatch(aiSection, /Search models/);
    assert.match(source, /allowConstructCloudEndpointEditing=\{false\}/);
    assert.match(aiSection, /allowEndpointEditing=\{allowConstructCloudEndpointEditing\}/);
    assert.match(cloudPanel, /allowEndpointEditing = false/);
    assert.match(cloudPanel, /createAuthClient\(\{[\s\S]*?baseURL: normalizedBaseUrl/);
    assert.match(cloudPanel, /authClient\.signOut\(\)/);
    assert.match(cloudPanel, /api\/cloud\/tokens/);
    assert.match(preload, /constructCloudEndpoint: resolveConstructCloudEndpoint\(process\.env\)/);
    assert.match(controller, /input\?\.provider === "construct-cloud"/);
  });
});
