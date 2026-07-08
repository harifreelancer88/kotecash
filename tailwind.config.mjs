import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx,vue}', './public/**/*.js'],
  theme: {
    extend: {
      colors: {
        'c-bg': 'var(--c-bg)',
        'c-surface': 'var(--c-surface)',
        'c-card': 'var(--c-card)',
        'c-primary': 'var(--c-primary)',
        'c-focus': 'var(--c-focus)',
        'c-accent': 'var(--c-accent)',
        'c-success': 'var(--c-success)',
        'c-danger': 'var(--c-danger)',
        'c-warning': 'var(--c-warning)',
        'c-ink': 'var(--c-ink)',
        'c-sub': 'var(--c-sub)',
        'c-border': 'var(--c-border)',
      },
      borderRadius: {
        'custom': 'var(--radius)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      }
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        light: {
          "primary": "#355872",
          "secondary": "#7AAACE",
          "accent": "#9CD5FF",
          "neutral": "#6B7D8E",
          "base-100": "#F7F8F0",
          "info": "#7AAACE",
          "success": "#4A8C6F",
          "warning": "#D4A24E",
          "error": "#C44B4B",
        },
      },
    ],
  },
}
