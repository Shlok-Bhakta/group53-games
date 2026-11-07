import { useTheme } from "@/theme"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CheckCircleIcon, InfoIcon, WarningIcon, XCircleIcon, SpinnerGapIcon } from "@phosphor-icons/react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved: theme } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CheckCircleIcon className="size-4" weight="fill" />
        ),
        info: (
          <InfoIcon className="size-4" weight="fill" />
        ),
        warning: (
          <WarningIcon className="size-4" weight="fill" />
        ),
        error: (
          <XCircleIcon className="size-4" weight="fill" />
        ),
        loading: (
          <SpinnerGapIcon className="size-4 animate-spin" weight="bold" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
