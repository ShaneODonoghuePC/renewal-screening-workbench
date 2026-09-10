// Shared UI tokens with more than one call site -- pulled out specifically so a
// value like a width class has exactly one definition, not two copies that drift
// apart the next time either one is tweaked.

// One width for every Renewal Management filter control (originally app/page.tsx,
// 2026-09-09) -- wide enough for the longest closed-state label across all of them
// (a full broker name, "Descending ↓", a MultiSelectDropdown's "Label (N)" state)
// without looking oversized on the short ones. Reused by UnderwriterWorkspace's
// Status/Assigned to selects (2026-09-15) so the two surfaces' filter-style controls
// stay visually consistent without a second, independent width decision.
export const FILTER_WIDTH = 'w-44'
