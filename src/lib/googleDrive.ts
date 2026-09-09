import { supabase } from './supabase'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink?: string
  size?: string
}

async function driveToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.provider_token ?? localStorage.getItem('google_provider_token')
  if (!token) throw new Error('No Google access token — please sign in with Google.')
  return token
}

async function dFetch<T>(path: string): Promise<T> {
  const token = await driveToken()
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body?.error?.message ?? `Drive ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function listDriveFiles(searchQuery?: string, max = 15): Promise<DriveFile[]> {
  const q = searchQuery
    ? `trashed=false and (name contains '${searchQuery.replace(/'/g, "\\'")}' or fullText contains '${searchQuery.replace(/'/g, "\\'")}')`
    : 'trashed=false'
  const fields = 'files(id,name,mimeType,modifiedTime,webViewLink,size)'
  const path = `/files?q=${encodeURIComponent(q)}&pageSize=${max}&orderBy=modifiedTime+desc&fields=${encodeURIComponent(fields)}`
  const data = await dFetch<{ files?: DriveFile[] }>(path)
  return data.files ?? []
}

// ─── Putting a file in ───────────────────────────────────────────────────────
// A calendar attachment is a Drive file and nothing else: Google's `attachments`
// field takes a Drive URL, not bytes. So attaching a file from the disk is an
// upload first — `drive.file` scope, which reaches only what this app puts
// there — and the event then points at it. Sharing it with the guests is a
// Drive decision, and Google Calendar asks about that itself when it notices.

export interface UploadedFile {
  fileId: string
  fileUrl: string
  title: string
  mimeType: string
  size: number
}

/** Upload one file (≤ 5 MB in one request — the multipart limit) and hand back
 *  what an event's `attachments` entry needs. A token from a connected account
 *  puts it in *that* account's Drive; none means the one you signed in with. */
export async function uploadToDrive(file: File, token?: string): Promise<UploadedFile> {
  const tok = token ?? await driveToken()
  const meta = { name: file.name, mimeType: file.type || 'application/octet-stream' }
  const boundary = `bpa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: ${meta.mimeType}\r\n\r\n`
  const body = new Blob([head, file, `\r\n--${boundary}--`])
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string; status?: string } }
    // The one failure worth naming: a token minted before drive.file was asked
    // for. Nothing in this app can widen it — only signing in again can.
    if (res.status === 403 && /insufficient|scope|permission/i.test(err.error?.message ?? ''))
      throw new Error('Google has not allowed uploads for this account yet — sign out and back in to grant it')
    throw new Error(err.error?.message ?? `Drive ${res.status}`)
  }
  const d = await res.json() as { id: string; name: string; mimeType: string; webViewLink?: string; size?: string }
  return {
    fileId: d.id,
    fileUrl: d.webViewLink ?? `https://drive.google.com/file/d/${d.id}/view`,
    title: d.name,
    mimeType: d.mimeType,
    size: Number(d.size ?? file.size),
  }
}
