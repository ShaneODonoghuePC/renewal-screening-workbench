'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import ManualReviewWorkspace from '@/components/ManualReviewWorkspace'

export default function ManualReviewDetailPage() {
  const params = useParams<{ id: string }>()
  const policyId = decodeURIComponent(params.id)

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">&larr; Back to Assignment & Management</Link>
      <ManualReviewWorkspace policyId={policyId} />
    </div>
  )
}
