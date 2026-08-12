import { useCallback, useRef, useState } from 'react'

export type DialogMode = 'alert' | 'confirm' | 'prompt'

export type DialogState = {
  cancelLabel: string
  confirmLabel: string
  danger: boolean
  fieldLabel: string
  initialValue: string
  message: string
  mode: DialogMode
  multiline: boolean
  open: boolean
  title: string
}

const initialState: DialogState = {
  cancelLabel: '取消',
  confirmLabel: '确定',
  danger: false,
  fieldLabel: '会话名称',
  initialValue: '',
  message: '',
  mode: 'alert',
  multiline: false,
  open: false,
  title: '',
}

export function useAppDialog() {
  const [dialog, setDialog] = useState(initialState)
  const resolveDialogRef = useRef<((value: string | boolean | null) => void) | null>(null)

  const openDialog = useCallback(
    (options: Partial<DialogState> & Pick<DialogState, 'message' | 'mode' | 'title'>) => {
      resolveDialogRef.current?.(null)
      setDialog({
        ...initialState,
        confirmLabel: options.mode === 'alert' ? '知道了' : '确定',
        ...options,
        open: true,
      })

      return new Promise<string | boolean | null>((resolve) => {
        resolveDialogRef.current = resolve
      })
    },
    [],
  )

  const closeDialog = useCallback((value: string | boolean | null) => {
    const resolve = resolveDialogRef.current
    resolveDialogRef.current = null
    setDialog((current) => ({ ...current, open: false }))
    window.setTimeout(() => resolve?.(value), 0)
  }, [])

  const showError = useCallback(
    async (message: string, title = '操作失败') => {
      await openDialog({ message, mode: 'alert', title })
    },
    [openDialog],
  )

  const confirmAction = useCallback(
    async (options: {
      confirmLabel?: string
      danger?: boolean
      message: string
      title: string
    }) =>
      (await openDialog({
        cancelLabel: '取消',
        confirmLabel: options.confirmLabel ?? '确定',
        danger: options.danger ?? false,
        message: options.message,
        mode: 'confirm',
        title: options.title,
      })) === true,
    [openDialog],
  )

  const promptText = useCallback(
    async (options: {
      fieldLabel?: string
      initialValue: string
      message: string
      multiline?: boolean
      title: string
    }) => {
      const result = await openDialog({
        confirmLabel: '保存',
        fieldLabel: options.fieldLabel ?? '会话名称',
        initialValue: options.initialValue,
        message: options.message,
        mode: 'prompt',
        multiline: options.multiline ?? false,
        title: options.title,
      })
      return typeof result === 'string' ? result.trim() : null
    },
    [openDialog],
  )

  return { closeDialog, confirmAction, dialog, openDialog, promptText, showError }
}
