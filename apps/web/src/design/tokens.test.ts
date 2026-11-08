import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spacingPx, tokenHexes } from "./tokens";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles/tokens.css"),
  "utf8",
);
const tailwind = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../tailwind.config.ts"),
  "utf8",
);

describe("design tokens", () => {
  it("keeps every brand, charcoal, and functional hex in the stylesheet", () => {
    const normalized = css.toLowerCase();
    for (const hex of tokenHexes) {
      expect(normalized).toContain(hex.toLowerCase());
    }
  });

  it("maps the 8-point spacing names in the Tailwind config", () => {
    for (const name of ["half", "s1", "s2", "s3", "s4", "s5", "s6", "s8", "s10", "s12"]) {
      expect(tailwind).toContain(`${name}:`);
    }
    expect(spacingPx.xs).toBe(8);
    expect(spacingPx.sm).toBe(16);
    expect(spacingPx.md).toBe(24);
  });
});
