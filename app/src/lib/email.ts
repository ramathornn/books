import { getCompanySettings } from '@/lib/company'
import { getEmailProvider } from '@/lib/emailProvider'

const from = process.env.EMAIL_FROM || ''

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// **bold** / *italic* markers (from the send-email editor) → real tags.
// Runs on already-escaped text so it can't introduce arbitrary HTML.
function inlineFormat(escaped: string) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
}

export async function sendInvoiceEmail(opts: {
  to: string[]
  cc?: string[]
  subject?: string
  message: string
  invoiceNumber: string
  amountDue: string
  currency: string
  dateDue: string | null
  isOverdue: boolean
  shareUrl: string
  attachment?: { filename: string; content: Buffer }
}): Promise<boolean> {
  const provider = getEmailProvider()
  if (!provider) {
    console.warn('[email] no email provider configured — skipping email')
    return false
  }

  const company = await getCompanySettings()
  // Brand wordmark: first word bold, remainder light (e.g. "UGO" + "Media Inc.")
  const [brandFirst, ...brandRestParts] = company.legalName.split(' ')
  const brandRest = brandRestParts.join(' ')

  const subject =
    opts.subject?.trim() ||
    (opts.isOverdue
      ? `Overdue invoice ${opts.invoiceNumber} from ${company.legalName}`
      : `Invoice ${opts.invoiceNumber} from ${company.legalName}`)
  // Link shortcodes rendered inline where the sender placed them:
  //   {{invoice.link}}            → default "View invoice" link to the share URL
  //   {{link:label|href}}         → custom label/href (empty href falls back to share URL)
  // The bottom CTA button only appears when no link shortcode is used.
  const LINK_TOKEN_RE = /\{\{link:([^|}]*)\|([^}]*)\}\}|\{\{invoice\.link\}\}/g
  const hasLinkShortcode = LINK_TOKEN_RE.test(opts.message)
  LINK_TOKEN_RE.lastIndex = 0
  let messageHtml = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = LINK_TOKEN_RE.exec(opts.message)) !== null) {
    messageHtml += inlineFormat(escapeHtml(opts.message.slice(last, m.index)))
    const label = (m[1] ?? '').trim() || 'View invoice'
    const href = (m[2] ?? '').trim() || opts.shareUrl
    messageHtml += `<a href="${escapeHtml(href)}" style="color:#0075DD;font-weight:600;text-decoration:underline">${escapeHtml(label)}</a>`
    last = m.index + m[0].length
  }
  messageHtml += inlineFormat(escapeHtml(opts.message.slice(last)))
  messageHtml = messageHtml.replace(/\n/g, '<br>')
  const html = `
  <body style="margin:0;padding:0;background-color:#F4F5F7">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F5F7;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:8px;overflow:hidden;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">

          <!-- Brand bar -->
          <tr><td align="center" style="background-color:#001B40;padding:20px 32px">
            <span style="color:#FFFFFF;font-size:16px;letter-spacing:0.5px"><span style="font-weight:700">${escapeHtml(brandFirst)}</span>${brandRest ? `<span style="font-weight:300"> ${escapeHtml(brandRest)}</span>` : ''}</span>
          </td></tr>

          <tr><td align="center" style="padding:36px 32px 8px">
            <h1 style="color:#001B40;font-size:22px;margin:0 0 4px">Invoice ${opts.invoiceNumber}</h1>
            ${opts.isOverdue ? '<p style="color:#B42318;font-size:13px;font-weight:600;margin:0;text-transform:uppercase;letter-spacing:1px">Overdue</p>' : ''}
          </td></tr>

          <!-- Sender message -->
          <tr><td style="padding:16px 32px 0">
            <p style="color:#334155;font-size:14px;line-height:1.6;margin:0">${messageHtml}</p>
          </td></tr>

          <!-- Amount panel -->
          <tr><td style="padding:24px 32px 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px">
              <tr><td align="center" style="padding:20px 16px 4px;color:#576981;font-size:12px;text-transform:uppercase;letter-spacing:1px">Amount due</td></tr>
              <tr><td align="center" style="padding:0 16px 16px;color:#001B40;font-size:32px;font-weight:700">${opts.amountDue}&nbsp;<span style="font-size:16px;font-weight:500;color:#576981">${opts.currency}</span></td></tr>
              ${opts.dateDue ? `<tr><td style="border-top:1px solid #E5E7EB;padding:12px 24px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
                  <tr>
                    <td style="color:#576981;padding:4px 0">Due date</td>
                    <td align="right" style="color:#001B40;font-weight:600;padding:4px 0">${opts.dateDue}</td>
                  </tr>
                </table>
              </td></tr>` : ''}
            </table>
          </td></tr>

          <!-- CTA (only when the message doesn't place the link itself) -->
          ${hasLinkShortcode ? '<tr><td style="padding:0 32px 32px"></td></tr>' : `<tr><td align="center" style="padding:28px 32px 32px">
            <a href="${opts.shareUrl}" style="display:inline-block;background-color:#0075DD;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px">View invoice</a>
          </td></tr>`}

          <!-- Footer -->
          <tr><td style="background-color:#F8FAFC;border-top:1px solid #E5E7EB;padding:16px 32px">
            <p style="color:#9AA5B5;font-size:11px;margin:0;text-align:center">${escapeHtml(company.legalName)}</p>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
  `

  // Single message: all To recipients on one email, CC list visible to everyone.
  return provider.send({
    from,
    to: opts.to,
    cc: opts.cc,
    subject,
    html,
    attachment: opts.attachment,
  })
}

