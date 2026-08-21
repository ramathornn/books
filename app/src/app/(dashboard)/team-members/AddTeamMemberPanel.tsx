'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import PrimaryButton from '@/components/ui/PrimaryButton'

type Access = 'none' | 'accountant' | 'owner'

export default function AddTeamMemberPanel() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [access, setAccess] = useState<Access>('none')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // After a successful add with login access: the invite link to share.
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function resetForm() {
    setFirstName('')
    setLastName('')
    setEmail('')
    setJobTitle('')
    setAccess('none')
    setFieldErrors({})
    setFormError(null)
    setSubmitting(false)
    setInviteUrl(null)
    setInviteError(null)
    setCopied(false)
  }

  function handleClose() {
    if (submitting) return
    const refresh = !!inviteUrl || !!inviteError
    resetForm()
    setIsOpen(false)
    if (refresh) router.refresh()
  }

  async function copyLink() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — the link is still visible to select manually
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFieldErrors({})
    setFormError(null)

    const localErrors: Record<string, string> = {}
    if (!firstName.trim()) localErrors.firstName = 'First name is required'
    if (!lastName.trim()) localErrors.lastName = 'Last name is required'
    if (!email.trim()) localErrors.email = 'Email is required'
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/team-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          jobTitle: jobTitle.trim() || undefined,
        }),
      })

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        setFieldErrors({
          email: data?.error || 'A team member with this email already exists',
        })
        setSubmitting(false)
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.details && typeof data.details === 'object') {
          const details = data.details as Record<string, string | string[]>
          const normalized: Record<string, string> = {}
          for (const [k, v] of Object.entries(details)) {
            normalized[k] = Array.isArray(v) ? v[0] ?? '' : v
          }
          setFieldErrors(normalized)
        } else {
          setFormError(data?.error || 'Failed to add team member')
        }
        setSubmitting(false)
        return
      }

      // Member created. If they should be able to sign in, mint the invite
      // link now and keep the modal open to show it.
      if (access !== 'none') {
        const invRes = await fetch('/api/users/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), role: access }),
        })
        const invData = await invRes.json().catch(() => ({}))
        setSubmitting(false)
        if (invRes.ok) {
          setInviteUrl(invData.inviteUrl)
        } else {
          setInviteError(invData?.error || 'The team member was added, but the invite could not be created.')
        }
        return
      }

      resetForm()
      setIsOpen(false)
      router.refresh()
    } catch (err) {
      console.error(err)
      setFormError('Failed to add team member')
      setSubmitting(false)
    }
  }

  const showResult = !!inviteUrl || !!inviteError

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="bg-white border border-[#001B40] text-[#001B40] px-4 py-2 rounded text-sm font-medium hover:bg-[#001B40]/5 transition-colors"
      >
        Add Team Member
      </button>

      <Modal isOpen={isOpen} onClose={handleClose} title="Add Team Member">
        {showResult ? (
          <div className="space-y-4">
            {inviteUrl ? (
              <>
                <p className="text-sm text-gray-700">
                  Team member added. Share this sign-in invite link with them — it&apos;s
                  valid for 7 days and can be used once:
                </p>
                <div className="p-3 bg-green-50 rounded-md flex items-center gap-2">
                  <code className="text-xs text-gray-800 break-all flex-1">{inviteUrl}</code>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="text-xs text-[#0075DD] hover:underline shrink-0"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  No email is sent — send it yourself. You can copy it again later from this page.
                </p>
              </>
            ) : (
              <p className="text-sm text-[#BF2600]">{inviteError}</p>
            )}
            <div className="flex items-center justify-end pt-2">
              <PrimaryButton type="button" onClick={handleClose}>
                Done
              </PrimaryButton>
            </div>
          </div>
        ) : (
        <>
        <p className="text-sm text-gray-500 mb-4">
          Add a few details to get started
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="tm-firstName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              id="tm-firstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001B40]/20 focus:border-[#001B40]"
              required
              maxLength={100}
            />
            {fieldErrors.firstName && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.firstName}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="tm-lastName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              id="tm-lastName"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001B40]/20 focus:border-[#001B40]"
              required
              maxLength={100}
            />
            {fieldErrors.lastName && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.lastName}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="tm-email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="tm-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001B40]/20 focus:border-[#001B40]"
              required
            />
            {fieldErrors.email && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="tm-jobTitle"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Job Title
            </label>
            <input
              id="tm-jobTitle"
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001B40]/20 focus:border-[#001B40]"
            />
          </div>

          <div>
            <label
              htmlFor="tm-access"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Account Access
            </label>
            <select
              id="tm-access"
              value={access}
              onChange={(e) => setAccess(e.target.value as Access)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#001B40]/20 focus:border-[#001B40]"
            >
              <option value="none">No login</option>
              <option value="accountant">Accountant — read-only login</option>
              <option value="owner">Owner — full-access login</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Choosing a login type creates a one-time invite link you can share.
              Accountants can view everything but change nothing.
            </p>
          </div>

          {formError && (
            <div className="text-sm text-red-600">{formError}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <PrimaryButton type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add'}
            </PrimaryButton>
          </div>
        </form>
        </>
        )}
      </Modal>
    </>
  )
}
