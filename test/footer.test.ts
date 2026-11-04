import { describe, expect, test } from 'bun:test'

import { footerItems } from '../src/footer.ts'

describe('the footer', () => {
  test('the pointed file, or that none is; the count; nothing pressable', () => {
    const items = footerItems({ pointed: 'src/app.tsx', shown: 3, truncated: 0, notice: null })
    expect(items.map((i) => [i.id, i.kind, 'text' in i ? i.text : null])).toEqual([
      ['pointed', 'text', 'src/app.tsx'],
      ['count', 'text', '3 entries'],
    ])
    expect(footerItems({ pointed: null, shown: 1, truncated: 0, notice: null })[0]).toMatchObject({ text: 'No file picked' })
  })

  test('what the tree leaves out, and a copy that failed', () => {
    const items = footerItems({ pointed: null, shown: 500, truncated: 15000, notice: 'Could not copy the path.' })
    expect(items.find((i) => i.id === 'count')).toMatchObject({ text: `500 entries · ${(15000).toLocaleString()} more` })
    expect(items.find((i) => i.id === 'notice')).toMatchObject({ level: 'critical' })
  })

  test('a long path keeps its end', () => {
    const long = `${'deep/'.repeat(40)}file.ts`
    const text = (footerItems({ pointed: long, shown: 1, truncated: 0, notice: null })[0] as { text: string }).text
    expect(text.length).toBeLessThanOrEqual(120)
    expect(text.endsWith('file.ts')).toBe(true)
  })
})
