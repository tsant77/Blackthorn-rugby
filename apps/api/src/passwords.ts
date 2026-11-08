import { scrypt, timingSafeEqual } from "node:crypto";
import { randomToken } from "./tokens";

// OWASP scrypt alternative: N=2^15, r=8, p=3 (~32 MiB).
// Versioned encoding allows future work-factor upgrades without losing accounts.
const N = 32768;
const R = 8;
const P = 3;
const DUMMY = `scrypt$1$${N}$${R}$${P}$dummy-verification-salt$0000000000000000000000000000000000000000000000000000000000000000`;

function derive(password: string, salt: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{2,29}$/.test(username) ? username : null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomToken();
  const hash = await derive(password, salt);
  return `scrypt$1$${N}$${R}$${P}$${salt}$${hex(hash)}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const parts = (encoded ?? DUMMY).split("$");
  const supported = parts.length === 7 && parts[0] === "scrypt" && parts[1] === "1"
    && Number(parts[2]) === N && Number(parts[3]) === R && Number(parts[4]) === P
    && /^[a-f0-9]{64}$/.test(parts[6] ?? "");
  const selected = supported ? parts : DUMMY.split("$");
  const actual = await derive(password, selected[5]!);
  const expected = Uint8Array.from(selected[6]!.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  const matches = timingSafeEqual(actual, expected);
  return encoded !== null && supported && matches;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
