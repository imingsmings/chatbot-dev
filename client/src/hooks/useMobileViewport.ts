import { useEffect } from 'react'

// The keyboard can shrink the visual viewport without changing CSS viewport units.
export function useMobileViewport(enabled: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!enabled || !viewport) return
    const style = document.documentElement.style
    const heightKey = '--chat-viewport-height'
    const topKey = '--chat-viewport-top'
    const previousHeight = style.getPropertyValue(heightKey)
    const previousTop = style.getPropertyValue(topKey)
    let frame = 0

    function update() {
      if (!viewport || viewport.scale !== 1 || viewport.height <= 0) return
      style.setProperty(heightKey, `${viewport.height}px`)
      style.setProperty(topKey, `${Math.max(0, viewport.offsetTop)}px`)
    }

    function scheduleUpdate() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }

    update()
    viewport.addEventListener('resize', scheduleUpdate)
    viewport.addEventListener('scroll', scheduleUpdate)
    window.addEventListener('resize', scheduleUpdate)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', scheduleUpdate)
      viewport.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      if (previousHeight) style.setProperty(heightKey, previousHeight)
      else style.removeProperty(heightKey)
      if (previousTop) style.setProperty(topKey, previousTop)
      else style.removeProperty(topKey)
    }
  }, [enabled])
}
