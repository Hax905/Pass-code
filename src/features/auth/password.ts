import bcrypt from "bcrypt";

export const BCRYPT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 12;
// bcrypt silently ignores everything after 72 bytes, so longer passwords are refused.
export const MAX_PASSWORD_BYTES = 72;

/** Returns a problem description, or undefined if the password is acceptable. */
export function checkPasswordPolicy(password: string, email?: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  }
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "Password must not be your email address";
  }
  return undefined;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check when there is no account (or no hash),
 * so response times don't reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= bcrypt.hash("passcode-dummy-password", BCRYPT_ROUNDS);
  await bcrypt.compare(password, await dummyHash);
  return false;
}
