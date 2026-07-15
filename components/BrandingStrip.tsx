// Fictional placeholder branding (not the real RiskPoint brand): this build is a
// public demo deploy, so no real brand assets appear anywhere in the app.

const PINWHEEL_MARK = (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L13 9L12 12L11 9Z" fill="#122933" />
    <path d="M12 2L13 9L12 12L11 9Z" fill="#A1A67C" transform="rotate(45 12 12)" />
    <path d="M12 2L13 9L12 12L11 9Z" fill="#122933" transform="rotate(90 12 12)" />
    <path d="M12 2L13 9L12 12L11 9Z" fill="#A1A67C" transform="rotate(135 12 12)" />
    <path d="M12 2L13 9L12 12L11 9Z" fill="#122933" transform="rotate(180 12 12)" />
    <path d="M12 2L13 9L12 12L11 9Z" fill="#A1A67C" transform="rotate(225 12 12)" />
    <path d="M12 2L13 9L12 12L11 9Z" fill="#122933" transform="rotate(270 12 12)" />
    <path d="M12 2L13 9L12 12L11 9Z" fill="#A1A67C" transform="rotate(315 12 12)" />
  </svg>
)

// #A1A67C alone reads washed out against a white page background (contrast ratio ~2.5:1,
// under the 3:1 minimum for graphical objects) — darkened for the line segments specifically.
const LINE_COLOR = '#71754F'

function Line() {
  return <div style={{ width: '2px', height: '32px', background: LINE_COLOR }} />
}

function Lockup({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
      {PINWHEEL_MARK}
      <span
        style={{
          writingMode: 'vertical-rl',
          color: '#122933',
          letterSpacing: '2px',
          fontSize: '17px',
          fontWeight: 600,
          textTransform: 'lowercase',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
    </div>
  )
}

export default function BrandingStrip() {
  return (
    <div
      data-testid="branding-strip"
      style={{
        position: 'fixed',
        top: '50%',
        right: 0,
        transform: 'translateY(-50%)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '0 16px',
        pointerEvents: 'none',
      }}
    >
      <Line />
      <Lockup text="riskwatch" />
      <Line />
      <div style={{ height: '24px' }} />
      <Lockup text="rw underwriting" />
      <Line />
    </div>
  )
}
