import { useEffect } from 'react'
import { moduleIsOff } from '@/lib/entitlements'
import { useFinanceStore } from '@/modules/finance/financeStore'
import { useProjectStore } from '@/store/projectStore'
import { entryMeta, sameEntryMeta } from './projectLife'

/** A link to a finance entry remembers what the entry is, because Finance holds
 *  one year at a time and the project page cannot ask for another. Whenever the
 *  entry is loaded, refresh it. Equal snapshots write nothing, and an entry that
 *  is not loaded keeps what it had — it is never blanked for being out of view. */
export function useEntrySnapshots(): void {
  const links = useProjectStore(s => s.links)
  const transactions = useFinanceStore(s => s.transactions)
  useEffect(() => {
    if (moduleIsOff('finance') || transactions.length === 0) return
    for (const l of links) {
      if (l.kind !== 'entry') continue
      const tx = transactions.find(t => t.id === l.refId)
      if (!tx) continue
      const meta = entryMeta(tx)
      if (!sameEntryMeta(l.meta, meta)) useProjectStore.getState().setLinkMeta(l.id, meta)
    }
  }, [links, transactions])
}
