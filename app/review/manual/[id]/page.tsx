'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import RiskQualityPanel from '@/components/RiskQualityPanel'

export default function ManualReviewDetailPage() {
  const params = useParams<{ id: string }>()
  const policyId = decodeURIComponent(params.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">&larr; Back to Assignment & Management</Link>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Risk Quality & Recommendation</h2>
      </div>
      <RiskQualityPanel policyId={policyId} />
    </div>
  )
}
