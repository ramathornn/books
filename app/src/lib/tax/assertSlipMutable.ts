/**
 * Data-layer immutability guard for tax slips, analogous to `assertNotLocked`.
 *
 * A slip is mutable only while it is a `draft`. Once issued/filed/amended/
 * cancelled it is append-only: corrections happen by inserting a new amendment
 * row (amendmentSeq+1, reportCode 'A'), never by editing the issued row. The
 * only allowed writes to a non-draft slip are the narrow status/stamp
 * transitions handled explicitly by the issue/file routes (slipNumber, status,
 * filedAt, craSubmissionRef) — those routes must NOT call this guard for those
 * specific field updates.
 *
 * Every general write route calls this first so immutability is enforced at the
 * data layer, not just the UI (design finding #2).
 */

export interface SlipMutableLike {
  status: string
  isCancelled?: boolean
}

export class SlipImmutableError extends Error {
  code = 'SLIP_IMMUTABLE'
  constructor(public status: string) {
    super(
      `This slip is ${status} and can no longer be edited. Issue a new amendment to make changes.`
    )
    this.name = 'SlipImmutableError'
  }
}

/** Throw unless the slip is an editable draft. */
export function assertSlipMutable(slip: SlipMutableLike): void {
  if (slip.status !== 'draft' || slip.isCancelled) {
    throw new SlipImmutableError(slip.status)
  }
}
