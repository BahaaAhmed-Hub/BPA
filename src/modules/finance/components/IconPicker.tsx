import { useState, useRef, useEffect, Fragment } from 'react'
import { Shapes } from 'lucide-react'
import { LUCIDE_ICONS, LUCIDE_SECTIONS, LUCIDE_PREFIX, searchLucide } from '../categoryIcons'

// ─── Emoji data ───────────────────────────────────────────────────────────────

const GROUPS = [
  {
    id: 'finance', label: '💰', title: 'Finance',
    emojis: ['💰','💳','🏦','💵','💴','💶','💷','💸','💹','📊','📈','📉','🏧','💱','💲','🤑','💼','👛','💍','🪙','💎','🏛','🧾','📋','🗂','📁','📂','🔑','🗝','📝','✍️','📌','📍','⭐','🏆','🥇','🏅','🎯','🎁','🛒','🏠','🏡','🏢','🚗','🚕','✈️','🌐','📱','💻','⌚','🔧','⚙️','🔩','🪛','🛠','⛽','🏋','🎓','📚','🩺','💊','🌱','♻️','🔒','🔓','📊','🗃','🗄','📦','📬','📮','🖊','🖋'],
  },
  {
    id: 'smileys', label: '😀', title: 'Smileys',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  },
  {
    id: 'people', label: '👤', title: 'People',
    emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','💪','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🙇','🤦','🤷','👮','🕵','💂','👷','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧝','🧛','🧟','🧞','🧜','🧚','👫','👬','👭','💏','💑','👪','👨‍👩‍👦','👨‍👩‍👧','👨‍👩‍👧‍👦','👨‍👦','👩‍👦','👨‍👧','👩‍👧'],
  },
  {
    id: 'animals', label: '🐶', title: 'Animals',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐒','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🐈','🐓','🦃','🦚','🦜','🦢','🕊','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿','🦔'],
  },
  {
    id: 'food', label: '🍎', title: 'Food',
    emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🫒','🥦','🥬','🥒','🌶','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🥗','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','🍵','☕','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'],
  },
  {
    id: 'travel', label: '✈️', title: 'Travel',
    emojis: ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍','🛵','🚲','🛴','🚏','⛽','🚨','🚥','🚦','🛑','⚓','⛵','🛶','🚤','🛳','⛴','🛥','🚢','✈️','🛩','🛫','🛬','🪂','💺','🚁','🚀','🛸','🌏','🌍','🌎','🗺','🧭','🏔','⛰','🌋','🗻','🏕','🏖','🏜','🏝','🏞','🏟','🏛','🏗','🏘','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','⛩','🕍','⛲','🎡','🎢','🎠','⛺','🌁','🌃','🏙','🌄','🌅','🌆','🌇','🌉','♨️'],
  },
  {
    id: 'activities', label: '⚽', title: 'Activities',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🏐','🏉','🥏','🎾','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛷','⛸','🥌','🎿','⛷','🏂','🪂','🏋','🤼','🤸','🤺','⛹','🤾','🏌','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖','🏵','🎗','🎫','🎟','🎪','🤹','🎭','🩰','🎨','🖼','🎰','🎲','🧩','🧸','♟','🖼','🎯','🎳','🎮','🎵','🎶','🎸','🎹','🎺','🎻','🪕','🥁','🎤','🎧','🎼','📻','📺','🎬','🎥','🎞','📽','🎠','🎡','🎢','🎪'],
  },
  {
    id: 'objects', label: '💡', title: 'Objects',
    emojis: ['⌚','📱','💻','⌨️','🖥','🖨','🖱','💽','💾','💿','📀','📷','📸','📹','🎥','📞','☎️','📺','📻','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','🧲','💰','💳','🧾','📈','📉','📊','📁','📂','🗂','📋','📝','📌','📍','✂️','🗃','🗄','🗑','🔒','🔓','🔏','🔐','🔑','🗝','🔨','⛏','⚒','🛠','⚔️','🔫','🛡','🔧','🔩','⚙️','🪛','🔗','⛓','🧲','🪜','🪣','🪝','🧯','🛒','🚪','🪑','🚽','🚿','🛁','🧴','🧷','🧹','🧺','🧻','🧼','🪥','🧽','🛍','🧳','🌂','☂️','☔','🧵','🧶','👓','🕶','🥽','👒','🎩','🧢','⛑','📿','💄','💍','💎','🔮','🧿','🪬','🪄','🎀','🎊','🎉','🎈','🎁','🎀','🪅','🧨','✨','🎇','🎆','🎑','🎃','🎄','🎋','🎍','🎎','🎏','🎐','🎑','🧧','🎫','🎟','🎪'],
  },
  {
    id: 'symbols', label: '❤️', title: 'Symbols',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','☦️','🛐','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','☢️','☣️','♻️','✅','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','⚠️','🚸','🔱','⚜️','🔰','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧','🚻','🚮','🎦','📶','🈁','ℹ️','🆖','🆗','🆙','🆒','🆕','🆓','🔤','🔡','🔠','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','▶️','⏸️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','➕','➖','➗','✖️','💲','💱','™️','©️','®️','〰️','➰','➿','✔️','☑️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔷','🔶','🔹','🔸','🔲','🔳','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫'],
  },
  {
    id: 'flags', label: '🚩', title: 'Flags',
    emojis: ['🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏴‍☠️','🇦🇪','🇧🇷','🇨🇦','🇨🇳','🇩🇪','🇪🇬','🇪🇸','🇪🇺','🇫🇷','🇬🇧','🇬🇷','🇮🇳','🇮🇩','🇮🇷','🇮🇱','🇮🇹','🇯🇵','🇰🇷','🇲🇦','🇲🇽','🇳🇬','🇳🇱','🇵🇰','🇵🇱','🇵🇹','🇷🇺','🇸🇦','🇸🇦','🇸🇪','🇸🇬','🇹🇷','🇺🇸','🇿🇦','🇦🇷','🇦🇺','🇦🇹','🇧🇪','🇧🇩','🇨🇭','🇨🇱','🇨🇴','🇩🇰','🇫🇮','🇭🇰','🇭🇺','🇰🇪','🇰🇿','🇱🇧','🇲🇾','🇳🇿','🇳🇴','🇵🇭','🇶🇦','🇷🇴','🇹🇳','🇹🇭','🇺🇦','🇻🇳'],
  },
]

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  value: string
  onChange: (v: string) => void
  size?: number
  /** Custom trigger element. Receives an onClick handler and open state. */
  trigger?: (onClick: (e: React.MouseEvent) => void, isOpen: boolean) => React.ReactNode
}

