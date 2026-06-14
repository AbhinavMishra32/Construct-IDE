import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@opaline/ui/v2";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[construct] render crash", error, info);
  }

  render() {
    const { error } = this.state;

    if (error) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-xl">
            <AlertTitle>Project view crashed</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </main>
      );
    }

    return this.props.children;
  }
}

