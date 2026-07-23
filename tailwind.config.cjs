module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#122933',
          dark: '#1c3a49',
        },
        // rpgroup.com's actual warm putty/cream section background (sampled from
        // rgb(217, 219, 203) on rpgroup.com/our-company/'s "Our History" section).
        putty: '#d9dbcb',
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
