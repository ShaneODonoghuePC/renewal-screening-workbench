import { redirect } from 'next/navigation'

// Team View moved to the root route ("/") and is now the app's landing page.
// Kept as a redirect so old bookmarks/links to /team still land somewhere useful.
export default function TeamRedirect({ searchParams }: { searchParams: { month?: string } }) {
  const query = searchParams.month ? `?month=${searchParams.month}` : ''
  redirect(`/${query}`)
}
