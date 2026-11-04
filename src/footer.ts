import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

/**
 * Explorer's footer, in a host that draws one (`kehikot.footer`, protocol 2.38.0): where the canvas
 * points in the tree and how much of it is shown, so a container folded to its header and footer
 * still says it. The header keeps Refresh (an act on the whole tree); the strips the page drew under
 * the tree (what was left out, a copy that failed) are here instead. Nothing here is pressable.
 *
 * - the file the canvas points at, by its path in the project, or that none is;
 * - how many entries the tree shows, and how many more a folder holds than it shows;
 * - a copy of a path that failed.
 *
 * Pure: the page declares it only when the greeting said the host draws it.
 */
export interface FooterState {
  /** The pointed file's path in the project, or null. */
  pointed: string | null
  /** Entries drawn now. */
  shown: number
  /** How many more the open folders hold than the tree shows. */
  truncated: number
  /** A notice, such as a copy that failed, or null. */
  notice: string | null
}

const cut = (text: string, most: number) => (text.length > most ? `…${text.slice(text.length - most + 1)}` : text)

export function footerItems({ pointed, shown, truncated, notice }: FooterState): FooterItem[] {
  const items: unknown[] = [
    pointed
      ? { kind: 'text', id: 'pointed', text: cut(pointed, LIMITS.FOOTER_TEXT), tooltip: cut(`The canvas points at ${pointed}`, LIMITS.FOOTER_TOOLTIP) }
      : { kind: 'text', id: 'pointed', text: 'No file picked', tooltip: 'Press a file to point the canvas at it.' },
    {
      kind: 'text',
      id: 'count',
      text: `${shown.toLocaleString()} ${shown === 1 ? 'entry' : 'entries'}${truncated ? ` · ${truncated.toLocaleString()} more` : ''}`,
      align: 'end',
      optional: true,
      ...(truncated ? { tooltip: `${truncated.toLocaleString()} more here than this shows.` } : {}),
    },
  ]
  if (notice) items.push({ kind: 'text', id: 'notice', text: cut(notice, LIMITS.FOOTER_TEXT), level: 'critical', align: 'center' })
  return footerItemsSchema.parse(items)
}
