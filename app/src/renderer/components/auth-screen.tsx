import {
  ActivityIcon,
  DatabaseIcon,
  KeyRoundIcon,
  Layers3Icon,
  LockKeyholeIcon,
  SparklesIcon,
  WaypointsIcon
} from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
      <section className="construct-auth-window">
        <header className="construct-auth-window-bar">
          <div className="construct-auth-window-title">
            <div className="construct-auth-window-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="construct-auth-window-copy">
              <strong>Construct IDE</strong>
              <span>Account access for your local workspace</span>
            </div>
          </div>

          <div className="construct-auth-window-status">
            <Badge variant="outline">Runner {runnerHealth?.status ?? "offline"}</Badge>
            <Badge variant={authReady ? "secondary" : "outline"}>
              {authReady ? "Account storage ready" : "Database setup needed"}
            </Badge>
          </div>
        </header>

        <div className="construct-auth-stage">
          <aside className="construct-auth-sidebar">
            <ScrollArea className="construct-auth-sidebar-scroll">
              <div className="construct-auth-sidebar-stack">
                <Card className="construct-auth-panel-card">
                  <CardHeader>
                    <div className="construct-auth-panel-headline">
                      <Avatar size="lg">
                        <AvatarFallback>CI</AvatarFallback>
                      </Avatar>
                      <div className="construct-auth-panel-copy">
                        <CardTitle>Open your build workspace</CardTitle>
                        <CardDescription>
                          Construct is a desktop workbench. Your account unlocks projects,
                          encrypted provider connections, and resumable agent runs without
                          turning the app into a browser dashboard.
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="construct-auth-panel-grid">
                    <PanelMetric
                      icon={<Layers3Icon className="size-4" />}
                      label="Project state"
                      value="Synced across sessions"
                    />
                    <PanelMetric
                      icon={<KeyRoundIcon className="size-4" />}
                      label="Provider auth"
                      value="API keys now, OAuth later"
                    />
                    <PanelMetric
                      icon={<WaypointsIcon className="size-4" />}
                      label="Agent continuity"
                      value="Ready for resumable runs"
                    />
                  </CardContent>
                </Card>

                <Card size="sm" className="construct-auth-panel-card">
                  <CardHeader>
                    <CardTitle>What the account layer owns</CardTitle>
                    <CardDescription>
                      The runner stays local. The account system gives it durable ownership and
                      safer credential handling.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="construct-auth-workspace-list">
                    <SidebarRow
                      icon={<DatabaseIcon className="size-4" />}
                      title="Saved project state"
                      description="Planning sessions, generated paths, and future user ownership."
                    />
                    <SidebarRow
                      icon={<LockKeyholeIcon className="size-4" />}
                      title="Encrypted provider secrets"
                      description="Stored behind the runner encryption layer instead of loose env vars."
                    />
                    <SidebarRow
                      icon={<ActivityIcon className="size-4" />}
                      title="Per-user agent runtime"
                      description="LangGraph provider config resolves per authenticated session."
                    />
                  </CardContent>
                </Card>

                <Card size="sm" className="construct-auth-panel-card">
                  <CardHeader>
                    <CardTitle>External provider entry points</CardTitle>
                    <CardDescription>
                      These providers already have a place in the auth model, so OAuth can land
                      without another architecture rewrite.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="construct-auth-provider-list">
                    {oauthProviders.map((provider) => (
                      <ProviderPreviewCard key={provider.id} provider={provider} />
                    ))}
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </aside>

          <div className="construct-auth-card-shell">
            <Card className="construct-auth-card">
              <CardHeader className="construct-auth-card-header">
                <div className="construct-auth-card-kicker">
                  <SparklesIcon className="size-4" />
                  <span>{mode === "login" ? "Workspace access" : "Account bootstrap"}</span>
                </div>
                <CardTitle>
                  {mode === "login" ? "Sign in to continue" : "Create your Construct account"}
                </CardTitle>
                <CardDescription>
                  {mode === "login"
                    ? "Pick up your projects, provider links, and saved runner state right where you left them."
                    : "This creates the native account layer that future OpenAI and Codex login flows will attach to."}
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

                  <Separator />

                  {!authReady ? (
                    <Alert>
                      <DatabaseIcon className="size-4" />
                      <AlertTitle>Database setup is still needed</AlertTitle>
                      <AlertDescription>
                        Configure `DATABASE_URL` so Construct can persist users, sessions, and
                        encrypted provider settings.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {authError ? (
                    <Alert variant="destructive">
                      <LockKeyholeIcon className="size-4" />
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
                          This name shows up in the workspace and account panel.
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
                          Construct stores a password hash, never the raw password.
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

              <CardFooter className="construct-auth-card-footer">
                <span>Desktop-first auth foundation</span>
                <Separator orientation="vertical" className="construct-auth-card-footer-separator" />
                <span>External provider login slots already reserved</span>
              </CardFooter>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}

function PanelMetric({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="construct-auth-panel-metric">
      <span className="construct-auth-panel-metric-icon">{icon}</span>
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
    </div>
  );
}

function SidebarRow({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="construct-auth-sidebar-row">
      <span className="construct-auth-sidebar-row-icon">{icon}</span>
      <div className="construct-auth-sidebar-row-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}

function ProviderPreviewCard({ provider }: { provider: AuthProviderOption }) {
  return (
    <div className="construct-auth-provider-preview">
      <div className="construct-auth-provider-preview-copy">
        <strong>{provider.label}</strong>
        <span>{provider.description}</span>
      </div>
      <Badge variant="outline">{provider.comingSoon ? "OAuth soon" : provider.buttonLabel}</Badge>
    </div>
  );
}
