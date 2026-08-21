/**
 * Data-layer immutability guard for T2 / AT1 returns — the T2 analogue of the T1
 * `assertReturnMutable`.
 *
 * A T2Return (and its sibling AT1Return) is mutable only while it is a `draft`.
 * Once `prepared` it is frozen (resultSnapshot + engineVersion are authoritative);
 * `superseded` rows belong to an amendment chain and are never edited. Corrections
 * to a prepared return are made by REOPENING it (prepared → draft, when the
 * engineVersion still matches) or by amending it (a new amendmentSeq row), never
 * by editing the frozen row.
 *
 * Every general write route (PUT save-draft, recompute) calls this first so the
 * lifecycle is enforced at the data layer, not just the UI.
 */

export interface ReturnMutableLike {
  status: string
}

export class ReturnImmutableError extends Error {
  code = 'RETURN_IMMUTABLE'
  constructor(public status: string) {
    super(
      `This return is ${status} and can no longer be edited. Reopen it to a draft, or file an amendment, to make changes.`,
    )
    this.name = 'ReturnImmutableError'
  }
}

/** Throw unless the return is an editable draft. */
export function assertReturnMutable(ret: ReturnMutableLike): void {
  if (ret.status !== 'draft') {
    throw new ReturnImmutableError(ret.status)
  }
}
