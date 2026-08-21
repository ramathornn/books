'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/lib/toast'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface SendInvoiceEmailModalProps {
  isOpen: boolean
  onClose: () => void
  invoiceId: string
  invoiceNumber: string
  clientEmail: string
  amountDue: number
  currency: string
  dateDue: string | null
  isDraft: boolean
  shareUrl: string
  companyName: string
  onSent: () => void
}

function escHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const PILL_CLASS =
  'inline-flex items-center bg-[#E6F1FB] text-[#0075DD] text-xs font-medium rounded-full px-2 py-0.5 mx-0.5 cursor-pointer select-none align-baseline hover:bg-[#D4E8F9]'

function pillMarkup(label: string, href: string) {
  return `<span data-pill="" data-label="${escHtml(label)}" data-href="${escHtml(href)}" contenteditable="false" draggable="true" class="${PILL_CLASS}">${escHtml(label)}<span class="opacity-60 text-[10px] ml-1">&#9998;</span></span>`
}

function createPillEl(label: string, href: string): HTMLElement {
  const tpl = document.createElement('span')
  tpl.innerHTML = pillMarkup(label, href)
  return tpl.firstChild as HTMLElement
}

// Variable pill: shows the resolved value, serializes back to {{invoice.*}}.
function varPillMarkup(varName: string, display: string) {
  return `<span data-var="${escHtml(varName)}" contenteditable="false" draggable="true" title="{{${escHtml(varName)}}}" class="${PILL_CLASS}">${escHtml(display)}</span>`
}

function createVarPillEl(varName: string, display: string): HTMLElement {
  const tpl = document.createElement('span')
  tpl.innerHTML = varPillMarkup(varName, display)
  return tpl.firstChild as HTMLElement
}

// Message text with \n → editor HTML with <br>; **bold** and *italic*
// markers render as real formatting.
function textToHtml(text: string) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br>')
}

// Template text → editor HTML: link and {{invoice.*}} shortcodes become pills,
// the rest is escaped text. `vars` maps var names to their display values.
function templateToEditorHtml(
  text: string,
  shareUrl: string,
  vars: Record<string, string>
): string {
  const re =
    /\{\{link:([^|}]*)\|([^}]*)\}\}|\{\{invoice\.link\}\}|\{\{(invoice\.(?:number|amount|dueDate))\}\}/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out += textToHtml(text.slice(last, m.index))
    if (m[3]) {
      out += varPillMarkup(m[3], vars[m[3]] ?? '')
    } else {
      const label = (m[1] ?? '').trim() || 'View invoice'
      const href = (m[2] ?? '').trim() || shareUrl
      out += pillMarkup(label, href)
    }
    last = m.index + m[0].length
  }
  out += textToHtml(text.slice(last))
  return out
}

interface EmailTemplateOption {
  id: string
  name: string
  subject: string
  body: string
}

// Editor DOM → message string; pills become {{link:label|href}} tokens.
function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node instanceof HTMLElement) {
    if ('pill' in node.dataset) {
      return `{{link:${node.dataset.label || 'View invoice'}|${node.dataset.href || ''}}}`
    }
    if (node.dataset.var) {
      return `{{${node.dataset.var}}}`
    }
    if (node.tagName === 'BR') return '\n'
    const inner = Array.from(node.childNodes).map(serializeNode).join('')
    if (node.tagName === 'B' || node.tagName === 'STRONG') return `**${inner}**`
    if (node.tagName === 'I' || node.tagName === 'EM') return `*${inner}*`
    if (node.tagName === 'DIV' || node.tagName === 'P') return '\n' + inner
    return inner
  }
  return ''
}

function serializeEditor(editor: HTMLElement): string {
  return Array.from(editor.childNodes)
    .map(serializeNode)
    .join('')
    .replace(/^\n/, '')
}

