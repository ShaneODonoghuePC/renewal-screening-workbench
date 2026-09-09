# Working in this repo

This is the Renewal Screening Workbench prototype. SPEC.md is the
specification of record. Read it before making changes.

## Keep SPEC.md true

Any change that alters behaviour, naming, status vocabulary or the data model
updates SPEC.md in the same commit. A commit that changes what the app does
without changing what SPEC.md says is incomplete. Do not defer it to a
follow-up commit — that is the commit that gets skipped.

When you finish a piece of work, check whether SPEC.md still describes the app
as a whole, not only the sections you touched. Report anything you find stale
even if it is outside your current task; do not silently fix it.

This is enforced by CI on every push to main (`.github/workflows/spec-sync.yml`).
A commit that changes `app/`, `components/`, `lib/`, `scripts/`, `data/`,
`tailwind.config.cjs` or `next.config.mjs` must also change SPEC.md, or the
push fails. `[no-spec]` in the commit message is the escape hatch — for
commits that genuinely cannot affect the spec (dependency bumps, formatting,
comment typos) — not a way to avoid updating the spec.

## Verify against the running system

Code that reads correctly is not evidence. Confirm the deployed app behaves
differently.

Before drawing any conclusion from production, confirm you are looking at a
genuinely fresh deploy — check for Age: 0 and X-Vercel-Cache: PRERENDER or
MISS. Elapsed time since push is not evidence. Do not rapid-poll the
production URL; that has tripped Vercel's bot protection and blocked
verification for several minutes.

Where a figure is displayed, verify it by recomputing it independently of the
page's own code, not by re-reading the same code path.

## Production data

.env.local holds the production Turso credentials, and `next dev` auto-loads
it, so local development reads and writes the real production database with no
visual indicator. Assume this is the case unless you have checked otherwise.

Anything that mutates data runs read-only first and reports exactly what it
would change. The dry-run step and the apply step are separate scripts, and
both are committed as the audit trail. Snapshot before applying to production,
which has no reseed path.

## Credentials

Never print credentials, tokens or env var values in your output, and never
ask for them to be pasted into chat. Read them from .env.local, or have them
set in the Vercel or Turso UI directly.
