import { cn } from "@/lib/utils"

type ConstructAuthLogoProps = {
  className?: string
  markClassName?: string
  showWordmark?: boolean
}

export function ConstructAuthLogo({
  className,
  markClassName,
  showWordmark = false
}: ConstructAuthLogoProps) {
  return (
    <div className={cn("construct-auth-logo", className)} aria-label="Construct">
      <div className={cn("construct-auth-logo__mark", markClassName)} aria-hidden="true" />
      {showWordmark ? <span className="construct-auth-logo__wordmark">Construct</span> : null}
    </div>
  )
}