function LineCell({ name, value, onPick }: { name: string; value: string; onPick: (id: string) => void }) {
  const Icon = LUCIDE_ICONS[name]
  const id = LUCIDE_PREFIX + name
  if (!Icon) return null
  const on = value === id
  return (
    <button
      type="button"
      title={name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')}
      onClick={() => onPick(id)}
      style={{
        width: 34, height: 34, borderRadius: 6,
        border: on ? `1px solid ${'#F5D14E'}` : '1px solid transparent',
        background: on ? 'rgba(245,209,78,0.12)' : 'transparent',
        cursor: 'pointer', color: '#4A4438',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon size={18} strokeWidth={1.75} />
    </button>
  )
}

// ─── IconPicker ────────────────────────────────────────────────────────────────

export function IconPicker({ value, onChange, size = 44, trigger }: Props) {
  const [open, setOpen] = useState(false)
  // Line icons first: they are what the rest of the app draws with, and a row
  // of them reads as a set of labels rather than a row of small pictures.
  const [tab, setTab] = useState('line')
  const [search, setSearch] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const isImage = value.startsWith('data:') || value.startsWith('http')

  // Filter emojis by search
  const searchResults = search.trim()
    ? GROUPS.flatMap(g => g.emojis).filter(e =>
        e.includes(search) ||
        GROUPS.some(g => g.emojis.includes(e) && g.title.toLowerCase().includes(search.toLowerCase()))
      ).slice(0, 80)
    : null

  const lineHits = tab === 'line' && search ? searchLucide(search) : []
  const pickLine = (id: string) => { onChange(id); setOpen(false); setSearch('') }

  const currentGroup = GROUPS.find(g => g.id === tab) ?? GROUPS[0]
  const displayEmojis = searchResults ?? currentGroup.emojis

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result as string
      onChange(result)
      setOpen(false)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Trigger — custom or default */}
      {trigger ? (
        trigger(e => { e.stopPropagation(); setOpen(o => !o) }, open)
      ) : (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          title="Click to change icon"
          style={{
            width: size, height: size,
            borderRadius: 12,
            border: `2px solid ${open ? '#F5D14E' : '#E8E1CE'}`,
            background: '#FFFFFF',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
            padding: 0,
            transition: 'border-color 0.15s',
          }}
        >
          {isImage
            ? <img src={value} alt="icon" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: size * 0.55 }}>{value || '📁'}</span>
          }
        </button>
      )}

      {/* Picker popup */}
      {open && (
        <div style={{
          position: 'absolute',
          top: size + 6,
          left: 0,
          zIndex: 200,
          width: 320,
          background: '#FFFFFF',
          border: `1px solid ${'#E8E1CE'}`,
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>

          {/* Search + Upload row */}
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px 0' }}>
            <input
              autoFocus
              type="text"
              placeholder={tab === 'line' ? 'Search icons…' : 'Search emojis…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1, padding: '7px 10px',
                borderRadius: 8, border: `1px solid ${'#E8E1CE'}`,
                background: '#F7F4EA', color: '#191712',
                fontSize: 13, outline: 'none', boxSizing: 'border-box' as const,
                fontFamily: 'inherit',
              }}
            />
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Upload image"
              style={{
                flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 11px',
                borderRadius: 8,
                border: `1px solid ${'#F5D14E'}`,
                background: 'rgba(245,209,78,0.12)',
                color: '#191712',
                fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap' as const,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Upload
            </button>
          </div>

          {/* Current uploaded image preview */}
          {isImage && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              margin: '8px 12px 0',
              padding: '6px 10px',
              borderRadius: 8,
              background: '#F7F4EA',
              border: `1px solid ${'#E8E1CE'}`,
            }}>
              <img src={value} alt="current" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#6C6553', flex: 1 }}>Current image</span>
              <button
                type="button"
                onClick={() => onChange('📁')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#6C6553', fontSize: 12, padding: 0, lineHeight: 1,
                }}
              >✕</button>
            </div>
          )}

          {/* Category tabs — emoji groups only */}
          {!search && (
            <div style={{
              display: 'flex', overflowX: 'auto', padding: '8px 12px 4px',
              gap: 2, scrollbarWidth: 'none' as const,
            }}>
              <button
                type="button"
                onClick={() => setTab('line')}
                title="Line icons"
                style={{
                  flexShrink: 0, width: 32, height: 28,
                  borderRadius: 6, border: 'none',
                  background: tab === 'line' ? 'rgba(245,209,78,0.12)' : 'transparent',
                  cursor: 'pointer', color: '#6C6553',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  outline: tab === 'line' ? `1px solid ${'#F5D14E'}44` : 'none',
                }}
              >
                <Shapes size={15} strokeWidth={1.75} />
              </button>
              {GROUPS.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setTab(g.id)}
                  title={g.title}
                  style={{
                    flexShrink: 0, width: 32, height: 28,
                    borderRadius: 6, border: 'none',
                    background: tab === g.id ? 'rgba(245,209,78,0.12)' : 'transparent',
                    cursor: 'pointer', fontSize: 16,
                    outline: tab === g.id ? `1px solid ${'#F5D14E'}44` : 'none',
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}

          {/* Emoji grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)',
            gap: 2, padding: '6px 8px 10px',
            maxHeight: 220, overflowY: 'auto',
          }}>
            {tab === 'line' && (search ? (
              lineHits.length
                ? lineHits.map(name => <LineCell key={name} name={name} value={value} onPick={pickLine} />)
                : <div style={{ gridColumn: '1 / -1', padding: '18px 4px', textAlign: 'center', fontSize: 12, color: '#9B9180' }}>
                    Nothing called that
                  </div>
            ) : (
              LUCIDE_SECTIONS.map(([title, names]) => (
                <Fragment key={title}>
                  <div style={{
                    gridColumn: '1 / -1', padding: '8px 2px 3px',
                    fontSize: 9.5, fontWeight: 700, letterSpacing: '0.11em',
                    color: '#9B9180', textTransform: 'uppercase',
                  }}>{title}</div>
                  {names.map(name => <LineCell key={name} name={name} value={value} onPick={pickLine} />)}
                </Fragment>
              ))
            ))}
            {tab !== 'line' && displayEmojis.map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => { onChange(emoji); setOpen(false); setSearch('') }}
                style={{
                  width: 34, height: 34, borderRadius: 6,
                  border: value === emoji ? `1px solid ${'#F5D14E'}` : '1px solid transparent',
                  background: value === emoji ? 'rgba(245,209,78,0.12)' : 'transparent',
                  cursor: 'pointer', fontSize: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.1s',
                }}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
            {tab !== 'line' && displayEmojis.length === 0 && (
              <div style={{ gridColumn: 'span 8', padding: '16px 0', textAlign: 'center', fontSize: 13, color: '#6C6553' }}>
                No emojis found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
