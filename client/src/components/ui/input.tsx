import { Input as InputPrimitive } from '@base-ui/react/input'
import type { ComponentProps } from 'react'

import { cn } from '#lib/utils'

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <InputPrimitive
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80',
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  )
}

export { Input }
