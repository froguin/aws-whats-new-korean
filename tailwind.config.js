/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        'aws-gray': {
          100: '#fafafa',
          200: '#f2f3f3',
          300: '#e9eaea',
          400: '#d1d5db',
          500: '#9ba7b6',
          600: '#414d5c',
          700: '#1a2634',
          800: '#0f1b2a',
        },
        'aws-blue': {
          100: '#f3f8ff',
          500: '#0972d3',
          600: '#033160',
        },
        'aws-orange': {
          500: '#ec7211',
        }
      },
    },
    fontFamily: {
      sans: ['Amazon Ember', "Noto Sans KR", 'sans-serif'],
    }
  },
  plugins: [],
}

