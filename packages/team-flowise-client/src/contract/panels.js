// Environment-independent descriptors for the three surfaces this package
// contributes. Both halves read this: the browser half registers the slots, and
// the Node half exports the same table so the contribution is inspectable (and
// testable) without a browser.

/** Slot kind as declared by the owning shell package. */
export const SLOT_KINDS = {
  /** One full page per entry, rendered by the settings shell's content column. */
  settingsSection: 'list',
  /** Ascending row of actions beside the per-Session title. */
  sessionHeaderActions: 'list',
}

/** The Settings page contribution. */
export const SETTINGS_SECTION = {
  slot: 'settings.section',
  kind: SLOT_KINDS.settingsSection,
  id: 'team-flowise',
  order: 500,
  label: '多 Agent 团队',
}

/**
 * The session-header contribution.
 *
 * `order` keeps it after the shipped job list (20) and schedule catalog, and
 * before nothing — collisions are resolved by id, and this id is ours.
 */
export const SESSION_HEADER_ACTION = {
  slot: 'conversation.session.header.actions',
  kind: SLOT_KINDS.sessionHeaderActions,
  id: 'team-flowise-activity',
  order: 60,
  label: '团队活动',
}

/** Both contributions, in registration order. */
export const CONTRIBUTIONS = [SETTINGS_SECTION, SESSION_HEADER_ACTION]

/** Locale namespace this package registers dictionaries under. */
export const LOCALE_NAMESPACE = 'team-flowise'
