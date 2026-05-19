import { nextTick, type Ref } from 'vue'

const SCROLL_FOLLOW_THRESHOLD = 96

export function useAutoScroll(chatBox: Ref<HTMLElement | null>) {
  function scrollChatToBottom() {
    chatBox.value?.scrollTo({
      top: chatBox.value.scrollHeight,
      behavior: 'smooth',
    })
  }

  function shouldFollowNewContent() {
    const element = chatBox.value

    if (!element) {
      return true
    }

    return (
      element.scrollHeight - element.scrollTop - element.clientHeight < SCROLL_FOLLOW_THRESHOLD
    )
  }

  async function followNewContent(shouldFollow: boolean) {
    if (!shouldFollow) {
      return
    }

    await nextTick()
    scrollChatToBottom()
  }

  return {
    followNewContent,
    scrollChatToBottom,
    shouldFollowNewContent,
  }
}
