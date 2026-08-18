import {
  AuthProvider as AuthProviderPrimitive,
  type AuthPlugin,
  type AuthProviderProps
} from "@better-auth-ui/react"
import type {
  ComponentPropsWithoutRef,
  ComponentType,
  PropsWithChildren,
  ReactNode
} from "react"

declare module "@better-auth-ui/core" {
  interface AuthPluginRegister {
    constructReact: AuthPlugin
  }

  interface AuthConfig {
    /**
     * React component used to render internal navigation links.
     * Typically TanStack Router's `Link` or Next.js's `Link`.
     */
    Link: ComponentType<
      PropsWithChildren<
        { className?: string; href: string; to?: string } & Pick<
          ComponentPropsWithoutRef<"a">,
          "aria-disabled" | "tabIndex" | "onClick"
        >
      >
    >
  }

  /** Widen `AdditionalField.label` to `ReactNode` in the shadcn package. */
  interface AdditionalFieldRegister {
    label: ReactNode
  }
}

/**
 * Provides an authentication context while preserving Better Auth's query hooks.
 * Form-level auth failures render inline in the owning auth view instead of as global toasts.
 *
 * @param children - React nodes to render inside the authentication provider
 * @returns A React element that renders an authentication provider configured with the provided props.
 */
export function AuthProvider({ children, ...config }: AuthProviderProps) {
  return (
    <AuthProviderPrimitive {...config}>
      {children}
    </AuthProviderPrimitive>
  )
}
