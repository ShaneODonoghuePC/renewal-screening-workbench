import './globals.css'
import ActingAsPicker from '@/components/ActingAsPicker'
import BrandingStrip from '@/components/BrandingStrip'
import HeaderNav from '@/components/HeaderNav'

export const metadata = {
  title: 'Renewal Screening Workbench',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{padding:'12px 16px',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <h1 className="text-xl font-bold tracking-wide text-[#122933]">Renewal Screening Workbench</h1>
          <div className="flex items-center gap-4">
            <HeaderNav />
            <ActingAsPicker />
          </div>
        </header>
        <main style={{padding:'16px',paddingRight:'100px'}}>{children}</main>
        <footer style={{padding:'10px 16px',borderTop:'1px solid #eee',textAlign:'center',fontSize:'12px',color:'#64748b'}}>
          This is a demo application. Data and figures are illustrative.
        </footer>
        <BrandingStrip />
      </body>
    </html>
  )
}
