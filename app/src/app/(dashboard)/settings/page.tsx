export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import TwoFactorSettings from '@/components/settings/TwoFactorSettings'
import PasskeySettings from '@/components/settings/PasskeySettings'
import BusinessProfileForm from '@/components/settings/BusinessProfileForm'
import StripeSourceSettings from '@/components/settings/StripeSourceSettings'
import EmailTemplatesSettings from '@/components/settings/EmailTemplatesSettings'
import { getCompanySettings } from '@/lib/company'
import prisma from '@/lib/prisma'

export const metadata: Metadata = {
  title: 'Settings',
}

export default async function SettingsPage() {
  const company = await getCompanySettings()

  // Stripe revenue-source connection (read-only subledger) + the chart it maps to.
  const [stripeConn, glAccounts, taxCodes, emailTemplates] = await Promise.all([
    prisma.stripeConnection.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.gLAccount.findMany({
      where: { isActive: true },
      orderBy: { accountNumber: 'asc' },
      select: { id: true, accountNumber: true, accountName: true, accountClass: true },
    }),
    prisma.taxCode.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    prisma.emailTemplate.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, subject: true, body: true },
    }),
  ])

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          View and manage your business information.
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* M1: Business Profile (editable) */}
        <BusinessProfileForm initial={company} />

        {/* Stripe revenue source (read-only subledger → per-charge draft JEs) */}
        <StripeSourceSettings
          glAccounts={glAccounts}
          taxCodes={taxCodes}
          connection={
            stripeConn
              ? {
                  id: stripeConn.id,
                  displayName: stripeConn.displayName,
                  accountId: stripeConn.accountId,
                  status: stripeConn.status,
                  lastSyncAt: stripeConn.lastSyncAt ? stripeConn.lastSyncAt.toISOString() : null,
                  lastError: stripeConn.lastError,
                }
              : null
          }
        />

        {/* Invoice email templates for Send by Email */}
        <EmailTemplatesSettings initial={emailTemplates} />

        {/* M1: Invoice Numbering */}
        <div className="bg-white rounded-sm shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Invoice Numbering
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Next Invoice Number
              </label>
              <input
                type="text"
                defaultValue="Auto-generated"
                readOnly
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-50 text-gray-900"
              />
              <p className="mt-1 text-xs text-gray-400">
                Invoice numbers are auto-incremented (e.g., 0000001, 0000002, ...).
              </p>
            </div>
          </div>
        </div>

        {/* M1: Payment Details */}
        <div className="bg-white rounded-sm shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Payment Details
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Payment Terms
              </label>
              <select
                defaultValue={company.defaultPaymentTerms}
                disabled
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-50 text-gray-900 opacity-70"
              >
                <option value="net15">Net 15</option>
                <option value="net30">Net 30</option>
                <option value="net45">Net 45</option>
                <option value="net60">Net 60</option>
                <option value="due_on_receipt">Due on Receipt</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Accepted Payment Methods
              </label>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                  Bank Transfer
                </span>
                <span className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                  Credit Card
                </span>
                <span className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                  E-Transfer
                </span>
                <span className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                  Cash
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* M1: Currency & Language */}
        <div className="bg-white rounded-sm shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Currency &amp; Language
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Currency
              </label>
              <input
                type="text"
                defaultValue="CAD - Canadian Dollar"
                readOnly
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-50 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Language
              </label>
              <input
                type="text"
                defaultValue="English"
                readOnly
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-50 text-gray-900"
              />
            </div>
          </div>
        </div>

        {/* Two-Factor Authentication */}
        <TwoFactorSettings />

        {/* Face ID & Passkeys */}
        <PasskeySettings />

        {/* M1: Advanced */}
        <div className="bg-white rounded-sm shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Advanced
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Change Password
              </label>
              <button
                disabled
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md opacity-50 cursor-not-allowed"
              >
                Update Password
              </button>
              <p className="mt-1 text-xs text-gray-400">
                Password changes will be available in a future update.
              </p>
            </div>
            <div className="pt-4 border-t border-gray-200">
              <a
                href="/api/auth/signout"
                className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 inline-block transition-colors"
              >
                Log Out
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
