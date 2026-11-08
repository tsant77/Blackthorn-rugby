import type { Config } from "tailwindcss";
import { brand, charcoal, functional } from "./src/design/tokens";

/**
 * Tailwind v4 still loads this file through `@config` in src/styles/tokens.css.
 * shadcn semantic colors are the CSS variables in that stylesheet.
 * Product screens use the named spacing scale below (8px base, 4px micro step).
 */
export default {
  theme: {
    extend: {
      colors: {
        forest: brand.forest,
        sage: brand.sage,
        "sage-deep": brand.sageDeep,
        pitch: brand.pitch,
        leaf: brand.leaf,
        gold: brand.gold,
        "gold-soft": brand.goldSoft,
        canvas: charcoal.canvas,
        raised: charcoal.raised,
        overlay: charcoal.overlay,
        line: charcoal.line,
        ink: charcoal.ink,
        quiet: charcoal.muted,
        faint: charcoal.faint,
        danger: functional.danger,
      },
      spacing: {
        half: "4px",
        s1: "8px",
        s2: "16px",
        s3: "24px",
        s4: "32px",
        s5: "40px",
        s6: "48px",
        s8: "64px",
        s10: "80px",
        s12: "96px",
      },
      fontFamily: {
        display: ["Barlow Condensed", "Arial Narrow", "sans-serif"],
        heading: ["Nunito Sans", "Avenir Next", "Century Gothic", "sans-serif"],
        body: ["Lato", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "16px",
      },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.35)",
      },
    },
  },
} satisfies Config;
