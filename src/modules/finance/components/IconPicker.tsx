import { useState, useRef, useEffect } from 'react'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'

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

// ─── IconPicker ────────────────────────────────────────────────────────────────

export function IconPicker({ value, onChange, size = 44, trigger }: Props) {
  const theme = getTheme(useUIStore(s => s.themeId))
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('finance')
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
            border: `2px solid ${open ? theme.accent : theme.border}`,
            background: theme.surface,
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
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '10px 12px 0' }}>
            <input
              autoFocus
              type="text"
              placeholder="Search emojis…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '7px 10px',
                borderRadius: 8, border: `1px solid ${theme.border}`,
                background: theme.bg, color: theme.text,
                fontSize: 13, outline: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Category tabs */}
          {!search && (
            <div style={{
              display: 'flex', overflowX: 'auto', padding: '8px 12px 4px',
              gap: 2, scrollbarWidth: 'none',
            }}>
              {GROUPS.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setTab(g.id)}
                  title={g.title}
                  style={{
                    flexShrink: 0, width: 32, height: 28,
                    borderRadius: 6, border: 'none',
                    background: tab === g.id ? theme.accentFill : 'transparent',
                    cursor: 'pointer', fontSize: 16,
                    outline: tab === g.id ? `1px solid ${theme.accent}44` : 'none',
                  }}
                >
                  {g.label}
                </button>
              ))}
              {/* Upload tab */}
              <button
                type="button"
                onClick={() => { setTab('upload'); setSearch('') }}
                title="Upload image"
                style={{
                  flexShrink: 0, width: 32, height: 28,
                  borderRadius: 6, border: 'none',
                  background: tab === 'upload' ? theme.accentFill : 'transparent',
                  cursor: 'pointer', fontSize: 14,
                  color: tab === 'upload' ? theme.accent : theme.textDim,
                  outline: tab === 'upload' ? `1px solid ${theme.accent}44` : 'none',
                }}
              >
                🖼
              </button>
            </div>
          )}

          {/* Content */}
          {tab === 'upload' && !search ? (
            <div style={{ padding: '16px 12px 12px', textAlign: 'center' }}>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{
                  width: '100%', padding: '12px',
                  borderRadius: 10, border: `2px dashed ${theme.border}`,
                  background: theme.bg, color: theme.textDim,
                  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                📁 Click to upload image
              </button>
              {isImage && (
                <div style={{ marginTop: 10 }}>
                  <img src={value} alt="current" style={{ width: 60, height: 60, borderRadius: 10, objectFit: 'cover', border: `1px solid ${theme.border}` }} />
                  <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>Current image</div>
                </div>
              )}
              <div style={{ marginTop: 10, fontSize: 12, color: theme.textMuted }}>PNG, JPG, WebP · stored as base64</div>
            </div>
          ) : (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 2, padding: '6px 8px 10px',
              maxHeight: 220, overflowY: 'auto',
            }}>
              {displayEmojis.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => { onChange(emoji); setOpen(false); setSearch('') }}
                  style={{
                    width: 34, height: 34, borderRadius: 6,
                    border: value === emoji ? `1px solid ${theme.accent}` : '1px solid transparent',
                    background: value === emoji ? theme.accentFill : 'transparent',
                    cursor: 'pointer', fontSize: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.1s',
                  }}
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
              {displayEmojis.length === 0 && (
                <div style={{ gridColumn: 'span 8', padding: '16px 0', textAlign: 'center', fontSize: 13, color: theme.textDim }}>
                  No emojis found
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
