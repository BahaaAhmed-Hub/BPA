// node scripts/library-book-media-rules.mjs — plain node, no dev server.
// The rules behind the Library's Videos and Summary buttons, run against the REAL modules (Node strips the types):
//   supabase/functions/_shared/libraryVideos.ts  — what is searched, what is believed, how long it is cached
//   src/modules/library/summaryPlan.ts           — lengths, prompts, reading the model's replies
// Each block ends in a control: the same question put to input that SHOULD be refused, so a pass cannot be vacuous.
import * as V from '../supabase/functions/_shared/libraryVideos.ts'
import * as S from '../src/modules/library/summaryPlan.ts'
import * as SORT from '../src/modules/library/videoSort.ts'

let fails = 0, n = 0
const ok = (name, cond, extra = '') => { n++; console.log(`${cond ? 'PASS' : '*** FAIL ***'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++ }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want) ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

/* ── videos: what is asked ─────────────────────────────────────────────── */
eq('review query: the title is a quoted phrase, then the first author', V.videoQuery('Dune', ['Frank Herbert', 'Someone Else'], 'review'), '"Dune" Frank Herbert book summary review')
eq('author query leads with the author, the title still quoted', V.videoQuery('Dune', ['Frank Herbert'], 'author'), 'Frank Herbert "Dune" interview')
eq('no author: review still works', V.videoQuery('Dune', [], 'review'), '"Dune" book summary review')
eq('no author: the author topic asks for the author of that title', V.videoQuery('Dune', [], 'author'), '"Dune" author interview')
eq('the subtitle is not part of the search (nobody calls it that)', V.videoQuery('Atomic Habits: An Easy & Proven Way', ['James Clear'], 'review'), '"Atomic Habits" James Clear book summary review')
eq('a quote typed into a title cannot break the phrase', V.videoQuery('The "Best" Book', [], 'review'), '"The Best Book" book summary review')
eq('whitespace is collapsed', V.videoQuery('  Rich   Dad\n Poor Dad ', ['R.  Kiyosaki'], 'review'), '"Rich Dad Poor Dad" R. Kiyosaki book summary review')
eq('an empty title asks nothing', V.videoQuery('   ', ['X'], 'review'), null)
eq('a non-string title asks nothing', V.videoQuery(42, ['X'], 'review'), null)
eq('a non-array authors is no author', V.videoQuery('Dune', 'Frank Herbert', 'review'), '"Dune" book summary review')
ok('a huge title is clipped to 160 characters', V.videoQuery('x'.repeat(5000), [], 'review').length <= 160 + ' ""  book summary review'.length)
eq('two spellings of one question share a cache row', V.cacheKey('Dune  FRANK Herbert book'), V.cacheKey(' dune frank herbert  BOOK '))
ok('the cache key carries the rules’ version, so an older row is never trusted', V.cacheKey('x').startsWith(V.CACHE_VERSION + '|'))
ok('control: different books do not share a row', V.cacheKey('Dune') !== V.cacheKey('Dune Messiah'))

/* ── videos: is it about THIS book? ────────────────────────────────────── */
const AH = { title: 'Atomic Habits: An Easy & Proven Way to Build Good Habits', authors: ['James Clear'] }
const about = (title, channel = 'Some Channel', description = '', book = AH) => V.isAboutBook({ title, channel, description }, book)
eq('mainTitle drops the subtitle', V.mainTitle(AH.title), 'Atomic Habits')
eq('…at a dash too', V.mainTitle('Dune - Special Edition'), 'Dune')
eq('surnameOf is the first author’s last word, normalised', V.surnameOf(['Ali Abdaal', 'X']), 'abdaal')
eq('…and nothing for no author', V.surnameOf([]), '')
ok('the title and the author in the title', about('Atomic Habits by James Clear (Animated Summary)'))
ok('a short title, the author only in the description', about('Atomic Habits Summary', 'Productivity Game', 'A look at the book by James Clear'))
ok('a short title, the author is the channel', about('Atomic Habits - 5 lessons', 'James Clear'))
ok('CONTROL: a short title with no author anywhere is not vouched for (it could be any "Atomic Habits")', !about('Atomic Habits Summary', 'Random Channel', 'a summary'))
ok('a book that is only in the DESCRIPTION is not about it (a roundup lists a dozen)', !about('Deep Work Summary', 'James Clear Fans', 'also mentions Atomic Habits by James Clear'))
ok('"Habit" is not "Habits"', !about('Atomic Habit tips by James Clear'))
ok('a list of other books is not about this one', !about('Books like Atomic Habits by James Clear'))
ok('"better than" is not about this one', !about('Something better than Atomic Habits (James Clear)'))
ok('a full audiobook upload is not a summary or a review', !about('ATOMIC HABITS Full Audiobook - James Clear'))
ok('a trailer is not about the book', !about('Dune Official Trailer', 'Warner', 'Frank Herbert', { title: 'Dune', authors: ['Frank Herbert'] }))
const FG = { title: 'Feel-Good Productivity: How to Do More of What Matters to You', authors: ['Ali Abdaal'] }
ok('a title of three words names the book by itself (hyphen read as a space)', about('Feel Good Productivity - 3 key ideas', 'Unrelated', '', FG))
ok('CONTROL: …but only if the title is in the video’s title', !about('3 key ideas on being productive', 'Ali Abdaal', 'from Feel-Good Productivity', FG))
ok('no author on record: the title is all there is', about('Dune book review', 'X', '', { title: 'Dune', authors: [] }))
ok('an empty book title matches nothing', !about('anything', 'x', 'x', { title: '   ', authors: ['A B'] }))
ok('case and accents are set aside', about('CAMUS – L’Étranger : résumé', 'x', '', { title: 'L’étranger', authors: ['Albert Camus'] }))
ok('another script works the same way', about('ملخص كتاب العادات الذرية جيمس كلير', 'قناة', '', { title: 'العادات الذرية', authors: ['جيمس كلير'] }))

/* ── videos: what is believed ──────────────────────────────────────────── */
const DUNE = { title: 'Dune', authors: ['Frank Herbert'] }
const hit = (id, title = 'A &amp; B &#39;quoted&#39;', extra = {}) => ({ id: { videoId: id }, snippet: { title, channelTitle: 'Chan &quot;X&quot;', publishedAt: '2024-05-01T10:00:00Z', description: '', thumbnails: { medium: { url: 'https://evil.example/x.jpg' } }, ...extra } })
const good = 'dQw4w9WgXcQ'
const parsed = V.parseSearch({ items: [hit(good)] }, DUNE)
eq('a good hit is kept, with its title unescaped', parsed[0]?.title, "A & B 'quoted'")
eq('and its channel', parsed[0]?.channel, 'Chan "X"')
eq('the thumbnail is derived from the id', parsed[0]?.thumb, `https://i.ytimg.com/vi/${good}/mqdefault.jpg`)
ok('control: the response’s own thumbnail URL is never used', !JSON.stringify(parsed).includes('evil.example'))
eq('a hit that does not name the book is kept but not strict', parsed[0]?.strict, false)
eq('one that does, with the author in its description, is strict', V.parseSearch({ items: [hit(good, 'Dune - book review', { description: 'by Frank Herbert' })] }, DUNE)[0]?.strict, true)
eq('a short id is dropped', V.parseSearch({ items: [hit('short')] }, DUNE), [])
eq('an id with a slash is dropped', V.parseSearch({ items: [hit('dQw4w9/WgXc')] }, DUNE), [])
eq('a script-shaped id is dropped', V.parseSearch({ items: [hit('"><script>x')] }, DUNE), [])
eq('a non-string id is dropped', V.parseSearch({ items: [{ id: { videoId: 12345678901 }, snippet: { title: 't' } }] }, DUNE), [])
eq('a hit with no title is dropped', V.parseSearch({ items: [hit(good, '')] }, DUNE), [])
eq('a channel result (no videoId) is dropped', V.parseSearch({ items: [{ id: { channelId: 'UC123' }, snippet: { title: 't' } }] }, DUNE), [])
eq('the same video twice is shown once', V.parseSearch({ items: [hit(good), hit(good)] }, DUNE).length, 1)
const many = Array.from({ length: 80 }, (_, i) => hit(String(i).padStart(11, 'a')))
eq('a page is at most 50', V.parseSearch({ items: many }, DUNE).length, 50)
eq('not an object → nothing', V.parseSearch(null, DUNE), [])
eq('items not an array → nothing', V.parseSearch({ items: 'x' }, DUNE), [])
eq('a missing snippet does not throw, the hit is just dropped', V.parseSearch({ items: [{ id: { videoId: good } }] }, DUNE), [])

/* ── videos: more pages ────────────────────────────────────────────────── */
eq('a page token is read', V.nextToken({ nextPageToken: 'CDIQAA' }), 'CDIQAA')
eq('control: a token with a space or tag is refused', V.nextToken({ nextPageToken: 'a b<x>' }), null)
eq('control: no token is no next page', V.nextToken({}), null)
eq('control: a non-string token is refused', V.nextToken({ nextPageToken: 123 }), null)
eq('control: an absurdly long token is refused', V.nextToken({ nextPageToken: 'a'.repeat(500) }), null)
const mk = (id, strict = true) => ({ id, title: id, channel: '', thumb: '', publishedAt: '', strict })
eq('a later page is added after what was kept', V.mergeItems([mk('a'), mk('b')], [mk('c')]).map(v => v.id), ['a', 'b', 'c'])
eq('nothing is shown twice, and the first sighting wins', V.mergeItems([mk('a', true)], [mk('a', false), mk('b')]).map(v => `${v.id}:${v.strict}`), ['a:true', 'b:true'])
eq('and never more than the cap', V.mergeItems(Array.from({ length: 140 }, (_, i) => mk('k' + i)), Array.from({ length: 40 }, (_, i) => mk('n' + i))).length, V.MAX_STORED)

/* ── videos: the cache and the quota ───────────────────────────────────── */
const now = Date.parse('2026-10-31T12:00:00Z')
ok('a 6-day-old row is fresh', V.isFresh('2026-10-25T12:00:00Z', now))
ok('control: an 8-day-old row is not', !V.isFresh('2026-10-23T12:00:00Z', now))
ok('control: an unreadable date is not fresh (it is asked again)', !V.isFresh('not a date', now))
ok('quotaExceeded is the quota', V.isQuotaReason({ error: { errors: [{ reason: 'quotaExceeded' }] } }))
ok('dailyLimitExceeded is the quota', V.isQuotaReason({ error: { errors: [{ reason: 'dailyLimitExceeded' }] } }))
ok('control: keyInvalid is not the quota', !V.isQuotaReason({ error: { errors: [{ reason: 'keyInvalid' }] } }))
ok('control: no body is not the quota', !V.isQuotaReason(null))

/* ── videos: how many watched, how many liked ─────────────────────────── */
const stats = V.parseStats({ items: [
  { id: 'dQw4w9WgXcQ', statistics: { viewCount: '1234567', likeCount: '45000' } },
  { id: 'aaaaaaaaaaa', statistics: { viewCount: '900' } },                       // likes hidden by the channel
  { id: 'bbbbbbbbbbb', statistics: { viewCount: '-5', likeCount: '1.5' } },      // not counts
  { id: 'short', statistics: { viewCount: '1' } },                               // not a video id
  { id: 'ccccccccccc' },                                                          // no statistics at all
  { id: 'ddddddddddd', statistics: { viewCount: '9'.repeat(40) } },               // absurd
  { id: '"><x>', statistics: { viewCount: '5' } },
] })
eq('views and likes are read as numbers', stats.get('dQw4w9WgXcQ'), { views: 1234567, likes: 45000 })
eq('a hidden like count is null, NOT zero', stats.get('aaaaaaaaaaa'), { views: 900, likes: null })
eq('a negative or fractional count is "not said"', stats.get('bbbbbbbbbbb'), { views: null, likes: null })
eq('no statistics at all is "not said"', stats.get('ccccccccccc'), { views: null, likes: null })
eq('an absurdly long number is refused, not turned into Infinity', stats.get('ddddddddddd'), { views: null, likes: null })
ok('control: a malformed id never gets an entry', !stats.has('short') && !stats.has('"><x>') && stats.size === 5)
eq('not an object → an empty map', V.parseStats(null).size, 0)
eq('items not an array → an empty map', V.parseStats({ items: 'x' }).size, 0)
const vid = (id, over = {}) => ({ id, title: id, channel: '', thumb: '', publishedAt: '', strict: true, views: null, likes: null, ...over })
const applied = V.applyStats([vid('dQw4w9WgXcQ'), vid('aaaaaaaaaaa', { views: 5, likes: 5 }), vid('zzzzzzzzzzz', { views: 7, likes: 8 })], stats)
eq('counts are put on the videos they belong to', [applied[0].views, applied[0].likes], [1234567, 45000])
eq('a video the channel hides likes on gets null, replacing nothing it had', [applied[1].views, applied[1].likes], [900, null])
eq('a video with no entry keeps what it had (a failed stats call changes nothing)', [applied[2].views, applied[2].likes], [7, 8])
eq('an empty map changes nothing at all', V.applyStats([vid('dQw4w9WgXcQ', { views: 1, likes: 2 })], new Map())[0].views, 1)
ok('a freshly parsed search starts with unknown counts (null, not 0)', V.parseSearch({ items: [{ id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'Dune summary' } }] }, { title: 'Dune', authors: [] })[0].views === null)

/* ── videos: the order ─────────────────────────────────────────────────── */
const sv = (id, strict, views, likes) => ({ id, strict, views, likes })
const mix = [sv('a', true, 100, 5), sv('b', true, 900, 1), sv('c', true, 900, 50), sv('d', true, null, null), sv('e', true, 50, null), sv('x', false, 9_000_000, 9_000_000)]
const ids = (xs) => xs.map(v => v.id).join('')
eq('most watched: views, then likes to break a tie, unknown last', ids(SORT.sortVideos(mix, 'watched')), 'cbaedx')
eq('most liked: likes, then views to break a tie, unknown last', ids(SORT.sortVideos(mix, 'liked')), 'cabedx')
eq('best match is YouTube’s own order', ids(SORT.sortVideos(mix, 'match')), 'abcdex')
ok('a looser video with nine million views and likes is STILL below every video that names the book', ['watched', 'liked', 'match'].every(k => SORT.sortVideos(mix, k).at(-1).id === 'x'))
eq('control: a video watched 0 times is above one whose count is unknown (unknown is not zero)', ids(SORT.sortVideos([sv('n', true, null, null), sv('z', true, 0, 0)], 'watched')), 'zn')
eq('equal videos keep YouTube’s order (the result is the same every time)', ids(SORT.sortVideos([sv('p', true, 5, 5), sv('q', true, 5, 5), sv('r', true, 5, 5)], 'watched')), 'pqr')
const before = ids(mix); SORT.sortVideos(mix, 'watched')
eq('sorting does not reorder the list it was given', ids(mix), before)
eq('an empty list is an empty list', SORT.sortVideos([], 'watched').length, 0)
eq('the three orders are offered, most watched first', SORT.SORT_OPTIONS.map(o => o.value), ['watched', 'liked', 'match'])
eq('compact: millions', SORT.compact(1234567), '1.2M')
eq('compact: thousands', SORT.compact(45000), '45K')
eq('compact: small numbers are left alone', SORT.compact(980), '980')
eq('compact: zero', SORT.compact(0), '0')
eq('the stats line says both when both are known', SORT.statsLine({ views: 3_400_000, likes: 41_000 }), '3.4M views · 41K likes')
eq('…only the views when likes are hidden (never "0 likes")', SORT.statsLine({ views: 3_400_000, likes: null }), '3.4M views')
eq('…only the likes when the views are unknown', SORT.statsLine({ views: null, likes: 5 }), '5 likes')
eq('…nothing when neither is known', SORT.statsLine({ views: null, likes: null }), '')
eq('a real zero is shown as zero', SORT.statsLine({ views: 0, likes: 0 }), '0 views · 0 likes')

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
