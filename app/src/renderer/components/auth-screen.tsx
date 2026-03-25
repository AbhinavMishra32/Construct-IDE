import { KeyRoundIcon, Layers3Icon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { AuthProviderOption, RunnerHealth } from "../types";

export function AuthScreen({
  mode,
  onModeChange,
  providerOptions,
  runnerHealth,
  authError,
  authBusy,
  authReady,
  loginEmail,
  loginPassword,
  signupDisplayName,
  signupEmail,
  signupPassword,
  onLoginEmailChange,
  onLoginPasswordChange,
  onSignupDisplayNameChange,
  onSignupEmailChange,
  onSignupPasswordChange,
  onSubmitLogin,
  onSubmitSignup
}: {
  mode: "login" | "signup";
  onModeChange: (mode: "login" | "signup") => void;
  providerOptions: AuthProviderOption[];
  runnerHealth: RunnerHealth | null;
  authError: string;
  authBusy: boolean;
  authReady: boolean;
  loginEmail: string;
  loginPassword: string;
  signupDisplayName: string;
  signupEmail: string;
  signupPassword: string;
  onLoginEmailChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onSignupDisplayNameChange: (value: string) => void;
  onSignupEmailChange: (value: string) => void;
  onSignupPasswordChange: (value: string) => void;
  onSubmitLogin: () => void;
  onSubmitSignup: () => void;
}) {
  return (
    <div className="construct-auth-shell">
      <div className="construct-auth-backdrop" />
      <section className="construct-auth-stage">
        <aside className="construct-auth-hero">
          <Badge variant="outline" className="construct-auth-badge">
            Native accounts + provider-ready auth
          </Badge>
          <div className="construct-auth-copy">
            <h1>Build in Construct without juggling raw secrets every session.</h1>
            <p>
              Start with a real Construct account today, save provider credentials securely,
              and leave space for OpenAI and Codex OAuth to plug in later without another
              auth rewrite.
            </p>
          </div>

          <div className="construct-auth-feature-list">
            <FeatureCard
              icon={<ShieldCheckIcon />}
              title="Own auth system"
              description="Email/password accounts, durable sessions, encrypted provider secrets, and no external auth vendor lock-in."
            />
            <FeatureCard
              icon={<Layers3Icon />}
              title="Provider foundation"
              description="OpenAI, Codex, Tavily, LangSmith, and future providers all fit the same connection model."
            />
            <FeatureCard
              icon={<KeyRoundIcon />}
              title="Encrypted secrets"
              description="API keys and future OAuth tokens live behind the runner’s encryption layer instead of loose env variables."
            />
          </div>

          <div className="construct-auth-status-row">
            <div className="construct-auth-status-pill">
              <span>Runner</span>
              <strong>{runnerHealth?.status ?? "offline"}</strong>
            </div>
            <div className="construct-auth-status-pill">
              <span>Database auth</span>
              <strong>{authReady ? "ready" : "setup needed"}</strong>
            </div>
          </div>
        </aside>

        <Card className="construct-auth-card">
          <CardHeader className="construct-auth-card-header">
            <div className="construct-auth-card-kicker">
              <SparklesIcon className="size-4" />
              <span>{mode === "login" ? "Welcome back" : "Create your account"}</span>
            </div>
            <CardTitle>{mode === "login" ? "Sign in to Construct" : "Create a Construct account"}</CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Use your native Construct account now. External provider login can land on top of this safely later."
                : "This sets up the account system that will own your projects, provider links, and saved credentials."}
            </CardDescription>
          </CardHeader>

          <CardContent className="construct-auth-card-body">
            <div className="construct-auth-mode-switch">
              <Button
                type="button"
                variant={mode === "login" ? "secondary" : "ghost"}
                className={cn("construct-auth-mode-button", mode === "login" ? "is-active" : "")}
                onClick={() => {
                  onModeChange("login");
                }}
              >
                Sign in
              </Button>
              <Button
                type="button"
                variant={mode === "signup" ? "secondary" : "ghost"}
                className={cn("construct-auth-mode-button", mode === "signup" ? "is-active" : "")}
                onClick={() => {
                  onModeChange("signup");
                }}
              >
                Create account
              </Button>
            </div>

            <div className="construct-auth-provider-stack">
              {providerOptions
                .filter((provider) => provider.kind === "oauth")
                .map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={cn(
                      "construct-auth-provider-button",
                      !provider.enabled ? "is-disabled" : ""
                    )}
                    disabled
                  >
                    <div>
                      <strong>{provider.label}</strong>
                      <span>{provider.description}</span>
                    </div>
                    <Badge variant="outline">
                      {provider.comingSoon ? "Coming soon" : provider.buttonLabel}
                    </Badge>
                  </button>
                ))}
            </div>

            <div className="construct-auth-divider">
              <span>{mode === "login" ? "Or sign in with email" : "Or create an email account"}</span>
            </div>

            {!authReady ? (
              <div className="construct-auth-warning">
                Construct needs `DATABASE_URL` configured before the account system can write
                users, sessions, and encrypted provider settings.
              </div>
            ) : null}

            {authError ? <div className="construct-auth-error">{authError}</div> : null}

            {mode === "login" ? (
              <FieldGroup className="construct-auth-form">
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input
                    value={loginEmail}
                    onChange={(event) => {
                      onLoginEmailChange(event.target.value);
                    }}
                    placeholder="you@company.com"
                    autoComplete="email"
                    disabled={authBusy}
                  />
                </Field>
                <Field>
                  <FieldLabel>Password</FieldLabel>
                  <Input
                    type="password"
                    value={loginPassword}
                    onChange={(event) => {
                      onLoginPasswordChange(event.target.value);
                    }}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={authBusy}
                  />
                </Field>
                <Button
                  type="button"
                  className="construct-auth-submit"
                  disabled={authBusy || !authReady}
                  onClick={onSubmitLogin}
                >
                  {authBusy ? "Signing in..." : "Sign in"}
                </Button>
              </FieldGroup>
            ) : (
              <FieldGroup className="construct-auth-form">
                <Field>
                  <FieldLabel>Display name</FieldLabel>
                  <Input
                    value={signupDisplayName}
                    onChange={(event) => {
                      onSignupDisplayNameChange(event.target.value);
                    }}
                    placeholder="Abhinav"
                    autoComplete="name"
                    disabled={authBusy}
                  />
                  <FieldDescription>This is what Construct shows in the workspace and account panel.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input
                    value={signupEmail}
                    onChange={(event) => {
                      onSignupEmailChange(event.target.value);
                    }}
                    placeholder="you@company.com"
                    autoComplete="email"
                    disabled={authBusy}
                  />
                </Field>
                <Field>
                  <FieldLabel>Password</FieldLabel>
                  <Input
                    type="password"
                    value={signupPassword}
                    onChange={(event) => {
                      onSignupPasswordChange(event.target.value);
                    }}
                    placeholder="Use at least 10 characters"
                    autoComplete="new-password"
                    disabled={authBusy}
                  />
                  <FieldDescription>Construct stores a password hash, not the raw password.</FieldDescription>
                </Field>
                <Button
                  type="button"
                  className="construct-auth-submit"
                  disabled={authBusy || !authReady}
                  onClick={onSubmitSignup}
                >
                  {authBusy ? "Creating account..." : "Create account"}
                </Button>
              </FieldGroup>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="construct-auth-feature-card">
      <div className="construct-auth-feature-icon">{icon}</div>
      <div className="construct-auth-feature-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}
