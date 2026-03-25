import {
  DatabaseIcon,
  KeyRoundIcon,
  Layers3Icon,
  ShieldCheckIcon,
  SparklesIcon
} from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const oauthProviders = providerOptions.filter((provider) => provider.kind === "oauth");

  return (
    <div className="construct-auth-shell">
      <div className="construct-auth-backdrop" />
      <section className="construct-auth-stage">
        <aside className="construct-auth-hero">
          <Badge variant="outline" className="construct-auth-badge">
            Native accounts + provider-ready auth
          </Badge>

          <div className="construct-auth-copy">
            <h1>{mode === "login" ? "Sign in to Construct." : "Create your Construct account."}</h1>
            <p>
              Keep your projects, saved provider credentials, and future external account links
              behind one native account system without rewriting auth again later.
            </p>
          </div>

          <div className="construct-auth-feature-list">
            <FeatureCard
              icon={<ShieldCheckIcon className="size-4" />}
              title="Own auth system"
              description="Email/password accounts, durable sessions, and no external auth vendor lock-in."
            />
            <FeatureCard
              icon={<Layers3Icon className="size-4" />}
              title="Provider foundation"
              description="OpenAI, Codex, Tavily, LangSmith, and future providers fit the same connection model."
            />
            <FeatureCard
              icon={<KeyRoundIcon className="size-4" />}
              title="Encrypted secrets"
              description="API keys and future OAuth tokens stay behind the runner encryption layer."
            />
          </div>

          <div className="construct-auth-status-row">
            <Badge variant="outline" className="construct-auth-status-pill">
              Runner {runnerHealth?.status ?? "offline"}
            </Badge>
            <Badge variant={authReady ? "secondary" : "outline"} className="construct-auth-status-pill">
              {authReady ? "Database auth ready" : "Database setup needed"}
            </Badge>
          </div>
        </aside>

        <Card className="construct-auth-card">
          <CardHeader className="construct-auth-card-header">
            <div className="construct-auth-card-kicker">
              <SparklesIcon className="size-4" />
              <span>{mode === "login" ? "Welcome back" : "Create your account"}</span>
            </div>
            <CardTitle>
              {mode === "login" ? "Sign in to continue" : "Create a Construct account"}
            </CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Use your Construct account now. External OpenAI and Codex login can plug in here later."
                : "This account will own your projects, provider links, and saved credentials."}
            </CardDescription>
          </CardHeader>

          <CardContent className="construct-auth-card-body">
            <Tabs
              value={mode}
              onValueChange={(value) => {
                if (value === "login" || value === "signup") {
                  onModeChange(value);
                }
              }}
              className="construct-auth-tabs"
            >
              <TabsList className="construct-auth-tabs-list">
                <TabsTrigger value="login">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <div className="construct-auth-provider-stack">
                {oauthProviders.map((provider) => (
                  <Button
                    key={provider.id}
                    type="button"
                    variant="outline"
                    className="construct-auth-provider-button"
                    disabled
                  >
                    <div className="construct-auth-provider-copy">
                      <strong>{provider.label}</strong>
                      <span>{provider.description}</span>
                    </div>
                    <Badge variant="outline">
                      {provider.comingSoon ? "Coming soon" : provider.buttonLabel}
                    </Badge>
                  </Button>
                ))}
              </div>

              {!authReady ? (
                <Alert className="construct-auth-alert">
                  <DatabaseIcon className="size-4" />
                  <AlertTitle>Database setup is still needed</AlertTitle>
                  <AlertDescription>
                    Configure `DATABASE_URL` so Construct can persist users, sessions, and encrypted
                    provider settings.
                  </AlertDescription>
                </Alert>
              ) : null}

              {authError ? (
                <Alert variant="destructive" className="construct-auth-alert">
                  <ShieldCheckIcon className="size-4" />
                  <AlertTitle>Authentication failed</AlertTitle>
                  <AlertDescription>{authError}</AlertDescription>
                </Alert>
              ) : null}

              <TabsContent value="login">
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
              </TabsContent>

              <TabsContent value="signup">
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
                    <FieldDescription>
                      This is what Construct shows in the workspace and account panel.
                    </FieldDescription>
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
                    <FieldDescription>
                      Construct stores a password hash, not the raw password.
                    </FieldDescription>
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
              </TabsContent>
            </Tabs>
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
