// Manual Review status workflow (Phase 2A). Renewed/Not Renewed are themselves
// terminal now -- there's no separate Closed step; reaching either moves the item
// straight to Closed Items. Shared by the API route (enforcement) and the Underwriter
// Workspace (status control options) so both read from the same graph, not two copies.
export const MANUAL_REVIEW_TRANSITIONS: Record<string, string[]> = {
  'Not Started': ['In Review'],
  'In Review': ['With Broker', 'Renewed', 'Not Renewed'],
  'With Broker': ['Renewed', 'Not Renewed'],
  Renewed: [],
  'Not Renewed': [],
}

// Navins Renew's workflow (Phase 2A, replacing the old Pending/Done pair): a
// quote-to-bind flow with three terminal outcomes.
export const NAVINS_RENEW_TRANSITIONS: Record<string, string[]> = {
  'Not Started': ['Quote Sent'],
  'Quote Sent': ['Quote Declined', 'Policy Sent'],
  'Policy Sent': ['Renewed', 'Not Renewed'],
  'Quote Declined': [],
  Renewed: [],
  'Not Renewed': [],
}

export const MANUAL_REVIEW_TERMINAL_STATUSES = new Set(['Renewed', 'Not Renewed'])
export const NAVINS_RENEW_TERMINAL_STATUSES = new Set(['Quote Declined', 'Renewed', 'Not Renewed'])

function graphFor(routing: string | null | undefined) {
  return routing === 'NAVINS Renew' ? NAVINS_RENEW_TRANSITIONS : MANUAL_REVIEW_TRANSITIONS
}

export function isTerminalStatus(routing: string | null | undefined, status: string | null | undefined): boolean {
  if (!status) return false
  const terminalSet = routing === 'NAVINS Renew' ? NAVINS_RENEW_TERMINAL_STATUSES : MANUAL_REVIEW_TERMINAL_STATUSES
  return terminalSet.has(status)
}

// A policy is on one graph or the other depending on its routing — never both — so the
// caller must say which routing it's validating for.
export function isValidStatusTransition(routing: string | null | undefined, from: string, to: string): boolean {
  if (from === to) return true
  return (graphFor(routing)[from] ?? []).includes(to)
}
