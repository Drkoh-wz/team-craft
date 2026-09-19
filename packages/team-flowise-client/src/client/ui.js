// Small presentational primitives shared by the three surfaces.
//
// Plain `React.createElement` only: the client half is fed straight to the
// browser by the module system, with no JSX or TypeScript transform anywhere.
import * as React from 'react'
import { TONE_VARS, statusEntry } from '../contract/domain.js'

/**
 * Colour for one semantic tone, as a CSS custom property reference.
 *
 * @param tone - a tone key from the domain tables.
 * @returns a `var(...)` expression with a neutral fallback.
 */
export function toneColor(tone) {
  const token = TONE_VARS[tone] === undefined ? TONE_VARS.neutral : TONE_VARS[tone]
  return 'var(--dsw-alias-' + token + ', var(--dsw-alias-label-secondary, #61666b))'
}

/**
 * A status pill: a colour dot plus the status label.
 *
 * @param props - `{ table, status }`, where `table` is one of the domain status
 *   tables and `status` is the raw key stored by the host.
 * @returns the badge element.
 */
export function StatusBadge(props) {
  const entry = statusEntry(props.table, props.status)
  return React.createElement(
    'span',
    { className: 'tfc-badge', style: { color: toneColor(entry.tone) }, title: String(props.status === undefined ? '' : props.status) },
    React.createElement('span', { className: 'tfc-dot' }),
    entry.label,
  )
}

/**
 * A neutral chip for short scalar metadata.
 *
 * @param props - `{ children, title? }`.
 * @returns the chip element.
 */
export function Chip(props) {
  const children = props.children
  if (children === undefined || children === null || children === '') return null
  return React.createElement('span', { className: 'tfc-chip', title: props.title }, children)
}

/**
 * A labelled form field wrapper.
 *
 * @param props - `{ label, children, hint? }`.
 * @returns the field element.
 */
export function Field(props) {
  return React.createElement(
    'div',
    { className: 'tfc-field' },
    React.createElement('label', { className: 'tfc-label' }, props.label),
    props.children,
    props.hint === undefined ? null : React.createElement('span', { className: 'tfc-caption' }, props.hint),
  )
}

/**
 * A controlled text input.
 *
 * @param props - `{ value, onChange, placeholder?, type? }`; `onChange` receives
 *   the next string, not the event.
 * @returns the input element.
 */
export function TextInput(props) {
  return React.createElement('input', {
    className: 'tfc-input',
    type: props.type === undefined ? 'text' : props.type,
    value: props.value === undefined || props.value === null ? '' : props.value,
    placeholder: props.placeholder,
    onChange: (event) => props.onChange(event.target.value),
  })
}

/**
 * A controlled multi-line input.
 *
 * @param props - `{ value, onChange, placeholder?, rows? }`.
 * @returns the textarea element.
 */
export function TextArea(props) {
  return React.createElement('textarea', {
    className: 'tfc-textarea',
    rows: props.rows,
    value: props.value === undefined || props.value === null ? '' : props.value,
    placeholder: props.placeholder,
    onChange: (event) => props.onChange(event.target.value),
  })
}

/**
 * A controlled select over `{ value, label }` options.
 *
 * @param props - `{ value, onChange, options, placeholder? }`.
 * @returns the select element.
 */
export function Select(props) {
  const options = Array.isArray(props.options) ? props.options : []
  const children = []
  if (props.placeholder !== undefined) children.push(React.createElement('option', { key: '__none', value: '' }, props.placeholder))
  for (const option of options) children.push(React.createElement('option', { key: option.value, value: option.value }, option.label))
  return React.createElement(
    'select',
    { className: 'tfc-select', value: props.value === undefined || props.value === null ? '' : props.value, onChange: (event) => props.onChange(event.target.value) },
    children,
  )
}

/**
 * A button. `variant` selects the visual weight.
 *
 * @param props - `{ children, onClick?, variant?, disabled?, title? }`.
 * @returns the button element.
 */
