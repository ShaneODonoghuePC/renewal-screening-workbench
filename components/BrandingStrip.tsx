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
// under the 3:1 minimum for graphical objects) — darkened for the line segments specifically
// (Tailwind token: sage-line).

function Line() {
  return <div className="h-8 w-0.5 bg-sage-line" />
}

function Lockup({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      {PINWHEEL_MARK}
      {/* Tailwind has no writing-mode utility, so that one property stays inline. */}
      <span
        style={{ writingMode: 'vertical-rl' }}
        className="whitespace-nowrap text-[1.0625rem] font-semibold lowercase tracking-[2px] text-brand"
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
      className="pointer-events-none fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center px-4"
    >
      <Line />
      <Lockup text="riskwatch" />
      <Line />
      <div className="h-6" />
      <Lockup text="rw underwriting" />
      <Line />
    </div>
  )
}
