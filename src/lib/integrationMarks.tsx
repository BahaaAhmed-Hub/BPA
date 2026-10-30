// Simplified drawings of each app's mark, not their official artwork. They carry
// the apps' own colours — fixed external identities, like a company's colour —
// so they live here rather than in a module, where a raw hex means "use a token".
// Greying is done by the caller with one CSS filter, never by a second set of
// grey drawings.

const S = { width: 26, height: 26, viewBox: '0 0 24 24', 'aria-hidden': true } as const

export const MARKS = {
  telegram: (
    <svg {...S}><circle cx="12" cy="12" r="11" fill="#29A9EB" /><path d="M5.2 11.7 18.4 6.6c.6-.2 1.1.1.9 1l-2.2 10.4c-.2.7-.6.9-1.2.6l-3.3-2.4-1.6 1.5c-.2.2-.3.3-.7.3l.2-3.400 6.200-5.600c.3-.2-.1-.4-.4-.2L8.600 13.200 5.300 12.200c-.7-.2-.7-.7.1-.5z" fill="#fff" /></svg>
  ),
  siri: (
    <svg {...S}><defs><radialGradient id="hub-siri" cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#7B8CFF" /><stop offset=".55" stopColor="#8A3FFC" /><stop offset="1" stopColor="#FF4F9A" /></radialGradient></defs><circle cx="12" cy="12" r="10.5" fill="url(#hub-siri)" /><path d="M5 12.5c2-3 3.200-3 4.500 0s2.500 3 4 0 2.500-3 4.500 0" fill="none" stroke="#fff" strokeWidth="1.600" strokeLinecap="round" /></svg>
  ),
  mcp: (
    <svg {...S}><rect x="2" y="2" width="20" height="20" rx="5" fill="#1B1B1F" /><path d="M7 15.500 12 8l5 7.500M9 12h6" fill="none" stroke="#fff" strokeWidth="1.700" strokeLinecap="round" strokeLinejoin="round" /><circle cx="7" cy="15.500" r="1.600" fill="#fff" /><circle cx="12" cy="8" r="1.600" fill="#fff" /><circle cx="17" cy="15.500" r="1.600" fill="#fff" /></svg>
  ),
  notion: (
    <svg {...S}><rect x="3" y="3" width="18" height="18" rx="3" fill="#fff" stroke="#1B1B1F" strokeWidth="1.600" /><path d="M8.500 16.500v-9l7 9v-9" fill="none" stroke="#1B1B1F" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  asana: (
    <svg {...S}><circle cx="12" cy="7.500" r="4" fill="#F06A6A" /><circle cx="6.500" cy="16.500" r="4" fill="#F06A6A" /><circle cx="17.500" cy="16.500" r="4" fill="#F06A6A" /></svg>
  ),
  trello: (
    <svg {...S}><rect x="2" y="2" width="20" height="20" rx="4" fill="#0079BF" /><rect x="5.500" y="5.500" width="5" height="12" rx="1.200" fill="#fff" /><rect x="13.500" y="5.500" width="5" height="7" rx="1.200" fill="#fff" /></svg>
  ),
  appleNotes: (
    <svg {...S}><rect x="3" y="2" width="18" height="20" rx="3.500" fill="#fff" stroke="#D9D2B8" strokeWidth="1" /><path d="M3 6.500a3.500 3.500 0 0 1 3.500-4.500h11A3.500 3.500 0 0 1 21 6.500V8H3z" fill="#FFD60A" /><path d="M7 12.500h10M7 16h7" stroke="#B8B2A0" strokeWidth="1.400" strokeLinecap="round" /></svg>
  ),
}
