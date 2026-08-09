import { useCallback, useEffect, useRef, useState } from 'react'

import type { ThemeMode } from '#types/chat'

export const THEME_STORAGE_KEY = 'chatbot-theme'

function readStoredTheme() {
  try {
    return window.localStorage?.getItem(THEME_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredTheme(theme: ThemeMode) {
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The in-memory theme remains usable when storage is unavailable.
  }
}

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedTheme = readStoredTheme()
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.style.colorScheme = theme
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    const nextTheme = themeRef.current === 'dark' ? 'light' : 'dark'
    themeRef.current = nextTheme
    setTheme(nextTheme)
    writeStoredTheme(nextTheme)
  }, [])

  return {
    theme,
    themeToggleLabel: theme === 'dark' ? '浅色' : '深色',
    toggleTheme,
  }
}
