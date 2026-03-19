import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY ?? '',
  dangerouslyAllowBrowser: true,
})

export interface ProfessorMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function askProfessor(
  messages: ProfessorMessage[],
  systemContext?: string,
): Promise<string> {
  const systemPrompt = `You are The Professor — a premium AI executive productivity assistant. 
You help busy executives manage their time, priorities, and decisions with clarity and precision.
Your tone is authoritative yet warm, concise, and always actionable.
${systemContext ?? ''}`

  const stream = await client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  })

  const response = await stream.finalMessage()
  const textBlock = response.content.find(b => b.type === 'text')
  return textBlock && textBlock.type === 'text' ? textBlock.text : ''
}
