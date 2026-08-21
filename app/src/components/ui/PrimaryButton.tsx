'use client'

import Link from 'next/link'
import { ReactNode } from 'react'

interface PrimaryButtonProps {
  children: ReactNode
  href?: string
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  className?: string
}

const BASE_CLASSES =
  'inline-flex items-center justify-center bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium px-5 py-2 rounded transition-colors'

export default function PrimaryButton({
  children,
  href,
  onClick,
  disabled,
  type = 'button',
  className = '',
}: PrimaryButtonProps) {
  const classes = `${BASE_CLASSES} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`.trim()

  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    )
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classes}>
      {children}
    </button>
  )
}
