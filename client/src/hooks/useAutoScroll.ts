import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { recordChatPerformance } from '#utils/chatPerformanceDiagnostics'

export const SCROLL_FOLLOW_THRESHOLD = 96

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < SCROLL_FOLLOW_THRESHOLD
}

export function useAutoScroll(
  chatBox: RefObject<HTMLElement | null>,
  contentBox?: RefObject<HTMLElement | null>,
) {
  const animationFrameRef = useRef<number | null>(null)
  const shouldFollowRef = useRef(true)
  const userScrollIntentUntilRef = useRef(0)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const setFollowState = useCallback((shouldFollow: boolean) => {
    shouldFollowRef.current = shouldFollow
    setIsAtBottom((current) => current === shouldFollow ? current : shouldFollow)
  }, [])

  const scrollChatToBottom = useCallback(() => {
    const element = chatBox.current
    if (!element) return

    userScrollIntentUntilRef.current = 0
    setFollowState(true)
    recordChatPerformance('scroll-execute')
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior: 'auto' })
      return
    }
    element.scrollTop = element.scrollHeight
  }, [chatBox, setFollowState])

  const shouldFollowNewContent = useCallback(() => {
    return shouldFollowRef.current
  }, [])

  const scheduleScrollToBottom = useCallback(() => {
    if (animationFrameRef.current !== null) return

    recordChatPerformance('scroll-schedule')
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      if (shouldFollowRef.current) scrollChatToBottom()
    })
  }, [scrollChatToBottom])

  const followNewContent = useCallback(
    (shouldFollow: boolean) => {
      setFollowState(shouldFollow)
      if (shouldFollow) scheduleScrollToBottom()
    },
    [scheduleScrollToBottom, setFollowState],
  )

  useEffect(() => {
    const element = chatBox.current
    const content = contentBox?.current ?? element
    if (!element || !content) return

    let pointerActive = false
    let touchActive = false
    const markUserScrollIntent = () => {
      userScrollIntentUntilRef.current = performance.now() + 500
    }
    const handleWheel = () => {
      markUserScrollIntent()
    }
    const handlePointerDown = () => {
      pointerActive = true
      markUserScrollIntent()
    }
    const handlePointerUp = () => {
      pointerActive = false
    }
    const handleTouchStart = () => {
      touchActive = true
      markUserScrollIntent()
    }
    const handleTouchEnd = () => {
      touchActive = false
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
      ) {
        return
      }
      markUserScrollIntent()
    }
    const updateFollowState = () => {
      if (isNearBottom(element)) {
        setFollowState(true)
      } else if (
        pointerActive ||
        touchActive ||
        performance.now() <= userScrollIntentUntilRef.current
      ) {
        setFollowState(false)
      }
    }
    const handleContentResize = () => {
      if (shouldFollowRef.current) scheduleScrollToBottom()
    }

    setFollowState(isNearBottom(element))
    element.addEventListener('scroll', updateFollowState, { passive: true })
    element.addEventListener('wheel', handleWheel, { passive: true })
    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('pointerdown', handlePointerDown, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    window.addEventListener('pointerup', handlePointerUp, { passive: true })
    window.addEventListener('pointercancel', handlePointerUp, { passive: true })
    window.addEventListener('keydown', handleKeyDown)

    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(handleContentResize)
      resizeObserver.observe(content)
      let observedMessageList: Element | null = null
      const observeMessageList = () => {
        const nextMessageList = content.querySelector('.message-list')
        if (nextMessageList === observedMessageList) return
        if (observedMessageList) resizeObserver?.unobserve(observedMessageList)
        observedMessageList = nextMessageList
        if (observedMessageList) {
          resizeObserver?.observe(observedMessageList)
          handleContentResize()
        }
      }
      observeMessageList()
      mutationObserver = new MutationObserver(observeMessageList)
      mutationObserver.observe(content, { childList: true })
    } else {
      mutationObserver = new MutationObserver(handleContentResize)
      mutationObserver.observe(content, {
        childList: true,
        characterData: true,
        subtree: true,
      })
    }

    return () => {
      element.removeEventListener('scroll', updateFollowState)
      element.removeEventListener('wheel', handleWheel)
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchEnd)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('keydown', handleKeyDown)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [chatBox, contentBox, scheduleScrollToBottom, setFollowState])

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    },
    [],
  )

  return {
    followNewContent,
    isAtBottom,
    scrollChatToBottom,
    shouldFollowNewContent,
  }
}
