import type { WizardState } from './state'
import type { StepId } from './steps'

/**
 * What leaving a step writes. One function per step, each returning what it did
 * in words — the Done summary prints them, and a dry run (the admin's test)
 * returns the same words without writing anything. A step that is skipped
 * never reaches here, so skipping is the absence of a write, not a write of
 * nothing.
 */
export async function saveStep(_id: StepId, _w: WizardState, _dry: boolean): Promise<string[]> {
  return []
}
