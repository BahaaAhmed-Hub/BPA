import { supabase } from './supabase'

export interface TelegramLink {
  chat_id:   string
  linked_at: string
}

export async function getTelegramLinks(): Promise<TelegramLink[]> {
  const { data } = await supabase
    .from('telegram_links')
    .select('chat_id, linked_at')
    .order('linked_at', { ascending: false })
  return (data as TelegramLink[] | null) ?? []
}

export async function revokeTelegramLink(chatId: string): Promise<boolean> {
  const { error } = await supabase
    .from('telegram_links')
    .delete()
    .eq('chat_id', chatId)
  return !error
}
