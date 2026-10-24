// "Failed to construct 'Request': 'headers' of 'RequestInit' (Argument 2) is not a valid ByteString"
//
// A pasted key carried an invisible character that the old whitespace-only cleaner left in,
// and fetch() refused to build the request. This lifts the cleaner OUT of both real files
// (web + edge) rather than restating it, then builds a real Request with the cleaned key.
// Control: the old cleaner `replace(/\s+/g, '')` on the same inputs must fail.
import { readFileSync } from 'node:fs'

let fails = 0
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++ }

const lift = (path) => {
  const src = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const m = src.match(/export const cleanKey = \(k[^)]*\): string => \(k \?\? ''\)\.replace\((\/.+?\/g), ''\)/)
  if (!m) throw new Error(`cleanKey not found in ${path}`)
  return { body: m[1], fn: new Function('k', `return (k ?? '').replace(${m[1]}, '')`) }
}
const web = lift('src/lib/apiKey.ts')
const edge = lift('supabase/functions/_shared/apiKey.ts')
const old = (k) => (k ?? '').replace(/\s+/g, '')

ok(web.body === edge.body, `web and edge cleaners are identical (${web.body})`)

const real = 'sk-ant-api03-Ab_C9-xYz012345678901234567890123456789012345678901234567890123456789-AbCdEfAA'
const headerOk = (k) => { try { new Request('https://api.anthropic.com/v1/messages', { headers: { 'x-api-key': k } }); return true } catch { return false } }

// Positive claims first: a clean key goes through unchanged and makes a valid header.
ok(web.fn(real) === real, 'a real-shaped key is left exactly as it was')
ok(headerOk(web.fn(real)), 'a real-shaped key builds a Request')
ok(web.fn(undefined) === '' && web.fn(null) === '', 'missing key → empty string')

const hidden = {
  'zero-width space U+200B': '​',
  'left-to-right mark U+200E (Arabic keyboard)': '‎',
  'right-to-left mark U+200F (Arabic keyboard)': '‏',
  'byte-order mark U+FEFF': '﻿',
  'no-break space U+00A0': ' ',
  'curly quotes “ ”': ['“', '”'],
  'straight quotes " "': ['"', '"'],
  'trailing newline': '\n',
}
let controlBroke = 0
for (const [name, c] of Object.entries(hidden)) {
  const pasted = Array.isArray(c) ? `${c[0]}${real}${c[1]}` : `${c}${real}${c}`
  ok(headerOk(web.fn(pasted)) && web.fn(pasted) === real, `${name}: cleaned key is the real key and builds a Request`)
  if (!headerOk(old(pasted)) || old(pasted) !== real) controlBroke++
}
// The control has to be able to fail, or this proves nothing.
ok(controlBroke >= 5, `control: the old whitespace-only cleaner fails ${controlBroke} of ${Object.keys(hidden).length} pastes`)
ok(!headerOk(old(`${real}‎`)), 'control: old cleaner + RTL mark reproduces the ByteString error')

// A masked display copied by mistake no longer crashes the browser; it reaches the API and is refused by name.
ok(headerOk(web.fn('sk-ant-…AbAA')), 'a masked "sk-ant-…AbAA" builds a Request (the API then names the bad key)')

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
