import { Menu } from '@base-ui/react/menu'
import type { ComponentProps } from 'react'

import { cn } from '#lib/utils'

function DropdownMenu(props: Menu.Root.Props) {
  return <Menu.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: Menu.Trigger.Props) {
  return <Menu.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuPortal(props: Menu.Portal.Props) {
  return <Menu.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuPositioner({ className, ...props }: Menu.Positioner.Props) {
  return (
    <Menu.Positioner
      className={cn('isolate z-[1200] outline-none', className)}
      data-slot="dropdown-menu-positioner"
      {...props}
    />
  )
}

function DropdownMenuContent({ className, ...props }: Menu.Popup.Props) {
  return (
    <Menu.Popup
      className={cn(
        'z-[1200] min-w-[168px] origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-[5px] text-[var(--text-primary)] shadow-[var(--shadow-menu)] outline-none transition-[opacity,transform] duration-[120ms] data-[starting-style]:scale-[.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[.97] data-[ending-style]:opacity-0 max-[820px]:max-w-[calc(100vw-20px)]',
        className,
      )}
      data-slot="dropdown-menu-content"
      {...props}
    />
  )
}

function DropdownMenuItem({ className, ...props }: Menu.Item.Props) {
  return (
    <Menu.Item
      className={cn(
        'relative flex min-h-8 w-full cursor-default items-center gap-[9px] rounded-md border-0 bg-transparent px-[9px] py-1.5 text-left text-xs text-[var(--text-primary)] outline-none select-none data-[highlighted]:bg-[var(--surface-hover)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      data-slot="dropdown-menu-item"
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: Menu.Separator.Props) {
  return (
    <Menu.Separator
      className={cn('mx-[3px] my-1 h-px bg-[var(--border-soft)]', className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  )
}

function DropdownMenuSub(props: Menu.SubmenuRoot.Props) {
  return <Menu.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({ className, ...props }: Menu.SubmenuTrigger.Props) {
  return (
    <Menu.SubmenuTrigger
      className={cn(
        'flex min-h-8 w-full cursor-default items-center gap-[9px] rounded-md px-[9px] py-1.5 text-xs text-[var(--text-primary)] outline-none select-none data-[highlighted]:bg-[var(--surface-hover)] data-[popup-open]:bg-[var(--surface-hover)]',
        className,
      )}
      data-slot="dropdown-menu-sub-trigger"
      {...props}
    />
  )
}

function DropdownMenuRadioGroup(props: Menu.RadioGroup.Props) {
  return <Menu.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({ className, ...props }: Menu.RadioItem.Props) {
  return (
    <Menu.RadioItem
      className={cn(
        'relative flex min-h-8 w-full cursor-default items-center gap-[9px] rounded-md px-[9px] py-1.5 text-xs outline-none select-none data-[highlighted]:bg-[var(--surface-hover)] data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      data-slot="dropdown-menu-radio-item"
      {...props}
    />
  )
}

function DropdownMenuRadioIndicator(props: ComponentProps<typeof Menu.RadioItemIndicator>) {
  return <Menu.RadioItemIndicator data-slot="dropdown-menu-radio-indicator" {...props} />
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRadioGroup,
  DropdownMenuRadioIndicator,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
