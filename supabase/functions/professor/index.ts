// Supabase Edge Function — Professor AI proxy
// Keeps ANTHROPIC_API_KEY server-side; never exposed to the browser.
//
// Deploy:  supabase functions deploy professor
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
}

interface AnthropicResponse {
  content?: { type: string; text: string }[]
  error?: { message: string }
}

Deno.serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // ── Auth: verify Supabase JWT ──────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // ── Parse body ─────────────────────────────────────────────────────────
    const body = await req.json() as RequestBody
    if (!body.system || !Array.isArray(body.messages)) {
      return json({ error: 'Invalid request body' }, 400)
    }

    // ── Call Anthropic ─────────────────────────────────────────────────────
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return json({ error: 'ANTHROPIC_API_KEY secret not configured' }, 500)
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: body.system,
        messages: body.messages,
      }),
    })

    const data = await anthropicRes.json() as AnthropicResponse

    if (!anthropicRes.ok) {
      return json({ error: data.error?.message ?? `Anthropic ${anthropicRes.status}` }, anthropicRes.status)
    }

    return json(data)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
