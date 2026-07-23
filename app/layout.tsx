import Image from 'next/image'
import { Montserrat } from 'next/font/google'
import './globals.css'
import ActingAsPicker from '@/components/ActingAsPicker'
import HeaderNav from '@/components/HeaderNav'
import SettingsMenu from '@/components/SettingsMenu'

const montserrat = Montserrat({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-montserrat', display: 'swap' })

export const metadata = {
  title: 'Renewal Screening Workbench',
  description: 'Internal underwriting workbench for screening and reviewing policy renewals.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body className="bg-putty font-sans text-slate-900">
        {/* Header stays white/light per rpgroup.com's actual nav -- navy is used as an
            accent (text, underline, CTAs) rather than a filled navy bar. */}
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3">
          <Image src="/logo.png" alt="RiskPoint" width={138} height={28} priority className="h-7 w-auto" />
          <div className="flex items-center gap-6">
            <HeaderNav />
            <div className="flex items-center gap-3 border-l border-slate-200 pl-6">
              <ActingAsPicker />
              <SettingsMenu />
            </div>
          </div>
        </header>
        {/* Small-footprint sage divider under the header -- the accent's only other
            appearance besides the best-grade card tint in RiskQualityPanel. */}
        <div className="h-1 bg-sage-500" aria-hidden="true" />
        <main className="p-4">{children}</main>
        <footer className="border-t border-slate-200 px-4 py-2.5 text-center text-xs text-slate-500">
          This is a demo application. Data and figures are illustrative.
        </footer>
      </body>
    </html>
  )
}
