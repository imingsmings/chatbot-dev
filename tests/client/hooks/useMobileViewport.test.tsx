import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMobileViewport } from '../../../client/src/hooks/useMobileViewport'

afterEach(() => { vi.unstubAllGlobals() })

describe('useMobileViewport', () => {
  it('tracks keyboard height and pan, ignores pinch zoom and cleans up on desktop', async () => {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
    vi.stubGlobal('visualViewport', viewport)
    const style = document.documentElement.style
    const { rerender } = renderHook(({ enabled }) => useMobileViewport(enabled), { initialProps: { enabled: true } })
    expect(style.getPropertyValue('--chat-viewport-height')).toBe('844px')
    act(() => { viewport.height = 410; viewport.offsetTop = 24; viewport.dispatchEvent(new Event('resize')) })
    await waitFor(() => expect(style.getPropertyValue('--chat-viewport-height')).toBe('410px'))
    expect(style.getPropertyValue('--chat-viewport-top')).toBe('24px')
    act(() => { viewport.scale = 2; viewport.height = 205; viewport.dispatchEvent(new Event('resize')) })
    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(style.getPropertyValue('--chat-viewport-height')).toBe('410px')
    act(() => { viewport.scale = 1; viewport.offsetTop = -4; viewport.dispatchEvent(new Event('scroll')) })
    await waitFor(() => expect(style.getPropertyValue('--chat-viewport-top')).toBe('0px'))
    rerender({ enabled: false })
    expect(style.getPropertyValue('--chat-viewport-height')).toBe('')
    expect(style.getPropertyValue('--chat-viewport-top')).toBe('')
    act(() => { viewport.dispatchEvent(new Event('resize')) })
    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(style.getPropertyValue('--chat-viewport-height')).toBe('')
  })

  it('does not touch desktop styles or require the VisualViewport API', () => {
    vi.stubGlobal('visualViewport', undefined)
    const view = renderHook(({ enabled }) => useMobileViewport(enabled), { initialProps: { enabled: false } })
    view.rerender({ enabled: true })
    expect(document.documentElement.style.getPropertyValue('--chat-viewport-height')).toBe('')
  })
})
