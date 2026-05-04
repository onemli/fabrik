import {
  CheckCircle,
  Info,
  Loader2,
  XCircle,
  AlertTriangle,
} from "lucide-react"
import { Toaster as Sonner } from "sonner"
import { useThemeStore } from "@/store/themeStore"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { mode } = useThemeStore()
  const theme = mode

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />,
        info: <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
        warning: <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />,
        error: <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />,
        loading: <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-sm",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:hover:bg-primary/90",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:hover:bg-muted/80",
          success:
            "group-[.toaster]:bg-green-50 dark:group-[.toaster]:bg-green-950 group-[.toaster]:border-green-200 dark:group-[.toaster]:border-green-800 group-[.toaster]:text-green-900 dark:group-[.toaster]:text-green-100",
          error:
            "group-[.toaster]:bg-red-50 dark:group-[.toaster]:bg-red-950 group-[.toaster]:border-red-200 dark:group-[.toaster]:border-red-800 group-[.toaster]:text-red-900 dark:group-[.toaster]:text-red-100",
          warning:
            "group-[.toaster]:bg-yellow-50 dark:group-[.toaster]:bg-yellow-950 group-[.toaster]:border-yellow-200 dark:group-[.toaster]:border-yellow-800 group-[.toaster]:text-yellow-900 dark:group-[.toaster]:text-yellow-100",
          info:
            "group-[.toaster]:bg-blue-50 dark:group-[.toaster]:bg-blue-950 group-[.toaster]:border-blue-200 dark:group-[.toaster]:border-blue-800 group-[.toaster]:text-blue-900 dark:group-[.toaster]:text-blue-100",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
