import { redirect } from 'next/navigation'

// Closed Items is now a Status filter bucket ("Closed") on the unified Renewal
// Management list at "/" instead of its own page -- redirect rather than 404 in case
// this URL is bookmarked anywhere.
export default function HistoryPage() {
  redirect('/')
}
