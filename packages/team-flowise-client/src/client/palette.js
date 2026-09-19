// Canvas palette.
//
// A `<canvas>` cannot inherit CSS custom properties, so the colours have to be
// resolved to concrete strings. They are read from the live theme tokens when a
// document is available (so the canvas follows the active theme instead of
// pinning one palette) and fall back to these literals otherwise.

/** Token → fallback pairs, per semantic role. */
export const PALETTE_TOKENS = {
  text: ['--dsw-alias-label-primary', '#0f1115'],
  muted: ['--dsw-alias-label-tertiary', '#81858c'],
  border: ['--dsw-alias-border-l2', 'rgba(0,0,0,0.16)'],
  surface: ['--dsw-alias-bg-layer-1', '#ffffff'],
  surfaceAlt: ['--dsw-alias-bg-layer-2', '#f6f7f8'],
  accent: ['--dsw-alias-brand-primary', '#0f1115'],
  success: ['--dsw-alias-state-success-primary', '#067647'],
  error: ['--dsw-alias-state-error-primary', '#d92d20'],
  warn: ['--dsw-alias-state-warn-primary', '#b54708'],
  business: ['--dsw-alias-state-business-primary', '#175cd3'],
}

/** Node status → palette role. */
export const STATUS_ROLE = {
  pending: 'muted',
  completed: 'success',
  failed: 'error',
  running: 'business',
}

/** Status → fill colour when no token is resolvable. */
export const STATUS_FALLBACK = {
  pending: '#c4c8ce',
  completed: '#12a150',
  failed: '#e5484d',
  running: '#3b82f6',
}

/**
 * Resolve the palette for the current page.
 *
 * Dark mode is detected the way the shell marks it (`body[data-ds-dark-theme]`),
 * which only affects the fallbacks — resolvable tokens win either way.
 *
 * @param win - a `Window`; omit on a non-DOM platform.
 * @returns an object of concrete colour strings keyed by palette role.
 */
export function resolvePalette(win) {
  const target = win === undefined ? (typeof window === 'undefined' ? undefined : window) : win
  const palette = {}
  for (const role of Object.keys(PALETTE_TOKENS)) palette[role] = PALETTE_TOKENS[role][1]
  if (target === undefined || target === null || typeof target.getComputedStyle !== 'function') return palette
  const doc = target.document
  const dark = doc !== undefined && doc.body !== null && doc.body !== undefined && doc.body.hasAttribute('data-ds-dark-theme')
  if (dark) {
    palette.text = '#f4f5f6'
    palette.muted = '#9ba1a8'
    palette.border = 'rgba(255,255,255,0.18)'
    palette.surface = '#1c1c1f'
    palette.surfaceAlt = '#232327'
    palette.accent = '#f4f5f6'
  }
  const root = doc !== undefined && doc.documentElement !== undefined ? doc.documentElement : undefined
  if (root === undefined) return palette
  let computed
  try {
    computed = target.getComputedStyle(root)
  } catch {
    return palette
  }
  for (const role of Object.keys(PALETTE_TOKENS)) {
    let value = ''
    try {
      value = computed.getPropertyValue(PALETTE_TOKENS[role][0])
    } catch {
      value = ''
    }
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed !== '') palette[role] = trimmed
  }
  return palette
}
