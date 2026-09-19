// The DAG canvas.
//
// Rendering is imperative — a `<canvas>` is not a React abstraction — but the
// geometry is not computed here: `layoutDag` (in the contract layer, shared with
// the Node half and unit-checked there) produces all positions, and this module
// only paints them. State never flows back: hovering is local, and the optional
// per-node detail is rendered as React markup beside the canvas, not on it.
import * as React from 'react'
import { decorateDag, LAYOUT } from '../../contract/layout.js'
import { resolvePalette, STATUS_FALLBACK, STATUS_ROLE } from '../palette.js'
import { Chip, StatusBadge } from '../ui.js'
import { NODE_STATUSES } from '../../contract/domain.js'

/** Draw one rounded rectangle path. */
function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

/** Truncate text to fit a pixel width, appending an ellipsis. */
function fitText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 1 && context.measureText(value + '…').width > maxWidth) value = value.slice(0, -1)
  return value + '…'
}

/** Colour for a node status. */
function statusColor(palette, status) {
  const role = STATUS_ROLE[status] === undefined ? 'muted' : STATUS_ROLE[status]
  if (palette[role] !== undefined && palette[role] !== '') return palette[role]
  return STATUS_FALLBACK[status] === undefined ? STATUS_FALLBACK.pending : STATUS_FALLBACK[status]
}

/**
 * Paint a laid-out DAG.
 *
 * @param canvas - the target element.
 * @param layout - a value from `layoutDag`.
 * @param nodeStates - run nodes used to colour the boxes, or `undefined`.
 * @returns the pixel size that was drawn, for the hover hit-test.
 */
export function paintDag(canvas, layout, nodeStates) {
  const palette = resolvePalette(typeof window === 'undefined' ? undefined : window)
  const ratio = typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const nodes = decorateDag(layout, nodeStates)
  const width = Math.max(LAYOUT.padding * 2, Math.round(layout.width))
  const height = Math.max(LAYOUT.padding * 2, Math.round(layout.height))
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.style.height = String(height) + 'px'
  const context = canvas.getContext('2d')
  if (context === null || context === undefined) return { width, height, nodes }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)

  // Edges first, so a box always covers the line that reaches it.
  context.lineWidth = 1.5
  context.strokeStyle = palette.border
  for (const edge of layout.edges) {
    const midX = edge.x1 + (edge.x2 - edge.x1) / 2
    context.beginPath()
    context.moveTo(edge.x1, edge.y1)
    context.bezierCurveTo(midX, edge.y1, midX, edge.y2, edge.x2, edge.y2)
    context.stroke()
    // Arrow head at the target edge.
    const direction = edge.y2 === edge.y1 ? 0 : edge.y2 > edge.y1 ? 1 : -1
    context.beginPath()
    context.moveTo(edge.x2, edge.y2)
    context.lineTo(edge.x2 - 7, edge.y2 - 4 * (direction === 0 ? 1 : direction))
    context.lineTo(edge.x2 - 7, edge.y2 + 4 * (direction === 0 ? 1 : direction))
    context.closePath()
    context.fillStyle = palette.border
    context.fill()
  }

  for (const node of nodes) {
    const accent = statusColor(palette, node.status)
    context.fillStyle = palette.surface
    roundRect(context, node.x, node.y, node.width, node.height, 10)
    context.fill()
    context.lineWidth = node.status === 'pending' ? 1 : 2
    context.strokeStyle = node.status === 'pending' ? palette.border : accent
    context.stroke()
    // A status stripe on the left edge reads at a glance without relying on hue.
    context.fillStyle = accent
    roundRect(context, node.x, node.y, 4, node.height, 2)
    context.fill()

    context.fillStyle = palette.text
    context.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif'
    context.textBaseline = 'alphabetic'
    context.fillText(fitText(context, node.id, node.width - 20), node.x + 12, node.y + 22)

    context.fillStyle = palette.muted
    context.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
    const detail = node.assignee === '' ? node.status : node.assignee
    context.fillText(fitText(context, detail, node.width - 20), node.x + 12, node.y + 40)
    if (node.missingDeps.length > 0) {
      context.fillStyle = palette.warn
      context.fillText(fitText(context, '⚠ ' + node.missingDeps.join(','), node.width - 20), node.x + 12, node.y + 55)
    }
  }
  return { width, height, nodes }
}

