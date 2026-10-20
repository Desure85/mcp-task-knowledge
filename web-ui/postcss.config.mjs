/**
 * web-ui/postcss.config.mjs — Tailwind CSS v4 pipeline.
 *
 * The whole web-ui JSX is written with Tailwind utility classes, but the
 * package was missing both the Tailwind dependency and this PostCSS hook,
 * so every class was inert and pages rendered as bare HTML.
 */

const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
