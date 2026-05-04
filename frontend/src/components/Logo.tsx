// Logo.tsx
//
// SVG icon + text logo using Inter 600. Switches between light/dark SVG
// based on the current theme mode.

import { cn } from '@/lib/utils'
import fabrikDark from '@/assets/fabrik_dark.svg'
import fabrikLight from '@/assets/fabrik_light.svg'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CONFIG = {
  sm: { text: 'text-xl', icon: 'h-[34px] w-auto' },
  md: { text: 'text-2xl', icon: 'h-[34px] w-auto' },
  lg: { text: 'text-4xl', icon: 'h-[34px] w-auto' },
}

export function Logo({ size = 'sm', className }: LogoProps) {
  const { text, icon } = SIZE_CONFIG[size]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-foreground select-none',
        text,
        className,
      )}
      style={{ fontFamily: "'Inter', 'DM Sans', sans-serif", fontWeight: 600 }}
    >
      <img src={fabrikLight} alt="" className={cn(icon, 'dark:hidden')} />
      <img src={fabrikDark} alt="" className={cn(icon, 'hidden dark:block')} />
      Fabrik
    </span>
  )
}
