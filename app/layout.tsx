import { Inter } from 'next/font/google'
import './globals.css'
import ActingAsPicker from '@/components/ActingAsPicker'
import HeaderNav from '@/components/HeaderNav'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export const metadata = {
  title: 'Renewal Screening Workbench',
  description: 'Internal underwriting workbench for screening and reviewing policy renewals.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h1 className="text-xl font-bold tracking-wide text-brand">Renewal Screening Workbench</h1>
          <div className="flex items-center gap-4">
            <HeaderNav />
            <ActingAsPicker />
          </div>
        </header>
        <main className="p-4">{children}</main>
        <footer className="border-t border-slate-200 px-4 py-2.5 text-center text-xs text-slate-500">
          This is a demo application. Data and figures are illustrative.
        </footer>
      </body>
    </html>
  )
}
