import { held } from 'kehikot-module-protocol/client'

/**
 * Where somebody was in the tree, kept across a reload of this page: the folders they had open and
 * how far down they had scrolled. Per project, in this tab's `sessionStorage`, written as it
 * changes — nothing can catch a reload in time (the protocol's docs/module-plumbing.md).
 */
export interface View {
  open: string[]
  top: number
}

const NOWHERE: View = { open: [], top: 0 }
const TREE = 'tree'

/* Anything not this shape is nothing held, and so is a tree with nothing open at its top. */
const VIEW = held<View>('kehikot.explorer.view', (stored) => {
  const { open, top } = (stored ?? {}) as Partial<View>
  if (!Array.isArray(open) || typeof top !== 'number' || !(top >= 0)) return null
  const view = { open: open.filter((path) => typeof path === 'string' && path), top }
  return view.open.length || view.top ? view : null
})

export const viewOf = (projectPath: string): View => VIEW.at(projectPath).read(TREE) ?? NOWHERE

export const keepView = (projectPath: string, change: Partial<View>): void =>
  VIEW.at(projectPath).keep(TREE, { ...viewOf(projectPath), ...change })
