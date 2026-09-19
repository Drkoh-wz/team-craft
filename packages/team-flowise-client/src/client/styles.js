// The package's whole stylesheet, as one string.
//
// Two consumers: the client entry injects it once into `document.head` as a
// `<style data-plugin data-plugin-css>` tag (the same tag shape the shipped
// bundles use, so HMR can claim and remove it), and the canvas reads the colour
// tokens through `getComputedStyle` rather than hard-coding them.
//
// Every colour is a `--dsw-alias-*` theme token with a light-theme fallback, so
// the surfaces stay readable under the dark theme instead of pinning one palette.
// Class names are suffixed `-tfc` to keep them out of the shell's namespace.

export const STYLE_TAG_ID = '@local/team-flowise-client/styles.css'

export const CSS = [
  '.tfc-root{--tfc-gap:10px;--tfc-radius:10px;font-family:var(--dsw-font-family,var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif));color:var(--dsw-alias-label-primary,#0f1115);font-size:13px;line-height:20px;display:flex;flex-direction:column;gap:var(--tfc-gap);min-width:0}',
  '.tfc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.tfc-row-between{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
  '.tfc-col{display:flex;flex-direction:column;gap:8px;min-width:0}',
  '.tfc-grow{flex:1;min-width:0}',
  '.tfc-muted{color:var(--dsw-alias-label-tertiary,#81858c)}',
  '.tfc-dim{color:var(--dsw-alias-label-dimmed,#a8adb4)}',
  '.tfc-title{font-size:15px;line-height:24px;font-weight:600;margin:0}',
  '.tfc-subtitle{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b);margin:0}',
  '.tfc-caption{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#8b9098)}',
  '.tfc-card{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));border-radius:var(--tfc-radius);padding:12px;min-width:0}',
  '.tfc-card-l2{background:var(--dsw-alias-bg-layer-2,#f6f7f8)}',
  '.tfc-btn{font:inherit;font-size:12px;line-height:18px;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;white-space:nowrap}',
  '.tfc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%))}',
  '.tfc-btn:disabled{opacity:.5;cursor:default}',
  '.tfc-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#0f1115));border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}',
  '.tfc-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#33373d)}',
  '.tfc-btn-danger{color:var(--dsw-alias-state-error-primary,#d92d20);border-color:var(--dsw-alias-border-l2,rgb(0 0 0 / 16%))}',
  '.tfc-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgb(217 45 32 / 8%))}',
  '.tfc-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#61666b)}',
  '.tfc-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%));color:var(--dsw-alias-label-primary,#0f1115)}',
  '.tfc-btn-icon{padding:3px 7px;font-size:13px;line-height:18px}',
  '.tfc-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));padding-bottom:6px}',
  '.tfc-tab{font:inherit;font-size:12px;line-height:18px;padding:4px 12px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer}',
  '.tfc-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%))}',
  '.tfc-tab-active{background:var(--dsw-alias-interactive-bg-active,rgb(0 0 0 / 7%));color:var(--dsw-alias-label-primary,#0f1115);font-weight:600}',
  '.tfc-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
  '.tfc-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#61666b)}',
  '.tfc-input,.tfc-textarea,.tfc-select{font:inherit;font-size:12px;line-height:18px;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);width:100%;box-sizing:border-box}',
  '.tfc-textarea{min-height:66px;resize:vertical;font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,Consolas,monospace);line-height:18px}',
  '.tfc-input:focus,.tfc-textarea:focus,.tfc-select:focus{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-1px}',
  '.tfc-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:16px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));white-space:nowrap;color:var(--dsw-alias-label-secondary,#61666b)}',
  '.tfc-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}',
  '.tfc-chip{display:inline-flex;align-items:center;font-size:11px;line-height:16px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,rgb(0 0 0 / 6%));color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}',
  '.tfc-list{display:flex;flex-direction:column;gap:6px;min-width:0}',
  '.tfc-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--tfc-radius);border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));background:var(--dsw-alias-bg-layer-1,#fff);min-width:0}',
  '.tfc-item:hover{border-color:var(--dsw-alias-border-l3,rgb(0 0 0 / 22%))}',
  '.tfc-item-selectable{cursor:pointer}',
  '.tfc-item-on{border-color:var(--dsw-alias-brand-primary,#0f1115)}',
  '.tfc-item-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
  '.tfc-item-title{font-size:12px;line-height:18px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tfc-item-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#81858c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tfc-empty{padding:14px;border:1px dashed var(--dsw-alias-border-l2,rgb(0 0 0 / 16%));border-radius:var(--tfc-radius);color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;text-align:center}',
  '.tfc-error{padding:8px 10px;border-radius:var(--tfc-radius);border:1px solid var(--dsw-alias-state-error-primary,#d92d20);color:var(--dsw-alias-state-error-primary,#d92d20);font-size:12px;white-space:pre-wrap;word-break:break-word}',
  '.tfc-notice{padding:8px 10px;border-radius:var(--tfc-radius);border:1px solid var(--dsw-alias-state-success-primary,#067647);color:var(--dsw-alias-state-success-primary,#067647);font-size:12px}',
  '.tfc-warn{padding:8px 10px;border-radius:var(--tfc-radius);border:1px solid var(--dsw-alias-state-warn-primary,#b54708);color:var(--dsw-alias-state-warn-label,#b54708);font-size:12px}',
  '.tfc-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgb(0 0 0 / 8%));overflow:hidden;width:100%}',
  '.tfc-bar-fill{height:100%;background:var(--dsw-alias-state-business-primary,#175cd3);border-radius:999px}',
  '.tfc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px}',
  '.tfc-stat{padding:10px;border-radius:var(--tfc-radius);background:var(--dsw-alias-bg-layer-2,#f6f7f8);display:flex;flex-direction:column;gap:2px}',
  '.tfc-stat-value{font-size:20px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums}',
  '.tfc-stat-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#61666b)}',
  '.tfc-board{display:flex;gap:10px;align-items:flex-start;overflow-x:auto;padding-bottom:6px}',
  '.tfc-col-item{min-width:196px;flex:0 0 196px;background:var(--dsw-alias-bg-layer-2,#f6f7f8);border-radius:var(--tfc-radius);padding:8px;display:flex;flex-direction:column;gap:6px}',
  '.tfc-col-head{display:flex;align-items:center;justify-content:space-between;gap:6px}',
  '.tfc-col-title{font-size:11px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#61666b)}',
  '.tfc-mini{font-size:12px;line-height:18px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));cursor:pointer;display:flex;flex-direction:column;gap:3px}',
  '.tfc-modal{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,rgb(0 0 0 / 40%));display:flex;align-items:center;justify-content:center;z-index:60;padding:16px}',
  '.tfc-modal-card{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);border-radius:14px;padding:16px;width:min(560px,100%);max-height:82vh;overflow:auto;box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgb(0 0 0 / 24%));display:flex;flex-direction:column;gap:10px}',
  '.tfc-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}',
  '.tfc-modal-title{font-size:14px;line-height:22px;font-weight:600;margin:0}',
  '.tfc-panel{position:absolute;top:calc(100% + 6px);right:0;width:336px;max-width:min(400px,100vw - 32px);max-height:min(460px,100vh - 160px);overflow:auto;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#0f1115);border-radius:16px;box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgb(0 0 0 / 24%));padding:8px;display:flex;flex-direction:column;gap:6px;z-index:50}',
  '.tfc-trigger{position:relative;display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;line-height:18px;min-height:28px;padding:3px 4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}',
  '.tfc-trigger:hover{color:var(--dsw-alias-label-secondary,#61666b);background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%))}',
  '.tfc-trigger-on{color:var(--dsw-alias-label-primary,#0f1115)}',
  '.tfc-panel-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:12px;line-height:18px}',
  '.tfc-panel-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%))}',
  '.tfc-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px}',
  '.tfc-canvas-wrap{position:relative;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));border-radius:var(--tfc-radius);background:var(--dsw-alias-bg-layer-1,#fff)}',
  '.tfc-canvas{display:block;width:100%}',
  '.tfc-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary,#61666b)}',
  '.tfc-legend-item{display:inline-flex;align-items:center;gap:5px}',
  '.tfc-swatch{width:10px;height:10px;border-radius:3px;border:1px solid var(--dsw-alias-border-l2,rgb(0 0 0 / 16%))}',
  '.tfc-node-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(212px,1fr));gap:8px}',
  '.tfc-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px;min-width:0}',
  '.tfc-kv-key{color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap}',
  '.tfc-kv-val{min-width:0;word-break:break-word}',
  '.tfc-pre{margin:0;padding:8px;border-radius:8px;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2,#f6f7f8));color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,Consolas,monospace);font-size:11px;line-height:17px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word}',
  '.tfc-spin{animation:tfc-spin 1s linear infinite;display:inline-block}',
  '@keyframes tfc-spin{to{transform:rotate(360deg)}}',
  '.tfc-code{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,Consolas,monospace);font-size:11px}',
].join('\n')

/**
 * Inject the stylesheet once, tagged for the client module system to claim.
 *
 * @param doc - a `Document`; pass `undefined` on a non-DOM platform to no-op.
 * @returns a disposer removing the tag this call created, or a no-op disposer.
 */
export function injectStyles(doc) {
  const target = doc === undefined ? (typeof document === 'undefined' ? undefined : document) : doc
  if (target === undefined || target === null || typeof target.createElement !== 'function') return () => {}
  const existing = target.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_TAG_ID) + ']')
  if (existing !== null) return () => {}
  const tag = target.createElement('style')
  tag.setAttribute('data-plugin', '@local/team-flowise-client')
  tag.setAttribute('data-plugin-css', STYLE_TAG_ID)
  tag.textContent = CSS
  target.head.appendChild(tag)
  return () => {
    if (tag.parentNode !== null && tag.parentNode !== undefined) tag.parentNode.removeChild(tag)
  }
}
