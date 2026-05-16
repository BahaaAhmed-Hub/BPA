/**
 * todoistOAuth.ts — Todoist OAuth helpers and task fetching.
 */
import { supabase } from '@/lib/supabase'

const CLIENT_ID = import.meta.env.VITE_TODOIST_CLIENT_ID as string | undefined

export const TODOIST_CONFIGURED: boolean = !!(CLIENT_ID && CLIENT_ID.trim().length > 0)

export interface TodoistTask {
  id: string
  content: string
  due?: { date: string }
  priority: number
}

/**
 * Opens a popup to the Todoist OAuth authorization page.
 * Resolves with an access token when the popup redirects back and posts a message.
 * Rejects if the popup is closed or if 5 minutes elapse.
 */
export function openTodoistAuth(): Promise<string> {
  return new Promise((resolve, reject) => {
    const state = crypto.randomUUID()
    const authUrl =
      `https://todoist.com/oauth/authorize` +
      `?client_id=${encodeURIComponent(CLIENT_ID ?? '')}` +
      `&scope=data:read` +
      `&state=${encodeURIComponent(state)}`

    const popup = window.open(authUrl, 'todoist-oauth', 'width=600,height=700,noopener')

    if (!popup) {
      reject(new Error('Failed to open Todoist OAuth popup. Allow popups and try again.'))
      return
    }

    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Todoist OAuth timed out after 5 minutes.'))
    }, 5 * 60 * 1000)

    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type !== 'todoist-token') return
      if (settled) return
      settled = true
      cleanup()
      if (event.data.token) {
        resolve(event.data.token as string)
      } else {
        reject(new Error('No token received from Todoist OAuth.'))
      }
    }

    const pollClose = setInterval(() => {
      if (popup.closed) {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error('Todoist OAuth popup was closed.'))
      }
    }, 500)

    function cleanup() {
      clearTimeout(timeout)
      clearInterval(pollClose)
      window.removeEventListener('message', messageHandler)
    }

    window.addEventListener('message', messageHandler)
  })
}

/**
 * Calls the Supabase edge function `todoist-oauth` to exchange an auth code for
 * an access token. Returns the token string.
 */
export async function exchangeTodoistCode(code: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('todoist-oauth', {
    body: { code },
  })

  if (error) throw new Error(`Todoist token exchange failed: ${error.message}`)

  const token = (data as { token?: string })?.token
  if (!token) throw new Error('No token returned from todoist-oauth function.')
  return token
}

/**
 * Fetches all tasks from the Todoist REST v2 API using a bearer token.
 */
export async function fetchTodoistTasks(token: string): Promise<TodoistTask[]> {
  const res = await fetch('https://api.todoist.com/rest/v2/tasks', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new Error(`Todoist API error: ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as TodoistTask[]
}
