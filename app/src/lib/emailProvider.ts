// Pluggable email-sending providers.
//
// The transport is selected by EMAIL_PROVIDER ("mailgun" | "resend"); each
// adapter reads its own credentials from env. Default is Mailgun, so existing
// deployments are unaffected. Adding another provider (SES, Postmark, …) is a
// new entry in PROVIDERS implementing the same interface.

export interface SendEmailOpts {
  from: string
  to: string | string[]
  cc?: string[]
  subject: string
  html: string
  attachment?: { filename: string; content: Buffer }
}

export interface EmailProvider {
  readonly name: string
  /** Send one message. Returns true on success; never throws (logs + returns false). */
  send(opts: SendEmailOpts): Promise<boolean>
}

function mailgunProvider(): EmailProvider | null {
  const apiKey = process.env.MAILGUN_API_KEY
  if (!apiKey) return null
  const domain = process.env.MAILGUN_DOMAIN || 'example.com'
  const region = (process.env.MAILGUN_REGION || 'us').toLowerCase() // 'us' or 'eu'
  const baseUrl =
    region === 'eu'
      ? `https://api.eu.mailgun.net/v3/${domain}/messages`
      : `https://api.mailgun.net/v3/${domain}/messages`
  return {
    name: 'mailgun',
    async send(opts) {
      // Mailgun requires multipart/form-data for the `attachment` field;
      // FormData works for the no-attachment case too (fetch sets the boundary).
      const form = new FormData()
      form.set('from', opts.from || `postmaster@${domain}`)
      form.set('to', Array.isArray(opts.to) ? opts.to.join(', ') : opts.to)
      if (opts.cc && opts.cc.length > 0) form.set('cc', opts.cc.join(', '))
      form.set('subject', opts.subject)
      form.set('html', opts.html)
      if (opts.attachment) {
        form.set(
          'attachment',
          new Blob([new Uint8Array(opts.attachment.content)], { type: 'application/pdf' }),
          opts.attachment.filename
        )
      }
      try {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64'),
          },
          body: form,
        })
        if (!res.ok) {
          console.error('[email] Mailgun send failed', res.status, await res.text())
          return false
        }
        return true
      } catch (e) {
        console.error('[email] send failed', e)
        return false
      }
    },
  }
}

function resendProvider(): EmailProvider | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  return {
    name: 'resend',
    async send(opts) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: opts.from,
            to: opts.to,
            ...(opts.cc && opts.cc.length > 0 && { cc: opts.cc }),
            subject: opts.subject,
            html: opts.html,
            ...(opts.attachment && {
              attachments: [
                {
                  filename: opts.attachment.filename,
                  content: opts.attachment.content.toString('base64'),
                },
              ],
            }),
          }),
        })
        if (!res.ok) {
          console.error('[email] Resend send failed', res.status, await res.text())
          return false
        }
        return true
      } catch (e) {
        console.error('[email] send failed', e)
        return false
      }
    },
  }
}

const PROVIDERS: Record<string, () => EmailProvider | null> = {
  mailgun: mailgunProvider,
  resend: resendProvider,
}

/**
 * Resolve the configured email provider, or null if it has no usable
 * credentials (caller should then skip sending). Defaults to Mailgun.
 */
export function getEmailProvider(): EmailProvider | null {
  const name = (process.env.EMAIL_PROVIDER || 'mailgun').toLowerCase()
  const factory = PROVIDERS[name]
  if (!factory) {
    console.warn(`[email] unknown EMAIL_PROVIDER "${name}" — falling back to mailgun`)
    return mailgunProvider()
  }
  return factory()
}