export async function sendPaymentReceiptEmail(opts: {
  to: string
  clientName: string
  invoiceNumber: string
  amount: string
  currency: string
  paymentDate: string
  shareUrl: string
  attachment?: { filename: string; content: Buffer }
}) {
  const provider = getEmailProvider()
  if (!provider) {
    console.warn('[email] no email provider configured — skipping email')
    return
  }

  const company = await getCompanySettings()
  const footer = company.addressSingleLine
    ? `${company.legalName} · ${company.addressSingleLine}`
    : company.legalName

  const subject = `Payment received for invoice ${opts.invoiceNumber}`
  const html = `
  <body style="margin:0;padding:0;background-color:#F4F5F7">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F5F7;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:8px;overflow:hidden;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">

          <!-- Brand bar -->
          <tr><td style="background-color:#001B40;padding:20px 32px">
            <span style="color:#FFFFFF;font-size:16px;font-weight:700;letter-spacing:0.5px">${company.legalName}</span>
          </td></tr>

          <!-- Check + heading -->
          <tr><td align="center" style="padding:36px 32px 8px">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td align="center" valign="middle" style="width:56px;height:56px;border-radius:50%;background-color:#D4EDDA;color:#155724;font-size:28px;font-weight:700;line-height:56px">&#10003;</td>
            </tr></table>
            <h1 style="color:#001B40;font-size:22px;margin:16px 0 4px">Payment received</h1>
            <p style="color:#576981;font-size:14px;margin:0">Thank you for your payment, ${opts.clientName}.</p>
          </td></tr>

          <!-- Amount panel -->
          <tr><td style="padding:24px 32px 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px">
              <tr><td align="center" style="padding:20px 16px 4px;color:#576981;font-size:12px;text-transform:uppercase;letter-spacing:1px">Amount paid</td></tr>
              <tr><td align="center" style="padding:0 16px 16px;color:#001B40;font-size:32px;font-weight:700">${opts.amount}&nbsp;<span style="font-size:16px;font-weight:500;color:#576981">${opts.currency}</span></td></tr>
              <tr><td style="border-top:1px solid #E5E7EB;padding:12px 24px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
                  <tr>
                    <td style="color:#576981;padding:4px 0">Invoice</td>
                    <td align="right" style="color:#001B40;font-weight:600;padding:4px 0">${opts.invoiceNumber}</td>
                  </tr>
                  <tr>
                    <td style="color:#576981;padding:4px 0">Payment date</td>
                    <td align="right" style="color:#001B40;font-weight:600;padding:4px 0">${opts.paymentDate}</td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </td></tr>

          <!-- CTA -->
          <tr><td align="center" style="padding:28px 32px 8px">
            <a href="${opts.shareUrl}" style="display:inline-block;background-color:#0075DD;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px">View paid invoice</a>
          </td></tr>

          <tr><td align="center" style="padding:8px 32px 32px">
            <p style="color:#9AA5B5;font-size:12px;margin:0">A PDF receipt is attached to this email for your records.</p>
          </td></tr>

          <!-- Footer -->
          <tr><td style="background-color:#F8FAFC;border-top:1px solid #E5E7EB;padding:16px 32px">
            <p style="color:#9AA5B5;font-size:11px;margin:0;text-align:center">${footer}</p>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
  `

  await provider.send({ from, to: opts.to, subject, html, attachment: opts.attachment })
}
