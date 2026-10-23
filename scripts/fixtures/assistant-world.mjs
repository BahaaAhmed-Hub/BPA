// A stand-in for the Supabase project as the assistant sees it: a small stateful PostgREST over `assistant_conversations`
// and `assistant_messages` (unique indexes and all) and an `assistant-chat` "function" that writes its answer from NODE on
// a timer — so an answer keeps arriving whether or not any page is alive. Shared by assistant-persists.mjs and
// assistant-usage-counter.mjs. It can refuse (a duplicate, a second streaming answer), which is what makes it a fixture.
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
export const U = '11111111-1111-1111-1111-111111111111'
const sleep = ms => new Promise(r => setTimeout(r, ms))
export const iso = (t = Date.now()) => new Date(t).toISOString()
export function makeWorld() {
  const w = { convs: [], msgs: [], nextId: 1, fn: [], patches: [], fnStatus: 200, mode: 'text', tool: { name: 'list_habits', input: {} }, chunkMs: 650 }
  w.addMsg = row => {
    if (row.client_id && w.msgs.some(m => m.conversation_id === row.conversation_id && m.client_id === row.client_id)) return { err: { code: '23505', message: 'duplicate key value violates unique constraint "assistant_messages_client_uniq"' } }
    if (row.status === 'streaming' && w.msgs.some(m => m.conversation_id === row.conversation_id && m.status === 'streaming')) return { err: { code: '23505', message: 'duplicate key value violates unique constraint "assistant_one_streaming"' } }
    if (row.tool_use_id && w.msgs.some(m => m.conversation_id === row.conversation_id && m.tool_use_id === row.tool_use_id)) return { err: { code: '23505', message: 'duplicate key value violates unique constraint "assistant_tool_use_uniq"' } }
    const m = { id: w.nextId++, status: 'complete', content: '', client_id: null, tool: null, tool_state: null, tool_use_id: null, tool_input: null, tool_result: null, files: null, claimed_by: null, claimed_at: null, created_at: iso(), updated_at: iso(), ...row }
    w.msgs.push(m)
    const c = w.convs.find(x => x.id === row.conversation_id); if (c) c.updated_at = iso()
    return { row: m }
  }
  w.upd = (m, patch) => { Object.assign(m, patch, { updated_at: iso() }); const c = w.convs.find(x => x.id === m.conversation_id); if (c) c.updated_at = iso() }
  w.thread = id => w.msgs.filter(m => m.conversation_id === id).sort((a, b) => a.id - b.id)
  // the function's work, done on a timer in Node: independent of any page
  w.serve = async body => {
    const id = body.conversationId
    const stream = async (text, usage = w.usage) => {
      const a = w.addMsg({ conversation_id: id, user_id: U, role: 'assistant', status: 'streaming', content: '' })
      if (a.err) { w.fn.push({ busy: true }); return }
      const words = text.split(' ')
      for (let i = 1; i <= words.length; i++) { await sleep(w.chunkMs); w.upd(a.row, { content: words.slice(0, i).join(' ') }) }
      w.upd(a.row, { status: 'complete', ...(usage ? { usage } : {}) })
    }
    if (w.mode === 'text') return stream(w.text ?? 'This is a long answer that keeps arriving while the page is gone.')
    if (w.mode === 'tool') {
      if (body.mode === 'turn') {
        await sleep(300)
        const lead = w.addMsg({ conversation_id: id, user_id: U, role: 'assistant', content: 'Let me look.', ...(w.usageTool ? { usage: w.usageTool } : {}) })
        w.addMsg({ conversation_id: id, user_id: U, role: 'tool', content: w.tool.name, tool: w.tool.name, tool_state: 'running', tool_use_id: 'toolu_' + w.nextId, tool_input: w.tool.input })
        return lead
      }
      // continue: the function insists every parked call has come back
      const tools = w.thread(id).filter(m => m.role === 'tool')
      if (!tools.every(t => t.tool_state === 'done' || t.tool_state === 'failed')) { w.fn.push({ notReady: true }); return }
      w.continueSaw = tools.map(t => ({ state: t.tool_state, result: t.tool_result }))
      return stream('All done.', w.usageFinal ?? w.usage)
    }
  }
  return w
}

export function rest(w, q, u) {
  const table = u.pathname.split('/').pop()
  const T = table === 'assistant_conversations' ? w.convs : table === 'assistant_messages' ? w.msgs : null
  if (!T) return null
  const accept = q.headers()['accept'] ?? ''
  const prefer = q.headers()['prefer'] ?? ''
  const test = (row) => {
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue
      if (k === 'or') {
        const parts = v.replace(/^\(|\)$/g, '').split(',')
        // split "a.is.null,b.lt.iso,c.eq.x" — the ISO timestamp contains no commas
        if (!parts.some(p => { const [col, op, ...rest] = p.split('.'); return cmp(row[col], op, rest.join('.')) })) return false
        continue
      }
      const [op, ...rest] = v.split('.')
      if (!cmp(row[k], op, rest.join('.'))) return false
    }
    return true
  }
  const cmp = (val, op, arg) => op === 'not' ? !cmp(val, arg.split('.')[0], arg.split('.').slice(1).join('.')) : op === 'eq' ? String(val) === arg : op === 'is' ? (arg === 'null' ? val == null : val != null) : op === 'lt' ? val != null && String(val) < arg : op === 'gte' ? val != null && String(val) >= arg : op === 'in' ? arg.replace(/^\(|\)$/g, '').split(',').includes(String(val)) : true
  const j = (x, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(x) })
  const one = rows => accept.includes('vnd.pgrst.object') ? (rows[0] ? j(rows[0]) : j({ code: 'PGRST116', message: 'no rows' }, 406)) : j(rows)
  const m = q.method()
  if (m === 'GET') {
    let rows = T.filter(test)
    const ord = u.searchParams.get('order')
    if (ord) { const [col, dir] = ord.split('.'); rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1)) }
    const lim = Number(u.searchParams.get('limit')); if (lim) rows = rows.slice(0, lim)
    return one(rows)
  }
  if (m === 'POST') {
    const body = JSON.parse(q.postData() || '{}'); const arr = Array.isArray(body) ? body : [body]; const made = []
    for (const r of arr) {
      if (table === 'assistant_conversations') { if (w.convs.some(c => c.id === r.id)) return j({ code: '23505', message: 'dup' }, 409); const c = { archived_at: null, title: null, provider: null, turn: null, created_at: iso(), updated_at: iso(), ...r }; w.convs.push(c); made.push(c) }
      else { const out = w.addMsg(r); if (out.err) return j(out.err, 409); made.push(out.row) }
    }
    return /return=representation/.test(prefer) || u.searchParams.get('select') ? one(made) : { status: 201, headers: CORS, body: '' }
  }
  if (m === 'PATCH') {
    const patch = JSON.parse(q.postData() || '{}'); const rows = T.filter(test)
    w.patches.push({ table, patch, n: rows.length })
    for (const r of rows) { if (T === w.msgs) w.upd(r, patch); else Object.assign(r, patch, { updated_at: iso() }) }
    return /return=representation/.test(prefer) ? one(rows) : { status: 204, headers: CORS, body: '' }
  }
  if (m === 'DELETE') { const dead = T.filter(test); for (const r of dead) T.splice(T.indexOf(r), 1); return /return=representation/.test(prefer) ? one(dead) : { status: 204, headers: CORS, body: '' } }
  return j([])
}

