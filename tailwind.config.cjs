module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#122933',
          dark: '#1c3a49',
        },
        // Lightened further toward white from the raw rpgroup.com sample
        // (rgb(217, 219, 203)) -- on the real site that tone only ever fills a
        // contained accent block against white, never the whole page, so a ~45%
        // mix toward white here keeps it a soft tint rather than a solid wash.
        putty: '#eceee5',
        // rpgroup.com's sage/olive accent (sampled from the rgba(161, 166, 124, 0.3)
        // image-overlay tint used across rpgroup.com) -- reserved for small-footprint
        // accents (a card tint, a divider), never a full-page background.
        sage: {
          50: '#f5f6ef',
          100: '#eceee0',
          200: '#dcdfc9',
          300: '#cbcfae',
          400: '#b3b899',
          500: '#a1a67c',
          600: '#8b9066',
          700: '#6b6f4f',
          800: '#4d5039',
          900: '#33351f',
        },
      },
      fontFamily: {
        sans: ['var(--font-montserrat)', 'Montserrat', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
