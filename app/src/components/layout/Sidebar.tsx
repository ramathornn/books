'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useSidebar } from './SidebarContext'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  submenu?: { label: string; href: string; disabled?: boolean }[]
  disabled?: boolean
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" strokeLinejoin="round" />
        <path d="M7 14l3-3 3 3 4-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: 'Clients',
    href: '/clients',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.5 3.5-6 7-6s7 2.5 7 6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Estimates',
    href: '/estimates',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <rect x="8" y="6" width="8" height="3" rx="0.5" />
        <circle cx="9" cy="13" r="0.6" fill="currentColor" />
        <circle cx="12" cy="13" r="0.6" fill="currentColor" />
        <circle cx="15" cy="13" r="0.6" fill="currentColor" />
        <circle cx="9" cy="16" r="0.6" fill="currentColor" />
        <circle cx="12" cy="16" r="0.6" fill="currentColor" />
        <circle cx="15" cy="16" r="0.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: 'Invoices',
    href: '/invoices',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" strokeLinejoin="round" />
        <path d="M9 8h6M9 12h6M9 16h4" strokeLinecap="round" />
      </svg>
    ),
    submenu: [
      { label: 'All Invoices', href: '/invoices' },
      { label: 'Recurring Templates', href: '#', disabled: true },
      { label: 'Retainers', href: '#', disabled: true },
    ],
  },
  {
    label: 'Payments',
    href: '/payments',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinejoin="round" />
        <path d="M16 13h3" strokeLinecap="round" />
        <path d="M3 10h18" />
      </svg>
    ),
    submenu: [
      { label: 'Invoice Payments', href: '/payments' },
      { label: 'Online Payments', href: '#', disabled: true },
      { label: 'Checkout Links', href: '#', disabled: true },
    ],
  },
  {
    label: 'Expenses',
    href: '/expenses',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" strokeLinejoin="round" />
        <path d="M9 8h6M9 12h6M9 16h4" strokeLinecap="round" />
      </svg>
    ),
    submenu: [
      { label: 'All Expenses', href: '/expenses' },
      { label: 'Receipts', href: '/expenses/receipts' },
      { label: 'Categories', href: '/expenses/categories' },
      { label: 'Bills', href: '/bills' },
      { label: 'Vendors', href: '/vendors' },
      { label: 'Mileage', href: '/mileage' },
    ],
  },
  {
    label: 'Accounting',
    href: '/accounting',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M4 20h16" strokeLinecap="round" />
        <rect x="5" y="11" width="3" height="9" />
        <rect x="10.5" y="7" width="3" height="13" />
        <rect x="16" y="4" width="3" height="16" />
      </svg>
    ),
    submenu: [
      { label: 'Bank Accounts', href: '/banking' },
      { label: 'Reconcile', href: '/banking/reconcile' },
      { label: 'Rules', href: '/banking/rules' },
      { label: 'Chart of Accounts', href: '/accounting/chart-of-accounts' },
      { label: 'Journal Entries', href: '/accounting/journal-entries' },
      { label: 'Audit Log', href: '/accounting/audit-log' },
    ],
  },
  {
    label: 'Tax',
    href: '/tax',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" strokeLinecap="round" />
      </svg>
    ),
    submenu: [
      { label: 'T5 Slips', href: '/tax/t5' },
      { label: 'T4A Slips', href: '/tax/t4a' },
      { label: 'Personal Tax (T1)', href: '/tax/t1' },
      { label: 'Corporate Tax (T2)', href: '/tax/t2' },
      { label: 'Recipients', href: '/tax/recipients' },
      { label: 'GST/HST Returns', href: '/accounting/sales-tax' },
      { label: 'CCA Schedule', href: '/accounting/cca' },
      { label: 'Year-End Close', href: '/accounting/year-end-close' },
    ],
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 17v-4M12 17v-8M16 17v-2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Files',
    href: '/files',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinejoin="round" />
      </svg>
    ),
  },
]

interface BottomLink {
  label: string
  href: string
  disabled?: boolean
}

const bottomLinks: BottomLink[] = [
  { label: 'Team Members', href: '/team-members' },
  { label: 'Items and Services', href: '/items' },
  { label: 'Settings', href: '/settings' },
]

