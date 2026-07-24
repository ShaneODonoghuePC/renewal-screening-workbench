'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import RiskQualityPanel from '@/components/RiskQualityPanel'

export default function ManualReviewDetailPage() {
  const params = useParams<{ id: string }>()
  const policyId = decodeURIComponent(params.id)

  return (
    <div className="space-y-6">
      {/* No page-level title here -- RiskQualityPanel renders its own "Risk Assessment"
          header (title + rating-explanation subtext inline together). */}
      <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">&larr; Back to Renewal Management</Link>
      <RiskQualityPanel policyId={policyId} />
    </div>
  )
}
