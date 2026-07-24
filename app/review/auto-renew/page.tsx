import { redirect } from 'next/navigation'

// RPUX Auto-Renew is now a Routing filter option on the unified Renewal Management
// list at "/" instead of its own page -- redirect rather than 404 in case this URL is
// bookmarked anywhere.
export default function AutoRenewLogPage() {
  redirect('/')
}
