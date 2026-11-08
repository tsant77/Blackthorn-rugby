/**
 * Canonical color and spacing values.
 * Hex values are copied into src/styles/tokens.css; the unit test keeps them in sync.
 * Club colors come from the Wix theme on https://www.blackthornrugbyclub.com.
 * Charcoal and danger are product colors for the dark performance UI.
 */
export const brand = {
  forest: "#223017",
  sage: "#C5DAB5",
  sageDeep: "#9BB687",
  pitch: "#679146",
  leaf: "#45612F",
  gold: "#F2B10B",
  goldSoft: "#FBE4AB",
} as const;

export const charcoal = {
  canvas: "#121410",
  raised: "#1B1E19",
  overlay: "#242820",
  line: "#31362C",
  ink: "#F4F6F1",
  muted: "#A8AD9F",
  faint: "#8E9486",
} as const;

export const functional = {
  danger: "#A33B32",
} as const;

/**
 * 8-point scale in pixels.
 * Tailwind utilities are `half` (4) and `s1`–`s12` (8 and up). See DESIGN_SYSTEM.md.
 */
export const spacingPx = {
  micro: 4,
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
  xxl: 48,
  xxxl: 64,
  huge: 80,
  max: 96,
} as const;

export const tokenHexes = [...Object.values(brand), ...Object.values(charcoal), ...Object.values(functional)];