export default function Sidebar({
  companyName,
  readOnly = false,
}: {
  companyName: string
  readOnly?: boolean
}) {
  const pathname = usePathname()
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const { open, close } = useSidebar()

  // Accountant (read-only) sessions: Estimates, Team Members and Settings are
  // hidden (the proxy also blocks the routes server-side).
  const visibleNavItems = readOnly
    ? navItems.filter((i) => i.href !== '/estimates')
    : navItems
  const visibleBottomLinks = readOnly
    ? bottomLinks.filter((l) => l.href !== '/team-members' && l.href !== '/settings')
    : bottomLinks

  function isActive(href: string) {
    if (href === '#') return false
    if (href === '/dashboard') return pathname === '/dashboard'
    if (href === '/items') return pathname === '/items'
    if (href === '/settings') return pathname?.startsWith('/settings')
    if (href === '/team-members') return pathname?.startsWith('/team-members')
    return pathname?.startsWith(href)
  }

  function toggleSubmenu(label: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setExpandedItem(expandedItem === label ? null : label)
  }

  function firstEnabledSubmenuHref(item: NavItem) {
    if (!item.submenu) return item.href
    const first = item.submenu.find((s) => !s.disabled && s.href !== '#')
    return first ? first.href : item.href
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`lg:hidden fixed inset-0 bg-black/40 z-30 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={close}
        aria-hidden="true"
      />
      <aside
        className={`fixed left-0 top-0 bottom-0 w-[220px] bg-[#0075DD] flex flex-col z-40 overflow-hidden transition-transform duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      {/* Company header */}
      <div className="px-5 pt-4 pb-3">
        <div className="min-w-0">
          <div
            className="text-white font-semibold text-[14px] leading-tight"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {companyName}
          </div>
          <div className="text-white/70 text-[12px] mt-0.5">{readOnly ? 'Accountant' : 'Owner'}</div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav
        className="flex-1 py-1 overflow-y-auto scrollbar-hide"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {visibleNavItems.map((item) => {
          const active = isActive(item.href)
          const isExpanded = expandedItem === item.label

          if (item.disabled) {
            return (
              <div key={item.label} className="px-3">
                <span
                  className="flex items-center gap-3 px-3 py-2 text-[14px] text-white/55 cursor-not-allowed"
                  title="Coming Soon"
                >
                  <span className="flex-shrink-0 text-white/60">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.submenu && (
                    <svg
                      className="w-3.5 h-3.5 text-white/50"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  )}
                </span>
              </div>
            )
          }

          return (
            <div key={item.label} className={active ? 'mx-3 my-0.5' : 'px-3'}>
              <div
                className={
                  active
                    ? 'flex items-center text-[14px] bg-[#002D79] rounded font-semibold'
                    : 'flex items-center text-[14px] hover:bg-white/10 rounded font-normal'
                }
                style={active ? { fontFamily: 'var(--font-heading)' } : undefined}
              >
                <Link
                  href={firstEnabledSubmenuHref(item)}
                  className="flex-1 flex items-center gap-3 px-3 py-2 min-w-0 text-white"
                  onClick={() => {
                    if (item.submenu) setExpandedItem(item.label)
                  }}
                >
                  <span className="flex-shrink-0 text-white/90">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                </Link>
                {item.submenu && (
                  <button
                    type="button"
                    onClick={(e) => toggleSubmenu(item.label, e)}
                    aria-label={isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
                    className="flex items-center justify-center px-2 py-2 rounded hover:bg-white/10 text-white"
                  >
                    <svg
                      className={`w-3.5 h-3.5 text-white/70 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                )}
              </div>
              {item.submenu && isExpanded && (
                <div className="ml-8 mt-0.5 mb-1 space-y-0.5">
                  {item.submenu.map((sub) => {
                    if (sub.disabled) {
                      return (
                        <span
                          key={sub.label}
                          className="block px-3 py-1.5 text-[13px] text-white/50 cursor-not-allowed rounded"
                          title="Coming Soon"
                        >
                          {sub.label}
                        </span>
                      )
                    }
                    return (
                      <Link
                        key={sub.label}
                        href={sub.href}
                        className="block px-3 py-1.5 text-[13px] text-white/80 hover:text-white hover:bg-white/10 rounded"
                      >
                        {sub.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Bottom links — flex-shrink-0 so they're never clipped when nav is full */}
      <div
        className="py-2 space-y-0.5 border-t border-white/15 flex-shrink-0"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {visibleBottomLinks.map((link) => {
          const active = isActive(link.href)

          if (link.disabled) {
            return (
              <div key={link.label} className="px-3">
                <span
                  className="block px-3 py-1.5 text-[13px] text-white/60 opacity-70 cursor-not-allowed"
                  title="Coming Soon"
                >
                  {link.label}
                </span>
              </div>
            )
          }

          return (
            <div key={link.label} className={active ? 'mx-3 my-0.5' : 'px-3'}>
              <Link
                href={link.href}
                className={
                  active
                    ? 'block px-3 py-1.5 text-[13px] bg-[#002D79] text-white font-semibold rounded'
                    : 'block px-3 py-1.5 text-[13px] text-white/80 hover:bg-white/10 hover:text-white rounded'
                }
                style={active ? { fontFamily: 'var(--font-heading)' } : undefined}
              >
                {link.label}
              </Link>
            </div>
          )
        })}
      </div>
      </aside>
    </>
  )
}
