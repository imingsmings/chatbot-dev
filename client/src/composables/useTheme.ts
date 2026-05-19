import { computed, ref } from 'vue'
import type { ThemeMode } from '@/types/chat'

const THEME_STORAGE_KEY = 'chatbot-theme'

function readStoredTheme() {
  try {
    return window.localStorage?.getItem(THEME_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredTheme(nextTheme: ThemeMode) {
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, nextTheme)
  } catch {
    // Theme still changes for the current session when storage is unavailable.
  }
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedTheme = readStoredTheme()
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(nextTheme: ThemeMode) {
  document.documentElement.style.colorScheme = nextTheme
}

export function useTheme() {
  const theme = ref<ThemeMode>(getInitialTheme())
  const themeToggleLabel = computed(() => (theme.value === 'dark' ? '浅色' : '深色'))

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    writeStoredTheme(theme.value)
    applyTheme(theme.value)
  }

  return {
    applyTheme,
    theme,
    themeToggleLabel,
    toggleTheme,
  }
}
