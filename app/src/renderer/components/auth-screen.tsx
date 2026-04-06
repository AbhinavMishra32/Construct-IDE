import { DatabaseIcon, ShieldCheckIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { AuthProviderOption } from "../types";

export function AuthScreen({
  mode,
  onModeChange,
  providerOptions,
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
        <div className="construct-auth-panel">
          <div className="construct-auth-brand">
            <strong>Construct</strong>
            <div className="construct-auth-brand-copy">
              <span>Sign in or create an account to continue.</span>
            </div>
          </div>

          <Card className="construct-auth-card">
            <CardHeader className="construct-auth-card-header">
              <CardTitle>
                {mode === "login" ? "Sign in to continue" : "Create your Construct account"}
              </CardTitle>
              <CardDescription>
                {mode === "login"
                  ? "Enter your email and password."
                  : "Create your account with an email and password."}
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

                {!authReady ? (
                  <Alert className="construct-auth-alert">
                    <DatabaseIcon />
                    <div className="construct-auth-alert-copy">
                      <AlertTitle>Database setup needed</AlertTitle>
                      <AlertDescription>
                        Configure `DATABASE_URL` to enable account sign-in.
                      </AlertDescription>
                    </div>
                  </Alert>
                ) : null}

                {authError ? (
                  <Alert variant="destructive" className="construct-auth-alert">
                    <ShieldCheckIcon />
                    <div className="construct-auth-alert-copy">
                      <AlertTitle>Authentication failed</AlertTitle>
                      <AlertDescription>{authError}</AlertDescription>
                    </div>
                  </Alert>
                ) : null}

                {oauthProviders.length > 0 ? (
                  <>
                    <Separator className="construct-auth-separator" />
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
                  </>
                ) : null}

                <TabsContent value="login" className="construct-auth-tab-content">
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

                <TabsContent value="signup" className="construct-auth-tab-content">
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
        </div>
      </section>
    </div>
  );
}
