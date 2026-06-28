import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Plex-ish amber accent on a dark slate base (Sonarr/Radarr-style chrome).
        brand: {
          DEFAULT: '#e5a00d',
          light: '#f5c542',
          dark: '#b9810a',
        },
        // Semantic surfaces, darkest → lightest.
        app: '#0b1120', // page background
        rail: '#0f172a', // left nav + top bar
        panel: '#131c2e', // cards / raised surfaces
      },
    },
  },
  plugins: [],
};

export default config;
