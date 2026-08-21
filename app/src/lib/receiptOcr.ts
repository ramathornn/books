import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

export const ReceiptSchema = z.object({
  date: z
    .string()
    .describe(
      'Date of the receipt in YYYY-MM-DD format. If only month/year is visible use the first of that month. Empty string if not visible.'
    ),
  vendor: z
    .string()
    .describe('Merchant or vendor name as printed on the receipt. Empty string if not visible.'),
  total: z
    .number()
    .describe('Grand total in the receipt’s currency, as a positive number. 0 if not visible.'),
  tax: z
    .number()
    .describe(
      'Tax portion (GST/HST/PST etc.) of the total, as a positive number. 0 if no tax line is shown.'
    ),
  currency: z
    .string()
    .describe('ISO currency code: CAD, USD, EUR, GBP, etc. Best guess from the receipt.'),
  suggestedCategory: z
    .string()
    .describe(
      'One of the seeded expense categories that best fits this receipt — examples: "Vehicle - Gas & Oil", "Meals and entertainment", "Office Supplies", "Telephone & Internet", "Bank Fees", "Computer & Software Expenses", "Travel". Pick "Uncategorized" if uncertain.'
    ),
  confidence: z
    .enum(['low', 'medium', 'high'])
    .describe('How confident you are in the extracted fields overall.'),
  notes: z
    .string()
    .describe(
      'Any additional context worth keeping (e.g. items purchased, payment method). Empty string if nothing notable.'
    ),
})

export type ReceiptExtraction = z.infer<typeof ReceiptSchema>

const SYSTEM_PROMPT = `You are an accounting assistant that reads receipts.
Extract the structured fields exactly as they appear. Be conservative — if a value is unclear, prefer empty/0 over guessing. The receipt may be in English, French, or German.`

const MIME_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
const MIME_PDF = 'application/pdf'

interface ExtractInput {
  buffer: Buffer
  mimeType: string
}

/**
 * Extract structured fields from a receipt image or PDF using Claude vision.
 * Returns null on any non-fatal failure (missing API key, parse failure, network).
 * Caller should treat null as "OCR unavailable" and fall through to manual entry.
 */
export async function extractReceipt({
  buffer,
  mimeType,
}: ExtractInput): Promise<ReceiptExtraction | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  // Optionally route through a self-hosted gateway/proxy (cost attribution,
  // governance, regional routing). Unset → the SDK default Anthropic endpoint.
  const baseURL = process.env.ANTHROPIC_BASE_URL
  const client = new Anthropic(baseURL ? { baseURL } : {})
  const data = buffer.toString('base64')

  const visionBlock = MIME_IMAGE.has(mimeType)
    ? ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg', data },
      })
    : mimeType === MIME_PDF
    ? ({
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data },
      })
    : null

  if (!visionBlock) return null

  try {
    const response = await client.messages.parse({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            visionBlock,
            {
              type: 'text',
              text: 'Extract the receipt fields. Return JSON matching the provided schema.',
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ReceiptSchema) },
    })

    return response.parsed_output ?? null
  } catch (e) {
    console.error('[receiptOcr] extraction failed:', e instanceof Error ? e.message : e)
    return null
  }
}
