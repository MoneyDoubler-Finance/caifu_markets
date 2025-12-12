import * as React from "react"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseClasses = "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-yellow)] disabled:pointer-events-none disabled:opacity-50"

    const variants = {
      default: "btn-neon text-black font-bold shadow-lg",
      destructive: "bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-500/30 hover:shadow-red-500/50 hover:scale-105",
      outline: "border border-[var(--border-color)] glass-card hover:border-[var(--primary-yellow)] hover:shadow-lg hover:shadow-[var(--primary-yellow)]/20 text-white",
      secondary: "bg-gradient-to-r from-[var(--hover-background)] to-[var(--card-background)] text-white shadow-md hover:shadow-lg hover:scale-105 border border-[var(--border-color)]",
      ghost: "hover:bg-[var(--hover-background)] hover:text-white text-[var(--text-secondary)] transition-all",
      link: "text-[var(--primary-yellow)] underline-offset-4 hover:underline hover:drop-shadow-[0_0_5px_rgba(255,208,0,0.5)]",
    }

    const sizes = {
      default: "h-9 px-4 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-11 rounded-md px-8",
      icon: "h-9 w-9",
    }

    return (
      <button
        className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className || ''}`}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
