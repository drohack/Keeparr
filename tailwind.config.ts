import type { Config } from 'tailwindcss';

/**
 * THEMING: every color family the UI actually uses is defined as a CSS
 * variable (`--c-*`, space-separated RGB channels) so the Auto/Light/Dark
 * themes and the color-impaired mode can restyle the whole app from
 * app/globals.css alone - components keep their normal `text-slate-400`-style
 * classes and never need `dark:` variants. When you introduce a NEW
 * color+shade, add its variable to every theme block in globals.css.
 */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;
const ladder = (family: string, shades: number[]) =>
  Object.fromEntries(shades.map((s) => [s, v(`${family}-${s}`)]));

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Plex-ish amber accent on a slate base (Sonarr/Radarr-style chrome).
        brand: {
          DEFAULT: v('brand'),
          light: v('brand-light'),
          dark: v('brand-dark'),
        },
        // Semantic surfaces.
        app: v('app'), // page background
        rail: v('rail'), // left nav + top bar
        panel: v('panel'), // cards / raised surfaces
        // NOT themed: fixed dark ink for text sitting on brand-amber
        // (buttons/badges/logo) - must stay dark in both themes.
        ink: '#0f172a',
        // NOT themed: fixed true white for text on saturated badges over
        // posters (theme-independent surfaces).
        paper: '#ffffff',
        // `white` is "maximum-contrast foreground": true white on dark,
        // near-black on light (hover:text-white etc. keep working).
        white: v('white'),
        // Only the shades in use are themed; other shades fall back to
        // Tailwind defaults (extend merges per-shade).
        slate: ladder('slate', [200, 300, 400, 500, 600, 700, 800, 900, 950]),
        amber: ladder('amber', [200, 300, 400, 500, 700, 900]),
        blue: ladder('blue', [400, 500]),
        emerald: ladder('emerald', [400, 500]),
        red: ladder('red', [300, 400, 500, 950]),
        rose: ladder('rose', [100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        sky: ladder('sky', [600]),
        // Categorical "by library" palette (breakdown.tsx LIB_BAR/LIB_STROKE).
        violet: ladder('violet', [300, 400, 500, 700]),
        teal: ladder('teal', [300, 400, 500, 600]),
      },
    },
  },
  plugins: [],
};

export default config;
