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
