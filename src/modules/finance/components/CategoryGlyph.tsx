import { lucideComponent } from '../categoryIcons'

/** One place that knows how to draw a category's icon, whichever of the three
 *  kinds it is: a lucide name, an uploaded picture, or an emoji. A line icon
 *  takes the colour it is given; the other two bring their own. */
export function CategoryGlyph({ icon, size = 18, color }: {
  icon?: string
  size?: number
  color?: string
}) {
  const Line = lucideComponent(icon)
  if (Line) return <Line size={size} strokeWidth={1.75} color={color ?? 'currentColor'} />

  if (icon && (icon.startsWith('data:') || icon.startsWith('http'))) {
    return <img src={icon} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 5 }} />
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{icon || '📁'}</span>
}

/** The icon as text, for the one place that cannot take a component: an
 *  <option>. A lucide name or an uploaded picture has no text form, so it
 *  yields nothing rather than printing "lucide:Home" or a data URL. */
export function glyphAsText(icon?: string): string {
  if (!icon) return ''
  if (icon.startsWith('lucide:') || icon.startsWith('data:') || icon.startsWith('http')) return ''
  return icon
}
