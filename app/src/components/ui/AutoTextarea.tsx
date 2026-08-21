'use client'

import { useEffect, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number
}

export default function AutoTextarea({ minRows = 2, value, rows, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      rows={rows ?? minRows}
      {...rest}
      style={{ overflow: 'hidden', ...(rest.style || {}) }}
    />
  )
}
