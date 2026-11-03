/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        'court-navy': '#00326A',
        'navy-ink': '#001F42',
        'ball-yellow': '#FBC101',
        cream: '#FCF9EF',
        danger: '#C62828'
      },
      fontSize: {
        caption: ['12px', { lineHeight: '1.4' }]
      },
      borderRadius: {
        DEFAULT: '10px'
      }
    }
  },
  plugins: []
}