export default function SendInvoiceEmailModal({
  isOpen,
  onClose,
  invoiceId,
  invoiceNumber,
  clientEmail,
  amountDue,
  currency,
  dateDue,
  isDraft,
  shareUrl,
  companyName,
  onSent,
}: SendInvoiceEmailModalProps) {
  const [emails, setEmails] = useState<string[]>([])
  const [emailInput, setEmailInput] = useState('')
  const [ccEmails, setCcEmails] = useState<string[]>([])
  const [ccInput, setCcInput] = useState('')
  const [attachPdf, setAttachPdf] = useState(true)
  const [sending, setSending] = useState(false)
  const [hasLink, setHasLink] = useState(true)
  const [pillEdit, setPillEdit] = useState<{
    el: HTMLElement
    label: string
    href: string
  } | null>(null)
  const [templates, setTemplates] = useState<EmailTemplateOption[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('default')
  const [subject, setSubject] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const ccInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const draggedPillRef = useRef<HTMLElement | null>(null)

  const currencySymbol =
    currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'

  const due = dateDue ? new Date(dateDue) : null
  const dueStr = due
    ? due.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null
  const amountStr = `${currencySymbol}${amountDue.toFixed(2)} ${currency}`

  const editorVars: Record<string, string> = {
    'invoice.number': invoiceNumber,
    'invoice.amount': amountStr,
    'invoice.dueDate': dueStr || '',
  }

  function defaultTemplateText(): string {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const overdue = due !== null && due < startOfToday
    if (overdue) {
      return `Hi,\n\nThis invoice is now overdue. Invoice {{invoice.number}} for {{invoice.amount}} was due on {{invoice.dueDate}}. You can view and pay it here: {{invoice.link}}\n\nThank you.`
    }
    if (dueStr) {
      return `Hi,\n\nYour invoice {{invoice.number}} for {{invoice.amount}} is due on {{invoice.dueDate}}. You can view and pay it here: {{invoice.link}}\n\nThank you.`
    }
    return `Hi,\n\nYour invoice {{invoice.number}} for {{invoice.amount}} is ready. You can view and pay it here: {{invoice.link}}\n\nThank you.`
  }

  function substituteVars(text: string): string {
    return text
      .replace(/\{\{invoice\.number\}\}/g, invoiceNumber)
      .replace(/\{\{invoice\.amount\}\}/g, amountStr)
      .replace(/\{\{invoice\.dueDate\}\}/g, dueStr || '')
  }

  function defaultSubject(): string {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const overdue = due !== null && due < startOfToday
    return overdue
      ? `Overdue invoice ${invoiceNumber} from ${companyName}`
      : `Invoice ${invoiceNumber} from ${companyName}`
  }

  function applyTemplate(templateId: string, list: EmailTemplateOption[]) {
    setSelectedTemplate(templateId)
    const custom = list.find((t) => t.id === templateId)
    const raw = custom ? custom.body : defaultTemplateText()
    setSubject(
      custom?.subject ? substituteVars(custom.subject) : defaultSubject()
    )
    if (editorRef.current) {
      // Tags stay unsubstituted here so they render as pills in the editor;
      // they resolve to real values at send time.
      editorRef.current.innerHTML = templateToEditorHtml(
        raw,
        shareUrl,
        editorVars
      )
    }
    syncHasLink()
  }

  useEffect(() => {
    if (!isOpen) return
    setEmails(clientEmail && EMAIL_RE.test(clientEmail) ? [clientEmail] : [])
    setEmailInput('')
    setCcEmails([])
    setCcInput('')
    setAttachPdf(true)
    setPillEdit(null)
    setHasLink(true)
    applyTemplate('default', [])

    fetch('/api/email-templates')
      .then((r) => r.json())
      .then((data) => setTemplates(data.data || []))
      .catch(() => setTemplates([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  function syncHasLink() {
    const editor = editorRef.current
    if (!editor) return
    setHasLink(
      !!editor.querySelector('[data-pill]') ||
        /\{\{(invoice\.link|link:)/.test(editor.textContent || '')
    )
  }

  function addEmailTo(
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    setInput: React.Dispatch<React.SetStateAction<string>>,
    raw: string
  ) {
    const email = raw.trim().toLowerCase().replace(/,$/, '')
    if (!email) return
    if (!EMAIL_RE.test(email)) {
      toast.error(`"${email}" is not a valid email address`)
      return
    }
    setList((prev) => (prev.includes(email) ? prev : [...prev, email]))
    setInput('')
  }

  function addEmail(raw: string) {
    addEmailTo(setEmails, setEmailInput, raw)
  }

  function addCcEmail(raw: string) {
    addEmailTo(setCcEmails, setCcInput, raw)
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email))
  }

  function removeCcEmail(email: string) {
    setCcEmails((prev) => prev.filter((e) => e !== email))
  }

  function handleEmailKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (emailInput.trim()) {
        e.preventDefault()
        addEmail(emailInput)
      }
    } else if (e.key === 'Backspace' && !emailInput && emails.length > 0) {
      removeEmail(emails[emails.length - 1])
    }
  }

  function handleCcKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (ccInput.trim()) {
        e.preventDefault()
        addCcEmail(ccInput)
      }
    } else if (e.key === 'Backspace' && !ccInput && ccEmails.length > 0) {
      removeCcEmail(ccEmails[ccEmails.length - 1])
    }
  }

  function insertElAtCaret(span: HTMLElement) {
    const editor = editorRef.current
    if (!editor) return
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(span)
      range.setStartAfter(span)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      editor.appendChild(span)
    }
    syncHasLink()
  }

  function insertPillAtCaret(label: string, href: string) {
    insertElAtCaret(createPillEl(label, href))
  }

  function insertVarAtCaret(varName: string) {
    insertElAtCaret(createVarPillEl(varName, editorVars[varName] ?? ''))
  }

  // Pasted text goes through the same shortcode→pill conversion as templates.
  function handleEditorPaste(e: React.ClipboardEvent) {
    const editor = editorRef.current
    if (!editor) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const html = templateToEditorHtml(text, shareUrl, editorVars)
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const lastNode = tpl.content.lastChild
      range.insertNode(tpl.content)
      if (lastNode) {
        range.setStartAfter(lastNode)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    } else {
      editor.appendChild(tpl.content)
    }
    syncHasLink()
  }

  function handleEditorClick(e: React.MouseEvent) {
    const pill = (e.target as HTMLElement).closest(
      '[data-pill]'
    ) as HTMLElement | null
    if (pill) {
      setPillEdit({
        el: pill,
        label: pill.dataset.label || 'View invoice',
        href: pill.dataset.href || shareUrl,
      })
    }
  }

  function handleEditorDragStart(e: React.DragEvent) {
    const pill = (e.target as HTMLElement).closest(
      '[data-pill],[data-var]'
    ) as HTMLElement | null
    if (pill) {
      draggedPillRef.current = pill
      e.dataTransfer.setData('application/x-pill', 'move')
      e.dataTransfer.effectAllowed = 'move'
    }
  }

  function handleEditorDrop(e: React.DragEvent) {
    const isPill =
      e.dataTransfer.types.includes('application/x-pill') ||
      e.dataTransfer.types.includes('application/x-var') ||
      !!draggedPillRef.current
    if (!isPill) return
    e.preventDefault()
    const editor = editorRef.current
    if (!editor) return

    let span: HTMLElement
    const varName = e.dataTransfer.getData('application/x-var')
    if (draggedPillRef.current) {
      span = draggedPillRef.current
      span.remove()
      draggedPillRef.current = null
    } else if (varName) {
      span = createVarPillEl(varName, editorVars[varName] ?? '')
    } else {
      span = createPillEl('View invoice', shareUrl)
    }

    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
    if (range && editor.contains(range.startContainer)) {
      range.insertNode(span)
    } else {
      editor.appendChild(span)
    }
    syncHasLink()
  }

  function savePillEdit() {
    if (!pillEdit) return
    const label =
      pillEdit.label.replace(/[{}|]/g, '').trim() || 'View invoice'
    const href = pillEdit.href.replace(/[{}|]/g, '').trim() || shareUrl
    const { el } = pillEdit
    el.dataset.label = label
    el.dataset.href = href
    el.innerHTML = `${escHtml(label)}<span class="opacity-60 text-[10px] ml-1">&#9998;</span>`
    setPillEdit(null)
  }

  function removePill() {
    if (!pillEdit) return
    pillEdit.el.remove()
    setPillEdit(null)
    syncHasLink()
  }

  async function handleSend() {
    const pending = emailInput.trim()
    let recipients = emails
    if (pending) {
      if (!EMAIL_RE.test(pending.toLowerCase().replace(/,$/, ''))) {
        toast.error(`"${pending}" is not a valid email address`)
        return
      }
      const cleaned = pending.toLowerCase().replace(/,$/, '')
      recipients = emails.includes(cleaned) ? emails : [...emails, cleaned]
    }
    if (recipients.length === 0) {
      toast.error('Add at least one recipient')
      return
    }
    let cc = ccEmails
    const pendingCc = ccInput.trim()
    if (pendingCc) {
      const cleanedCc = pendingCc.toLowerCase().replace(/,$/, '')
      if (!EMAIL_RE.test(cleanedCc)) {
        toast.error(`"${pendingCc}" is not a valid email address`)
        return
      }
      cc = cc.includes(cleanedCc) ? cc : [...cc, cleanedCc]
    }
    cc = cc.filter((e) => !recipients.includes(e))
    // Substitute tags at send time too, so typed-in {{invoice.*}} tags work.
    const message = substituteVars(
      editorRef.current ? serializeEditor(editorRef.current) : ''
    )

    setSending(true)
    try {
      if (isDraft) {
        const statusRes = await fetch(`/api/invoices/${invoiceId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'sent' }),
        })
        if (!statusRes.ok) {
          const data = await statusRes.json().catch(() => ({}))
          toast.error(data.error || 'Failed to mark invoice as sent')
          return
        }
      }

      const res = await fetch(`/api/invoices/${invoiceId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipients,
          cc,
          subject: substituteVars(subject),
          message,
          attachPdf,
        }),
      })
      if (res.ok) {
        const total = recipients.length + cc.length
        toast.success(
          `Invoice sent to ${total} recipient${total !== 1 ? 's' : ''}`
        )
        onSent()
        onClose()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to send email')
      }
    } catch {
      toast.error('Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send by Email" disableOutsideClose>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Template
          </label>
          <select
            value={selectedTemplate}
            onChange={(e) => applyTemplate(e.target.value, templates)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
          >
            <option value="default">Default</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            To
          </label>
          <div
            className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5 focus-within:border-[#2FA84F] focus-within:ring-1 focus-within:ring-[#2FA84F] cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {emails.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 text-sm rounded-full pl-2.5 pr-1 py-0.5"
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  className="w-4 h-4 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-300 hover:text-gray-700"
                  aria-label={`Remove ${email}`}
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={handleEmailKeyDown}
              onBlur={() => emailInput.trim() && addEmail(emailInput)}
              placeholder={emails.length === 0 ? 'Type an email and press Enter' : ''}
              className="flex-1 min-w-[140px] border-0 outline-none text-sm py-1 px-1 bg-transparent"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Cc
          </label>
          <div
            className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5 focus-within:border-[#2FA84F] focus-within:ring-1 focus-within:ring-[#2FA84F] cursor-text"
            onClick={() => ccInputRef.current?.focus()}
          >
            {ccEmails.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 text-sm rounded-full pl-2.5 pr-1 py-0.5"
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeCcEmail(email)}
                  className="w-4 h-4 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-300 hover:text-gray-700"
                  aria-label={`Remove ${email}`}
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              ref={ccInputRef}
              type="email"
              value={ccInput}
              onChange={(e) => setCcInput(e.target.value)}
              onKeyDown={handleCcKeyDown}
              onBlur={() => ccInput.trim() && addCcEmail(ccInput)}
              placeholder={ccEmails.length === 0 ? 'Cc recipients (optional)' : ''}
              className="flex-1 min-w-[140px] border-0 outline-none text-sm py-1 px-1 bg-transparent"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
          />
          <p className="text-xs text-gray-400 mt-1">
            Tags for subject &amp; message: {'{{invoice.number}}'} · {'{{invoice.amount}}'} · {'{{invoice.dueDate}}'}
          </p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700">Message</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  document.execCommand('bold')
                }}
                title="Bold selection"
                className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 text-gray-600 text-xs font-bold hover:bg-gray-100"
              >
                B
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  document.execCommand('italic')
                }}
                title="Italicize selection"
                className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 text-gray-600 text-xs italic font-serif hover:bg-gray-100"
              >
                I
              </button>
              {(
                [
                  ['invoice.number', 'Invoice #'],
                  ['invoice.amount', 'Amount'],
                ] as const
              ).map(([varName, label]) => (
                <span
                  key={varName}
                  draggable
                  onDragStart={(e) => {
                    draggedPillRef.current = null
                    e.dataTransfer.setData('application/x-var', varName)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => insertVarAtCaret(varName)}
                  title="Drag into the message or click to insert at the cursor"
                  className="inline-flex items-center gap-1 bg-[#E6F1FB] text-[#0075DD] text-xs font-medium rounded-full px-2.5 py-1 cursor-grab active:cursor-grabbing select-none hover:bg-[#D4E8F9]"
                >
                  {label}
                </span>
              ))}
              <span
                draggable
                onDragStart={(e) => {
                  draggedPillRef.current = null
                  e.dataTransfer.setData('application/x-pill', 'new')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => insertPillAtCaret('View invoice', shareUrl)}
                title="Drag into the message or click to insert at the cursor"
                className="inline-flex items-center gap-1 bg-[#E6F1FB] text-[#0075DD] text-xs font-medium rounded-full px-2.5 py-1 cursor-grab active:cursor-grabbing select-none hover:bg-[#D4E8F9]"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m7.5-1.5l1.5-1.5a4 4 0 015.656 5.656l-3 3" transform="rotate(90 12 12)" />
                </svg>
                Invoice link
              </span>
            </div>
          </div>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onClick={handleEditorClick}
            onPaste={handleEditorPaste}
            onInput={syncHasLink}
            onDragStart={handleEditorDragStart}
            onDragOver={(e) => {
              if (
                e.dataTransfer.types.includes('application/x-pill') ||
                e.dataTransfer.types.includes('application/x-var') ||
                draggedPillRef.current
              ) {
                e.preventDefault()
              }
            }}
            onDrop={handleEditorDrop}
            className="w-full min-h-[144px] rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F] whitespace-pre-wrap"
          />
          {pillEdit ? (
            <div className="mt-2 border border-gray-200 rounded-md bg-gray-50 p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">Edit link</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pillEdit.label}
                  onChange={(e) =>
                    setPillEdit({ ...pillEdit, label: e.target.value })
                  }
                  placeholder="Link text"
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
                />
                <input
                  type="url"
                  value={pillEdit.href}
                  onChange={(e) =>
                    setPillEdit({ ...pillEdit, href: e.target.value })
                  }
                  placeholder="https://..."
                  className="flex-[2] rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
                />
              </div>
              <div className="flex justify-between items-center">
                <button
                  type="button"
                  onClick={removePill}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove link
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPillEdit(null)}
                    className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={savePillEdit}
                    className="px-3 py-1 text-xs font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-1">
              {hasLink
                ? 'Click the pill to edit its text and URL, or drag it to move it.'
                : 'No link placed — a "View invoice" button will be added at the bottom of the email.'}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={attachPdf}
            onClick={() => setAttachPdf((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${attachPdf ? 'bg-[#2FA84F]' : 'bg-gray-300'}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${attachPdf ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
            />
          </button>
          <span
            className="text-sm text-gray-700"
            onClick={() => setAttachPdf((v) => !v)}
          >
            Attach invoice PDF
          </span>
        </label>
        {isDraft && (
          <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2">
            Sending will mark this draft invoice as sent.
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md disabled:opacity-50 transition-colors"
          >
            {sending ? 'Sending...' : 'Send Email'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
