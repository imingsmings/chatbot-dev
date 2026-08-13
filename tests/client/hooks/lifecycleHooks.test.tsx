import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAutoScroll } from '../../../client/src/hooks/useAutoScroll'
import { THEME_STORAGE_KEY, useTheme } from '../../../client/src/hooks/useTheme'

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.style.colorScheme = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lifecycle hooks', () => {
  it('persists the theme storage key and applies the toggled color scheme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
    expect(result.current.themeToggleLabel).toBe('浅色')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.theme).toBe('light')
    expect(result.current.themeToggleLabel).toBe('深色')
    expect(window.localStorage.getItem('chatbot-theme')).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('uses a frame for follow-scroll and cancels a pending frame on unmount', () => {
    let frameCallback: FrameRequestCallback | null = null
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallback = callback
        return 17
      })
    const cancelAnimationFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)
    const scrollTo = vi.fn<(options?: ScrollToOptions) => void>()
    const element = document.createElement('section')
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 850, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    })
    const chatBox = { current: element }
    const { result, unmount } = renderHook(() => useAutoScroll(chatBox))

    expect(result.current.shouldFollowNewContent()).toBe(true)
    act(() => {
      result.current.followNewContent(true)
    })
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(scrollTo).not.toHaveBeenCalled()

    act(() => {
      frameCallback?.(0)
    })
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: 'auto' })

    act(() => {
      result.current.followNewContent(true)
    })
    unmount()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17)
  })

  it('keeps following delayed streamed DOM growth until the user scrolls away', async () => {
    let frameCallback: FrameRequestCallback | null = null
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallback = callback
        return 23
      })
    const scrollTo = vi.fn<(options?: ScrollToOptions) => void>()
    const element = document.createElement('section')
    let scrollHeight = 1_000
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: { configurable: true, value: 850, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    })
    const chatBox = { current: element }
    const { result } = renderHook(() => useAutoScroll(chatBox))

    scrollHeight = 1_400
    await act(async () => {
      element.append(document.createElement('pre'))
      await Promise.resolve()
    })

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    act(() => {
      frameCallback?.(0)
    })
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_400, behavior: 'auto' })

    element.scrollTop = 200
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
    element.dispatchEvent(new Event('scroll'))
    expect(result.current.shouldFollowNewContent()).toBe(false)

    requestAnimationFrame.mockClear()
    scrollHeight = 1_800
    await act(async () => {
      element.append(document.createElement('code'))
      await Promise.resolve()
    })
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('deduplicates resize-driven frames and exposes quick-bottom follow recovery', () => {
    let resizeCallback: ResizeObserverCallback | null = null
    const observe = vi.fn()
    const unobserve = vi.fn()
    const disconnect = vi.fn()
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe = observe
      unobserve = unobserve
      disconnect = disconnect
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    let frameCallback: FrameRequestCallback | null = null
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallback = callback
        return 31
      })
    const scrollTo = vi.fn<(options?: ScrollToOptions) => void>()
    const element = document.createElement('section')
    const content = document.createElement('div')
    const messageList = document.createElement('div')
    messageList.className = 'message-list'
    content.append(messageList)
    element.append(content)
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 900, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    })
    const chatBox = { current: element }
    const contentBox = { current: content }
    const { result, unmount } = renderHook(() =>
      useAutoScroll(chatBox, contentBox),
    )

    expect(observe).toHaveBeenCalledWith(content)
    expect(observe).toHaveBeenCalledWith(messageList)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
      resizeCallback?.([], {} as ResizeObserver)
      result.current.followNewContent(true)
    })
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    act(() => {
      frameCallback?.(0)
    })
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: 'auto' })

    act(() => {
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
      element.scrollTop = 100
      element.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.isAtBottom).toBe(false)
    expect(result.current.shouldFollowNewContent()).toBe(false)

    act(() => {
      result.current.scrollChatToBottom()
      element.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.isAtBottom).toBe(true)
    expect(result.current.shouldFollowNewContent()).toBe(true)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1_000, behavior: 'auto' })

    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
