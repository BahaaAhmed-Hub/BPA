// ─── One meaning per quadrant ────────────────────────────────────────────────
// Do-now, schedule, delegate, eliminate are the four answers to "what do I do
// with this task", and each answer has one colour and one glyph wherever it is
// drawn — the matrix, the dashboard, the planner, the image import. They had
// drifted into four different palettes (violet/olive/amber on one screen,
// info/ink/positive on another), so the same quadrant changed meaning between
// screens. The colours are the semantic tokens, so they follow the theme.
import { Zap, Calendar, ArrowRight, Ban, type LucideIcon } from 'lucide-react'
import type { Quadrant } from '@/types'

export const QUADRANTS: Record<Quadrant, { label: string; color: string; Icon: LucideIcon }> = {
  do:        { label: 'Do now',    color: 'var(--sb-negative)', Icon: Zap },
  schedule:  { label: 'Schedule',  color: 'var(--sb-info)',     Icon: Calendar },
  delegate:  { label: 'Delegate',  color: 'var(--sb-positive)', Icon: ArrowRight },
  eliminate: { label: 'Eliminate', color: 'var(--sb-ink-3)',    Icon: Ban },
}

export const QUADRANT_ORDER: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']
