'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import NewCategoryDialog from './NewCategoryDialog'

export default function NewCategoryButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded"
      >
        + New Category
      </button>
      <NewCategoryDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          router.refresh()
        }}
      />
    </>
  )
}
