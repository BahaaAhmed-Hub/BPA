import Anthropic from '@anthropic-ai/sdk'
import type { Quadrant, TaskType } from '@/types'

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY ?? '',
  dangerouslyAllowBrowser: true,
})

export interface ExtractedDraftTask {
  id: string
  title: string
  quadrant: Quadrant | null
  companyName: string | null   // raw name from image; caller resolves to companyId
  taskType: TaskType
  dueDate: string | null       // YYYY-MM-DD or null
  urgent: boolean
  notes: string | null         // extra context extracted from image
  include: boolean             // user toggle in review UI
}

export interface ExtractionResult {
  tasks: ExtractedDraftTask[]
  rawText: string
}

interface AnalysisCompany { id: string; name: string }

export async function extractTasksFromFile(
  base64: string,
  mediaType: string,           // 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
  companies: AnalysisCompany[],
  todayStr: string,            // YYYY-MM-DD
): Promise<ExtractionResult> {
  const companyNames = companies.map(c => c.name).join(', ')

  const systemPrompt = `You are an expert task extraction AI. The user uploaded a handwritten or printed task list, notebook page, or document. Extract every action item, task, to-do, or commitment visible.

Return ONLY valid JSON (no markdown) in this shape:
{
  "rawText": "all visible text verbatim",
  "tasks": [
    {
      "title": "clean imperative task title",
      "quadrant": "do" | "schedule" | "delegate" | "eliminate" | null,
      "companyName": "company name if visible, else null",
      "taskType": "do" | "call" | "followup" | "email" | "research" | "study" | "meeting",
      "dueDate": "YYYY-MM-DD" | null,
      "urgent": true | false,
      "notes": "sub-bullets or extra context from the image" | null
    }
  ]
}

Quadrant rules:
- "do": urgent + important (starred, circled, !, ASAP, today, critical)
- "schedule": important not urgent (future date, plan, research, learning)
- "delegate": ask/tell/send to a specific person
- "eliminate": maybe, someday, low priority, nice-to-have
- null: unclear — leave for user

Task type: call/followup/email/meeting/research/study/do based on keywords.
Today: ${todayStr}. Known companies: ${companyNames || 'none'}.
Extract EVERY task visible. Keep titles concise but complete.`

  const fileContent: Anthropic.MessageParam['content'][number] =
    mediaType === 'application/pdf'
      ? {
          type: 'document' as const,
          source: { type: 'base64' as const, media_type: 'application/pdf', data: base64 },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
            data: base64,
          },
        }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        fileContent,
        { type: 'text', text: 'Extract all tasks from this image/document.' },
      ],
    }],
  })

  const raw = message.content.find(b => b.type === 'text')?.text ?? ''
  try {
    const cleaned = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim()
    const parsed = JSON.parse(cleaned) as { rawText: string; tasks: Omit<ExtractedDraftTask, 'id' | 'include'>[] }
    return {
      rawText: parsed.rawText ?? '',
      tasks: parsed.tasks.map(t => ({
        ...t,
        id: crypto.randomUUID(),
        include: true,
        quadrant: t.quadrant ?? null,
        taskType: t.taskType ?? 'do',
        dueDate: t.dueDate ?? null,
        companyName: t.companyName ?? null,
        notes: t.notes ?? null,
        urgent: t.urgent ?? false,
      })),
    }
  } catch {
    return { rawText: raw, tasks: [] }
  }
}