export function Button(props) {
  const classes = ['tfc-btn']
  if (props.variant === 'primary') classes.push('tfc-btn-primary')
  else if (props.variant === 'danger') classes.push('tfc-btn-danger')
  else if (props.variant === 'ghost') classes.push('tfc-btn-ghost')
  return React.createElement(
    'button',
    {
      type: 'button',
      className: classes.join(' '),
      onClick: props.onClick,
      disabled: props.disabled === true,
      title: props.title,
    },
    props.children,
  )
}

/**
 * A loading placeholder.
 *
 * @param props - `{ label }`.
 * @returns the placeholder element.
 */
export function Loading(props) {
  return React.createElement(
    'div',
    { className: 'tfc-empty' },
    React.createElement('span', { className: 'tfc-spin' }, '\u25CC'),
    ' ',
    props.label,
  )
}

/**
 * An empty-state placeholder.
 *
 * @param props - `{ label }`.
 * @returns the placeholder element.
 */
export function Empty(props) {
  return React.createElement('div', { className: 'tfc-empty' }, props.label)
}

/**
 * An error banner with an optional retry action.
 *
 * @param props - `{ label, message, onRetry?, retryLabel? }`.
 * @returns the banner element.
 */
export function ErrorBanner(props) {
  return React.createElement(
    'div',
    { className: 'tfc-error' },
    React.createElement('div', null, props.label + ': ' + props.message),
    props.onRetry === undefined
      ? null
      : React.createElement('div', { style: { marginTop: 6 } }, React.createElement(Button, { onClick: props.onRetry, variant: 'ghost' }, props.retryLabel)),
  )
}

/**
 * A determinate progress bar.
 *
 * @param props - `{ percent }`, clamped to 0–100.
 * @returns the bar element.
 */
export function ProgressBar(props) {
  const raw = typeof props.percent === 'number' && Number.isFinite(props.percent) ? props.percent : 0
  const percent = Math.max(0, Math.min(100, Math.round(raw)))
  return React.createElement(
    'div',
    { className: 'tfc-bar', title: String(percent) + '%' },
    React.createElement('div', { className: 'tfc-bar-fill', style: { width: String(percent) + '%' } }),
  )
}

/**
 * A modal shell. Clicking the backdrop closes; clicking the card does not.
 *
 * @param props - `{ open, title, onClose, children }`.
 * @returns the modal element, or `null` when closed.
 */
export function Modal(props) {
  if (props.open !== true) return null
  return React.createElement(
    'div',
    {
      className: 'tfc-modal',
      onClick: (event) => {
        if (event.target === event.currentTarget && typeof props.onClose === 'function') props.onClose()
      },
    },
    React.createElement(
      'div',
      { className: 'tfc-modal-card' },
      React.createElement('h3', { className: 'tfc-modal-title' }, props.title),
      props.children,
    ),
  )
}

/**
 * Format an epoch-millisecond timestamp for display.
 *
 * @param value - milliseconds since epoch, or `0`/`undefined` when unknown.
 * @returns a locale string, or an em dash for a missing timestamp.
 */
export function formatTime(value) {
  if (typeof value !== 'number' || value <= 0) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return String(value)
  }
}

/**
 * Format a duration between two timestamps.
 *
 * @param start - epoch milliseconds.
 * @param end - epoch milliseconds; `0` means "still running", measured against now.
 * @returns a compact duration such as `1m 12s`, or an em dash.
 */
export function formatDuration(start, end) {
  if (typeof start !== 'number' || start <= 0) return '—'
  const finished = typeof end === 'number' && end > 0 ? end : Date.now()
  const seconds = Math.max(0, Math.round((finished - start) / 1000))
  if (seconds < 60) return String(seconds) + 's'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return String(minutes) + 'm ' + String(seconds % 60) + 's'
  return String(Math.floor(minutes / 60)) + 'h ' + String(minutes % 60) + 'm'
}

/** A key/value grid row pair, exposed as two elements for grid layout. */
export function KeyValue(props) {
  return [
    React.createElement('span', { key: 'k', className: 'tfc-kv-key' }, props.label),
    React.createElement('span', { key: 'v', className: 'tfc-kv-val' }, props.value === undefined || props.value === '' ? '—' : props.value),
  ]
}
