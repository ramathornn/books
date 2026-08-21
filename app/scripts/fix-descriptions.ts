import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

// Matches +GST, +HST, +PST, +QST, +TAX, or any +UPPERCASE(2-4 chars) at end of string
const TAX_SUFFIX_REGEX = /\+([A-Z]{2,4})$/

async function main() {
  console.log('=== Fix +TAX Concatenated Descriptions ===')

  // --- Fix InvoiceLineItems ---
  const invoiceLineItems = await prisma.invoiceLineItem.findMany()
  let invoiceFixed = 0

  for (const li of invoiceLineItems) {
    const match = li.description.match(TAX_SUFFIX_REGEX)
    if (match) {
      const taxCode = match[1]
      const cleanDescription = li.description.replace(TAX_SUFFIX_REGEX, '').trim()

      // Ensure tax_codes array includes the extracted code
      const existingCodes: string[] = li.taxCodes || []
      const updatedCodes = existingCodes.includes(taxCode)
        ? existingCodes
        : [...existingCodes, taxCode]

      await prisma.invoiceLineItem.update({
        where: { id: li.id },
        data: {
          description: cleanDescription,
          taxCodes: updatedCodes,
        },
      })

      console.log(`  Invoice LI: "${li.description}" => "${cleanDescription}" [+${taxCode}]`)
      invoiceFixed++
    }
  }

  // --- Fix EstimateLineItems ---
  const estimateLineItems = await prisma.estimateLineItem.findMany()
  let estimateFixed = 0

  for (const li of estimateLineItems) {
    const match = li.description.match(TAX_SUFFIX_REGEX)
    if (match) {
      const taxCode = match[1]
      const cleanDescription = li.description.replace(TAX_SUFFIX_REGEX, '').trim()

      const existingCodes: string[] = li.taxCodes || []
      const updatedCodes = existingCodes.includes(taxCode)
        ? existingCodes
        : [...existingCodes, taxCode]

      await prisma.estimateLineItem.update({
        where: { id: li.id },
        data: {
          description: cleanDescription,
          taxCodes: updatedCodes,
        },
      })

      console.log(`  Estimate LI: "${li.description}" => "${cleanDescription}" [+${taxCode}]`)
      estimateFixed++
    }
  }

  console.log(`\n=== Results ===`)
  console.log(`Invoice line items fixed: ${invoiceFixed} / ${invoiceLineItems.length} total`)
  console.log(`Estimate line items fixed: ${estimateFixed} / ${estimateLineItems.length} total`)
}

main()
  .catch((e) => {
    console.error('Fix-descriptions failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
