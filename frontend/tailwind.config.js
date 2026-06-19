/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Syne: display/UI — tensão entre warmth e precisão técnica
        sans: ['Syne', 'system-ui', 'sans-serif'],
        // IBM Plex Mono: valores numéricos — semântico, não decorativo
        mono: ['IBM Plex Mono', 'monospace'],
      },
      colors: {
        // Sistema de 3 papéis + 1 accent
        canvas:  '#0C0B09', // background — quente, não cinza neutro
        surface: '#171512', // surface/card
        muted:   '#2A2721', // border, divisor
        fg:      '#F5F0E8', // foreground — branco quente, não puro
        dim:     '#857D74', // texto secundário
        faint:   '#4A4540', // texto terciário / placeholders
        // Accent: latão — cultura material de estúdio, não SaaS genérico
        brass: {
          DEFAULT: '#C8A96E',
          dim:     '#8A7249',
          faint:   '#3D3020',
        },
        // Estados funcionais
        ok:   '#4ADE80',
        warn: '#FBBF24',
        bad:  '#F87171',
      },
      fontSize: {
        // Escala com ratio 1.414 (√2), base 16px
        xs:   ['11.3px', { lineHeight: '1.5' }],
        sm:   ['13px',   { lineHeight: '1.5' }],
        base: ['16px',   { lineHeight: '1.6' }],
        lg:   ['22.6px', { lineHeight: '1.3' }],
        xl:   ['32px',   { lineHeight: '1.2' }],
        '2xl':['45.3px', { lineHeight: '1.1' }],
      },
      spacing: {
        // Sistema 4pt: 4, 8, 12, 16, 24, 32, 48, 64, 96
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
        16: '64px',
        24: '96px',
      },
    },
  },
  plugins: [],
}