/**
 * The canvas surface plus its legend and per-node detail list.
 *
 * @param props - `{ layout, nodeStates, t, selectedId?, onSelect? }`.
 * @returns the element.
 */
export function DagCanvas(props) {
  const canvasRef = React.useRef(null)
  const [hover, setHover] = React.useState(null)
  const layout = props.layout
  const nodeStates = props.nodeStates
  const t = props.t

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || canvas === undefined) return
    try {
      paintDag(canvas, layout, nodeStates)
    } catch {
      // A canvas that cannot be painted (no 2d context, detached element) must
      // not take the whole section down; the node list below still carries data.
    }
  }, [layout, nodeStates])

  const decorated = React.useMemo(() => decorateDag(layout, nodeStates), [layout, nodeStates])

  const legend = [
    { status: 'pending', label: t('dag.legend.pending') },
    { status: 'completed', label: t('dag.legend.completed') },
    { status: 'failed', label: t('dag.legend.failed') },
  ]

  return React.createElement(
    'div',
    { className: 'tfc-col' },
    React.createElement(
      'div',
      { className: 'tfc-legend' },
      legend.map((item) =>
        React.createElement(
          'span',
          { key: item.status, className: 'tfc-legend-item' },
          React.createElement('span', { className: 'tfc-swatch', style: { background: statusColor(resolvePalette(undefined), item.status) } }),
          item.label,
        ),
      ),
      React.createElement(
        'span',
        { className: 'tfc-legend-item' },
        React.createElement('span', { className: 'tfc-swatch', style: { background: 'transparent' } }),
        t('dag.legend.edge'),
      ),
    ),
    React.createElement(
      'div',
      { className: 'tfc-canvas-wrap' },
      React.createElement('canvas', {
        ref: canvasRef,
        className: 'tfc-canvas',
        role: 'img',
        'aria-label': t('dag.canvasLabel'),
        onMouseMove: (event) => {
          const canvas = canvasRef.current
          if (canvas === null || canvas === undefined) return
          const rect = canvas.getBoundingClientRect()
          const x = event.clientX - rect.left
          const y = event.clientY - rect.top
          let found = null
          for (const node of decorated) {
            if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) {
              found = node.id
              break
            }
          }
          if (found !== hover) setHover(found)
        },
        onMouseLeave: () => setHover(null),
        onClick: () => {
          if (typeof props.onSelect === 'function') props.onSelect(hover)
        },
      }),
    ),
    React.createElement(
      'div',
      { className: 'tfc-node-list' },
      decorated.map((node) =>
        React.createElement(
          'div',
          {
            key: node.id,
            className: 'tfc-card' + (props.selectedId === node.id ? ' tfc-item-on' : ''),
            style: { borderColor: hover === node.id || props.selectedId === node.id ? 'var(--dsw-alias-brand-primary, #0f1115)' : undefined },
            onClick: () => {
              if (typeof props.onSelect === 'function') props.onSelect(node.id)
            },
          },
          React.createElement(
            'div',
            { className: 'tfc-row-between' },
            React.createElement('span', { className: 'tfc-item-title' }, node.id),
            React.createElement(StatusBadge, { table: NODE_STATUSES, status: node.status }),
          ),
          React.createElement(
            'div',
            { className: 'tfc-row', style: { marginTop: 4 } },
            React.createElement(Chip, { title: 'agent' }, node.assignee === '' ? '—' : node.assignee),
            React.createElement(Chip, null, 'L' + String(node.layer)),
            node.missingDeps.length === 0 ? null : React.createElement(Chip, { title: t('dag.missingDeps', { ids: node.missingDeps.join(', ') }) }, '⚠ ' + node.missingDeps.join(',')),
          ),
          node.output === '' ? null : React.createElement('pre', { className: 'tfc-pre', style: { marginTop: 6 } }, node.output),
          node.error === '' ? null : React.createElement('div', { className: 'tfc-error', style: { marginTop: 6 } }, node.error),
        ),
      ),
    ),
  )
}
