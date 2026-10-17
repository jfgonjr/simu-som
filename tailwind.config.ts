import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#050505',
        coal: '#141210',
        sand: { DEFAULT: '#d6c3a1', dim: '#8f8269', deep: '#4a4234' },
        brass: '#b08a4a',
      },
      fontFamily: {
        brand: ['var(--font-brand)', 'Georgia', 'serif'],
        ui: ['var(--font-ui)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
