import { CircleAlertIcon, CircleCheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type AuthFormAlertProps = {
  children: string
  variant?: "error" | "success"
}

export function AuthFormAlert({ children, variant = "error" }: AuthFormAlertProps) {
  const Icon = variant === "success" ? CircleCheckIcon : CircleAlertIcon

  return (
    <div
      className={cn(
        "construct-auth-form-alert",
        variant === "success" ? "construct-auth-form-alert--success" : "construct-auth-form-alert--error",
      )}
      role={variant === "error" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export function authErrorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  if (error && typeof error === "object") {
    const err = error as {
      error?: { message?: string }
      message?: string
    }

    return err.error?.message ?? err.message ?? fallback
  }

  return fallback
}
