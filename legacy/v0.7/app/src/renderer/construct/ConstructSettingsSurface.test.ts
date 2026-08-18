import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("Construct project advanced settings", () => {
  it("edits and validates the legacy project tape through a dedicated API", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const bridge = readFileSync(fileURLToPath(new URL("./lib/tauriBridge.ts", import.meta.url)), "utf8");
    const commands = readFileSync(fileURLToPath(new URL("../../../src-tauri/src/commands/projects.rs", import.meta.url)), "utf8");

    assert.match(source, /id: "project-advanced"/);
    assert.match(source, /Edit legacy project tape/);
    assert.match(source, /validateConstructSource\(tapeSource\)/);
    assert.match(source, /updateProjectTape\(/);
    assert.match(source, /Save and reload tape/);
    assert.match(bridge, /rust_project_read_tape/);
    assert.match(bridge, /rust_project_update_tape/);
    assert.match(commands, /Tape project id must remain/);
    assert.match(commands, /std::fs::write\(&source_path, source\)/);
    assert.match(commands, /materialize\(&state, &project\)/);
  });

  it("wires the bottom status bar preference through durable app settings", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const app = readFileSync(fileURLToPath(new URL("./ConstructApplication.tsx", import.meta.url)), "utf8");
    const bridge = readFileSync(fileURLToPath(new URL("./lib/tauriBridge.ts", import.meta.url)), "utf8");
    const commands = readFileSync(fileURLToPath(new URL("../../../src-tauri/src/commands/settings.rs", import.meta.url)), "utf8");

    assert.match(source, /Bottom status bar/);
    assert.match(source, /updateAppSettings\(\{\s*app:\s*\{\s*showStatusBar: showStatusBarNext/s);
    assert.match(app, /getSettings\(\)\s*\.then\(\(settings\)/);
    assert.match(app, /setShowStatusBar\(settings\.app\?\.showStatusBar !== false\)/);
    assert.match(app, /\{showStatusBar \? <StatusBar theme=\{theme\} onThemeChange=\{setTheme\} \/> : null\}/);
    assert.match(bridge, /rust_settings_update_app/);
    assert.match(commands, /pub fn rust_settings_update_app/);
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
    const settingsCommand = readFileSync(fileURLToPath(new URL("../../../src-tauri/src/commands/settings.rs", import.meta.url)), "utf8");
    const mastraWorker = readFileSync(fileURLToPath(new URL("../../mastra-worker.ts", import.meta.url)), "utf8");

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
    assert.match(settingsCommand, /"construct-cloud"/);
    assert.match(mastraWorker, /createConstructAgentRuntime/);
    assert.match(mastraWorker, /ask_user_question:\s*hostTool/);
    assert.match(mastraWorker, /internet_search:\s*createTool/);
    assert.match(mastraWorker, /internet_fetch:\s*createTool/);
    assert.match(mastraWorker, /explicitFlowToolChoice\(String\(payload\.message/);
  });

  it("uses the Synara-style profile and appearance settings surfaces", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const profile = readFileSync(
      fileURLToPath(new URL("./components/settings/ConstructProfileSettingsPanel.tsx", import.meta.url)),
      "utf8",
    );
    const nativeProfile = readFileSync(
      fileURLToPath(new URL("../../../src-tauri/src/profile.rs", import.meta.url)),
      "utf8",
    );
    const sharedSettings = readFileSync(
      fileURLToPath(new URL("../../../../opaline/packages/ui/src/settings/Settings.tsx", import.meta.url)),
      "utf8",
    );

    assert.match(source, /id: "profile", label: "Profile"/);
    assert.match(source, /activeItemId === "profile"/);
    assert.match(source, /<ConstructProfileSettingsPanel projects=\{projects\} aiSettings=\{aiSettings\} \/>/);
    assert.match(source, /role="radiogroup" aria-label="Theme preference"/);
    assert.match(source, /role="radio"/);
    assert.match(source, /onThemeChange\(option\.value\)/);
    assert.doesNotMatch(source, /<SelectItem value="system">System<\/SelectItem>[\s\S]*?<SelectItem value="light">Light<\/SelectItem>[\s\S]*?<SelectItem value="dark">Dark<\/SelectItem>/);

    assert.match(profile, /construct\.profile\.v1/);
    assert.match(profile, /getProfile\(\)/);
    assert.match(profile, /updateProfile\(/);
    assert.match(profile, /window\.localStorage\.removeItem\(PROFILE_STORAGE_KEY\)/);
    assert.doesNotMatch(profile, /window\.localStorage\.setItem/);
    assert.match(profile, /function buildProfileActivity/);
    assert.match(profile, /snapshot\.activityEvents/);
    assert.match(profile, /function localDateKey/);
    assert.doesNotMatch(profile, /toISOString\(\)\.slice\(0, 10\)/);
    assert.match(profile, /function compressAvatarImage/);
    assert.match(profile, /canvas\.toDataURL\("image\/jpeg", 0\.84\)/);
    assert.match(profile, /navigator\.clipboard\.writeText\(summary\)/);
    assert.match(profile, /Current AI setup/);
    assert.match(profile, /Project mix/);

    assert.match(nativeProfile, /struct ProfileService/);
    assert.match(nativeProfile, /const PROFILE_SCOPE: &str = "profile:default"/);
    assert.match(nativeProfile, /MAX_ACTIVITY_EVENTS/);
    assert.match(nativeProfile, /pub fn snapshot\(&self, projects: &\[Value\], learning: &Value\)/);
    assert.match(nativeProfile, /profile\.invalid-avatar/);

    assert.match(sharedSettings, /app-settings-surface/);
    assert.match(sharedSettings, /max-w-2xl/);
    assert.match(sharedSettings, /data-slot="settings-row"/);
    assert.match(sharedSettings, /divide-y divide-border overflow-hidden rounded-lg border border-border bg-transparent/);
    assert.doesNotMatch(sharedSettings, /<Card className=/);
    assert.doesNotMatch(sharedSettings, /data-checked:bg-sky-500/);
  });
});
