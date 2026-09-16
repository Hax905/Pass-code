import { randomInt } from "node:crypto";

// Character classes. Look-alike characters (I l 1 O 0 o) are left out by default
// because people type Wi-Fi passwords by hand. Symbols are limited to ones that
// routers and device keyboards handle reliably (no quotes, backslash or space).
const CHARACTER_CLASSES = {
  lowercase: { all: "abcdefghijklmnopqrstuvwxyz", unambiguous: "abcdefghijkmnpqrstuvwxyz" },
  uppercase: { all: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", unambiguous: "ABCDEFGHJKLMNPQRSTUVWXYZ" },
  digits: { all: "0123456789", unambiguous: "23456789" },
  symbols: { all: "!#$%&*+-=?@^_~", unambiguous: "!#$%&*+-=?@^_~" },
} as const;

type CharacterClass = keyof typeof CHARACTER_CLASSES;

// WPA2/WPA3-Personal passphrases are 8–63 characters; 12 is our own floor.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 63;
export const DEFAULT_PASSWORD_LENGTH = 20;

export interface PasswordOptions {
  length?: number;
  lowercase?: boolean;
  uppercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
}

/**
 * Generates a password from a CSPRNG. Every enabled character class appears at
 * least once; positions are shuffled so they aren't predictable.
 */
export function generatePassword(options: PasswordOptions = {}): string {
  const {
    length = DEFAULT_PASSWORD_LENGTH,
    lowercase = true,
    uppercase = true,
    digits = true,
    symbols = true,
    excludeAmbiguous = true,
  } = options;

  if (!Number.isInteger(length) || length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(
      `Password length must be an integer between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH}`,
    );
  }

  const selected: Record<CharacterClass, boolean> = { lowercase, uppercase, digits, symbols };
  const sets = (Object.keys(CHARACTER_CLASSES) as CharacterClass[])
    .filter((name) => selected[name])
    .map((name) => CHARACTER_CLASSES[name][excludeAmbiguous ? "unambiguous" : "all"]);
  if (sets.length === 0) throw new Error("At least one character class must be enabled");

  const pool = sets.join("");
  const pick = (chars: string) => chars[randomInt(chars.length)];

  const chars = [
    ...sets.map(pick),
    ...Array.from({ length: length - sets.length }, () => pick(pool)),
  ];
  // Fisher–Yates shuffle.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
