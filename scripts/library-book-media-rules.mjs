// node scripts/library-book-media-rules.mjs — plain node, no dev server.
// The rules behind the Library's Videos and Summary buttons, run against the REAL modules (Node strips the types):
//   supabase/functions/_shared/libraryVideos.ts  — what is searched, what is believed, how long it is cached
//   src/modules/library/summaryPlan.ts           — lengths, prompts, reading the model's replies
// Each block ends in a control: the same question put to input that SHOULD be refused, so a pass cannot be vacuous.
import * as V from '../supabase/functions/_shared/libraryVideos.ts'
import * as S from '../src/modules/library/summaryPlan.ts'

let fails = 0, n = 0
const ok = (name, cond, extra = '') => { n++; console.log(`${cond ? 'PASS' : '*** FAIL ***'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++ }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want) ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

/* ── videos: what is asked ─────────────────────────────────────────────── */
eq('review query = title, first author, then the topic words', V.videoQuery('Dune', ['Frank Herbert', 'Someone Else'], 'review'), 'Dune Frank Herbert book summary review')
eq('author query leads with the author', V.videoQuery('Dune', ['Frank Herbert'], 'author'), 'Frank Herbert interview Dune')
eq('no author: review still works', V.videoQuery('Dune', [], 'review'), 'Dune book summary review')
eq('no author: the author topic falls back to the title', V.videoQuery('Dune', [], 'author'), 'Dune interview')
eq('whitespace is collapsed', V.videoQuery('  Rich   Dad\n Poor Dad ', ['R.  Kiyosaki'], 'review'), 'Rich Dad Poor Dad R. Kiyosaki book summary review')
eq('an empty title asks nothing', V.videoQuery('   ', ['X'], 'review'), null)
eq('a non-string title asks nothing', V.videoQuery(42, ['X'], 'review'), null)
eq('a non-array authors is no author', V.videoQuery('Dune', 'Frank Herbert', 'review'), 'Dune book summary review')
ok('a huge title is clipped to 160 characters', V.videoQuery('x'.repeat(5000), [], 'review').length <= 160 + ' book summary review'.length)
eq('two spellings of one question share a cache row', V.cacheKey('Dune  FRANK Herbert book'), V.cacheKey(' dune frank herbert  BOOK '))
ok('control: different books do not share a row', V.cacheKey('Dune') !== V.cacheKey('Dune Messiah'))

/* ── videos: what is believed ──────────────────────────────────────────── */
const hit = (id, title = 'A &amp; B &#39;quoted&#39;', extra = {}) => ({ id: { videoId: id }, snippet: { title, channelTitle: 'Chan &quot;X&quot;', publishedAt: '2024-05-01T10:00:00Z', thumbnails: { medium: { url: 'https://evil.example/x.jpg' } }, ...extra } })
const good = 'dQw4w9WgXcQ'
const parsed = V.parseSearch({ items: [hit(good)] })
eq('a good hit is kept, with its title unescaped', parsed[0]?.title, "A & B 'quoted'")
eq('and its channel', parsed[0]?.channel, 'Chan "X"')
eq('the thumbnail is derived from the id', parsed[0]?.thumb, `https://i.ytimg.com/vi/${good}/mqdefault.jpg`)
ok('control: the response’s own thumbnail URL is never used', !JSON.stringify(parsed).includes('evil.example'))
eq('a short id is dropped', V.parseSearch({ items: [hit('short')] }), [])
eq('an id with a slash is dropped', V.parseSearch({ items: [hit('dQw4w9/WgXc')] }), [])
eq('a script-shaped id is dropped', V.parseSearch({ items: [hit('"><script>x')] }), [])
eq('a non-string id is dropped', V.parseSearch({ items: [{ id: { videoId: 12345678901 }, snippet: { title: 't' } }] }), [])
eq('a hit with no title is dropped', V.parseSearch({ items: [hit(good, '')] }), [])
eq('a channel result (no videoId) is dropped', V.parseSearch({ items: [{ id: { channelId: 'UC123' }, snippet: { title: 't' } }] }), [])
eq('the same video twice is shown once', V.parseSearch({ items: [hit(good), hit(good)] }).length, 1)
const many = Array.from({ length: 20 }, (_, i) => hit(String(i).padStart(11, 'a')))
eq('no more than 8 are kept', V.parseSearch({ items: many }).length, 8)
eq('not an object → nothing', V.parseSearch(null), [])
eq('items not an array → nothing', V.parseSearch({ items: 'x' }), [])
eq('a missing snippet does not throw, the hit is just dropped', V.parseSearch({ items: [{ id: { videoId: good } }] }), [])

/* ── videos: the cache and the quota ───────────────────────────────────── */
const now = Date.parse('2026-10-31T12:00:00Z')
ok('a 6-day-old row is fresh', V.isFresh('2026-10-25T12:00:00Z', now))
ok('control: an 8-day-old row is not', !V.isFresh('2026-10-23T12:00:00Z', now))
ok('control: an unreadable date is not fresh (it is asked again)', !V.isFresh('not a date', now))
ok('quotaExceeded is the quota', V.isQuotaReason({ error: { errors: [{ reason: 'quotaExceeded' }] } }))
ok('dailyLimitExceeded is the quota', V.isQuotaReason({ error: { errors: [{ reason: 'dailyLimitExceeded' }] } }))
ok('control: keyInvalid is not the quota', !V.isQuotaReason({ error: { errors: [{ reason: 'keyInvalid' }] } }))
ok('control: no body is not the quota', !V.isQuotaReason(null))

/* ── summary: the lengths ──────────────────────────────────────────────── */
for (const k of S.LENGTH_ORDER) {
  const p = S.LENGTHS[k]
  ok(`${k}: sections × words ÷ 500 matches the ${p.pages} pages it promises`, Math.round(p.sections * p.wordsPerSection / S.WORDS_PER_PAGE) === p.pages)
}
ok('long is inside the 15–20 page ask', S.LENGTHS.long.pages >= 15 && S.LENGTHS.long.pages <= 20)
ok('control: short is not mistaken for it', S.LENGTHS.short.pages < 15)
ok('a section’s token ceiling leaves room above its words (1.35 tokens a word)', S.sectionTokens(S.LENGTHS.long) > S.LENGTHS.long.wordsPerSection * 1.35)

/* ── summary: reading the outline ──────────────────────────────────────── */
const outline = { premise: 'A book about X.', sections: [{ title: 'One', focus: 'First idea' }, { title: 'Two', focus: 'Second idea' }, { title: 'Three', focus: 'Third idea' }] }
eq('a plain outline parses', S.parseOutline(JSON.stringify(outline), 5), outline)
eq('inside code fences', S.parseOutline('```json\n' + JSON.stringify(outline) + '\n```', 5), outline)
eq('wrapped in prose', S.parseOutline('Here you go:\n' + JSON.stringify(outline) + '\nHope that helps', 5), outline)
eq('"unknown" is its own answer, not a failure', S.parseOutline('{"unknown": true}', 5), { unknown: true })
eq('more sections than asked are cut to the plan', S.parseOutline(JSON.stringify({ ...outline, sections: Array.from({ length: 9 }, (_, i) => ({ title: 'T' + i, focus: 'f' })) }), 5).sections.length, 5)
eq('a section with no focus is dropped', S.parseOutline(JSON.stringify({ ...outline, sections: [...outline.sections, { title: 'Four' }] }), 9).sections.length, 3)
eq('control: one section is not a plan', S.parseOutline(JSON.stringify({ premise: 'p', sections: [{ title: 'a', focus: 'b' }] }), 5), null)
eq('control: no premise is not an outline', S.parseOutline(JSON.stringify({ sections: outline.sections }), 5), null)
eq('control: prose with no JSON is null', S.parseOutline('I do not know this book.', 5), null)
eq('control: empty is null', S.parseOutline('', 5), null)
eq('control: {} is null', S.parseOutline('{}', 5), null)

/* ── summary: reading a section ────────────────────────────────────────── */
const cut = 'First sentence is whole. Second sentence is also whole! A third that stops in the mid'
eq('a truncated reply is cut back to the last whole sentence', S.trimToSentence(cut, true), 'First sentence is whole. Second sentence is also whole!')
eq('control: a reply that was not truncated is left alone', S.trimToSentence(cut, false), cut)
eq('a truncated reply with no sentence end at all is kept, not emptied', S.trimToSentence('one long clause with no stop', true), 'one long clause with no stop')
eq('Arabic punctuation ends a sentence too', S.trimToSentence('الجملة الأولى كاملة؟ وجملة مقطوعة', true), 'الجملة الأولى كاملة؟')
eq('a closing quote after the full stop stays with its sentence', S.trimToSentence('A long opening passage that fills most of the section and ends properly. He said “stop.” And then a cut', true), 'A long opening passage that fills most of the section and ends properly. He said “stop.”')
eq('control: a stop in the first half is not worth throwing the rest away for', S.trimToSentence('Short. ' + 'and then a very long clause that never reaches a stop '.repeat(3), true).startsWith('Short. and then'), true)
eq('headings and bold the model added anyway are stripped', S.cleanSection('## Title\n\nThe **key** idea.\n\n\n\nNext.'), 'The key idea.\n\nNext.')
eq('paragraphs split on blank lines', S.paragraphs('a\n\nb\n\n\n\nc'), ['a', 'b', 'c'])

/* ── summary: the prompts carry what they must ─────────────────────────── */
const book = { id: 'b1', title: 'Dune', authors: ['Frank Herbert'], description: 'Desert planet. '.repeat(200), publishedYear: 1965 }
const op = S.outlinePrompt(book, S.LENGTHS.standard)
ok('outline prompt names the book, author, year', op.includes('Dune — Frank Herbert (1965)'))
ok('and asks for exactly the planned number of sections', op.includes('Plan exactly 8 sections'))
ok('and the blurb is clipped to 1,200 characters', op.length < 1200 + 400)
ok('control: no blurb, no blurb line', !S.outlinePrompt({ ...book, description: undefined }, S.LENGTHS.short).includes('blurb'))
const sp = S.sectionPrompt(book, { premise: outline.premise, outline: outline.sections }, 1, S.LENGTHS.long)
ok('section prompt says which section of how many', sp.includes('section 2 of 3: “Two”'))
ok('it carries the whole outline so sections do not overlap', sp.includes('1. One') && sp.includes('3. Three — Third idea'))
ok('and the word target', sp.includes('about 750 words'))
ok('the system prompts forbid inventing and copying', /leave it out/.test(S.SECTION_SYSTEM) && /Never reproduce sentences/.test(S.SECTION_SYSTEM) && /unknown/.test(S.OUTLINE_SYSTEM))

/* ── summary: completeness and export ──────────────────────────────────── */
const doc = (n) => ({ bookId: 'b1', length: 'short', premise: 'P.', outline: outline.sections, sections: Array.from({ length: n }, (_, i) => ({ title: 'S' + i, text: 'word '.repeat(500) })), model: 'm', updatedAt: '2026-10-31T00:00:00Z' })
ok('an outline with no sections is not complete', !S.isComplete(doc(0)))
ok('two of three is not complete', !S.isComplete(doc(2)))
ok('three of three is', S.isComplete(doc(3)))
eq('1,500 words is 3 pages', S.docPages(doc(3)), 3)
eq('a tiny document is at least 1 page', S.docPages({ ...doc(1), sections: [{ title: 't', text: 'few words' }] }), 1)
const md = S.summaryMarkdown({ title: 'Dune', authors: ['Frank Herbert'] }, doc(3))
ok('the export opens with the title', md.startsWith('# Dune — summary\n'))
ok('and says it is not from the text', md.includes('not from its text'))
ok('and numbers the sections', md.includes('## 1. S0') && md.includes('## 3. S2'))
ok('and ends with one newline', md.endsWith('\n') && !md.endsWith('\n\n'))

console.log(`\n${n - fails}/${n} passed`)
process.exit(fails ? 1 : 0)
