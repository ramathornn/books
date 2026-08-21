import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'

export type AuditEntityType =
  | 'invoice'
  | 'bill'
  | 'expense'
  | 'journal_entry'
  | 'bank_transaction'
  | 'gl_account'
  | 'tax_return'
  | 'reconciliation'
  | 'period_lock'
  | 'recurring_template'
  | 'vendor'
  | 'mileage'
  | 'user'

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'post'
  | 'void'
  | 'reverse'
  | 'categorize'
  | 'match'
  | 'reconcile'
  | 'finish'
  | 'exclude'
  | 'unpost'
  | 'run'
  | 'lock'
  | 'unlock'
  | 'pay'
  | 'archive'

interface LogParams {
  entityType: AuditEntityType
  entityId: string
  action: AuditAction
  summary?: string
  before?: unknown
  after?: unknown
  metadata?: unknown
}

/**
 * Append an entry to the audit log. Best-effort — never throws into the calling
 * code path (so failures here don't break the user's actual mutation).
 */
export async function audit(params: LogParams): Promise<void> {
  try {
    const session = await auth()
    const userId = (session?.user as { id?: string } | undefined)?.id ?? null
    const userName = (session?.user as { name?: string } | undefined)?.name ?? ''
    await prisma.auditLog.create({
      data: {
        userId,
        userName,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        summary: params.summary || '',
        before: (params.before ?? null) as never,
        after: (params.after ?? null) as never,
        metadata: (params.metadata ?? null) as never,
      },
    })
  } catch (e) {
    console.error('audit log failed', e)
  }
}
