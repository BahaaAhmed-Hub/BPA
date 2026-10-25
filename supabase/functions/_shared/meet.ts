// A Google Meet link for an event an assistant creates or edits — shared by the bots and the in-app assistant.

/** The body fragment that asks Google to mint a Meet link. Needs `conferenceDataVersion=1` on the request. */
export function meetRequest(): { conferenceData: Record<string, unknown> } {
  return {
    conferenceData: {
      createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
  }
}

interface EventWithMeet {
  hangoutLink?: string
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
}

/** The video link an event already carries, if any. */
export function meetLinkOf(ev: EventWithMeet | null | undefined): string | null {
  if (!ev) return null
  return ev.hangoutLink
    ?? ev.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video' && p.uri)?.uri
    ?? null
}

/** What to tell the person. Google sometimes answers before the link exists, and "added" would then be a claim. */
export function meetSentence(ev: EventWithMeet | null | undefined): string {
  const link = meetLinkOf(ev)
  return link
    ? ` Meet link: ${link}`
    : ' A Meet link was requested but Google has not returned it yet — it should appear on the event in a moment (this calendar may not support Meet).'
}
