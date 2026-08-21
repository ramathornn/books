export type ToastType = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  type: ToastType
  message: string
}

type Listener = (toast: ToastMessage) => void

let listeners: Listener[] = []
let nextId = 1

function emit(type: ToastType, message: string) {
  const payload: ToastMessage = { id: nextId++, type, message }
  for (const l of listeners) l(payload)
}

export const toast = {
  success(message: string) {
    emit('success', message)
  },
  error(message: string) {
    emit('error', message)
  },
  info(message: string) {
    emit('info', message)
  },
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}
