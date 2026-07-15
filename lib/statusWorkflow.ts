// Manual Review status workflow (§6). Shared by the API route (enforcement) and the
// detail page (status control options) so both read from the same graph, not two copies.
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  New: ['In Review'],
  'In Review': ['Renewed', 'Not Renewed', 'Escalated'],
  Renewed: ['Closed'],
  'Not Renewed': ['Closed'],
  // Escalated (confirmed 2026-07-15): a second opinion still needs somewhere to land the
  // actual decision, not just a status-less Closed. Resolves to Renewed/Not Renewed (each
  // still requiring its own Closed step), or goes straight to Closed when it doesn't
  // resolve to a clean decision.
  Escalated: ['Renewed', 'Not Renewed', 'Closed'],
  Closed: [],
}

// Navins Renew's separate, much simpler workflow (§6): Pending -> Done, that's it.
export const NAVINS_STATUS_TRANSITIONS: Record<string, string[]> = {
  Pending: ['Done'],
  Done: [],
}

// A policy is on one graph or the other depending on its routing — never both — so the
// caller must say which routing it's validating for.
export function isValidStatusTransition(routing: string | null | undefined, from: string, to: string): boolean {
  if (from === to) return true
  const graph = routing === 'NAVINS Renew' ? NAVINS_STATUS_TRANSITIONS : STATUS_TRANSITIONS
  return (graph[from] ?? []).includes(to)
}
