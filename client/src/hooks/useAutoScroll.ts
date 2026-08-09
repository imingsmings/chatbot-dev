import { useCallback, useEffect, useRef, type RefObject } from 'react'

export const SCROLL_FOLLOW_THRESHOLD = 96

export function useAutoScroll(chatBox: RefObject<HTMLElement | null>) {
  const animationFrameRef = useRef<number | null>(null)
  const lastScrollTopRef = useRef(0)
  const shouldFollowRef = useRef(true)

  const scrollChatToBottom = useCallback(() => {
    const element = chatBox.current
    if (!element) return

    shouldFollowRef.current = true

    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior: 'auto' })
      lastScrollTopRef.current = element.scrollTop
      return
    }

    element.scrollTop = element.scrollHeight
    lastScrollTopRef.current = element.scrollTop
  }, [chatBox])

  const shouldFollowNewContent = useCallback(() => {
    const element = chatBox.current
    if (!element) return true

    if (element.scrollTop < lastScrollTopRef.current - 1) {
      shouldFollowRef.current = false
    } else if (
      element.scrollTop > lastScrollTopRef.current + 1 &&
      element.scrollHeight - element.scrollTop - element.clientHeight <
        SCROLL_FOLLOW_THRESHOLD
    ) {
      shouldFollowRef.current = true
    }
    lastScrollTopRef.current = element.scrollTop
    return shouldFollowRef.current
  }, [chatBox])

  const scheduleScrollToBottom = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      scrollChatToBottom()
    })
  }, [scrollChatToBottom])

  const followNewContent = useCallback(
    (shouldFollow: boolean) => {
      shouldFollowRef.current = shouldFollow
      if (!shouldFollow) {
        return
      }

      scheduleScrollToBottom()
    },
    [scheduleScrollToBottom],
  )

  useEffect(() => {
    const element = chatBox.current
    if (!element) return

    const updateFollowState = () => {
      shouldFollowRef.current =
        element.scrollHeight - element.scrollTop - element.clientHeight <
        SCROLL_FOLLOW_THRESHOLD
      lastScrollTopRef.current = element.scrollTop
    }
    const observer = new MutationObserver(() => {
      if (shouldFollowRef.current) {
        scheduleScrollToBottom()
      }
    })

    updateFollowState()
    element.addEventListener('scroll', updateFollowState, { passive: true })
    observer.observe(element, {
      childList: true,
      characterData: true,
      subtree: true,
    })

    return () => {
      element.removeEventListener('scroll', updateFollowState)
      observer.disconnect()
    }
  }, [chatBox, scheduleScrollToBottom])

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
    scrollChatToBottom,
    shouldFollowNewContent,
  }
}
