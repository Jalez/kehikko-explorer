import { projectKey } from 'kehikot-module-protocol'
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

/**
 * What the view is kept under: the project's id (`projectKey`), which a rename of the folder does
 * not change. `legacy` is where an older page kept it, the path; it is read once when nothing is held
 * under `key`, and never written.
 */
export interface ViewScope {
  key: string
  legacy: string
}

export function scopeOf(projectId: string | null | undefined, projectPath: string | null | undefined): ViewScope | null {
  const keyed = projectKey({ projectId, projectPath })
  if (!keyed) return null
  return { key: keyed.key, legacy: projectPath?.trim() || keyed.key }
}

const asScope = (scope: string | ViewScope): ViewScope => (typeof scope === 'string' ? { key: scope, legacy: scope } : scope)

export const viewOf = (scope: string | ViewScope): View => {
  const { key, legacy } = asScope(scope)
  return VIEW.at(key).read(TREE) ?? (legacy !== key ? VIEW.at(legacy).read(TREE) : null) ?? NOWHERE
}

export const keepView = (scope: string | ViewScope, change: Partial<View>): void => {
  const { key, legacy } = asScope(scope)
  VIEW.at(key).keep(TREE, { ...viewOf(scope), ...change })
  /* Read once: what was held under the path is carried over by the line above and not left to come back. */
  if (legacy !== key) VIEW.at(legacy).keep(TREE, null)
}
