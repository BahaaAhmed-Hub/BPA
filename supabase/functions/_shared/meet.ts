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

/** Can this calendar mint a Google Meet link? Google reports what each calendar allows in
 *  `conferenceProperties.allowedConferenceSolutionTypes` (`hangoutsMeet`, `eventHangout`, `eventNamedHangout`,
 *  `addOn`). A calendar whose list leaves Meet out — a Workspace that switched it off, or one that only offers a
 *  third-party add-on — would be sent a request it cannot honour. An absent list is unknown, and is tried. */
export function supportsMeet(allowed: string[] | undefined | null): boolean {
  return !Array.isArray(allowed) || allowed.includes('hangoutsMeet')
}

/** Said instead of a link, when the calendar's own settings rule Meet out. */
export function noMeetSentence(calendarName: string, allowed: string[] | undefined | null): string {
  const has = (allowed ?? []).filter(Boolean)
  return ` No video link was added: "${calendarName}" does not allow Google Meet${has.length ? ` (it allows: ${has.join(', ')})` : ''}. ` +
    'Its video provider is set on the account itself (a Zoom or Teams add-on has to be added from the event in Google Calendar), so I left the event as it is.'
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
