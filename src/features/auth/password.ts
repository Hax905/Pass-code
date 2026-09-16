import bcrypt from "bcrypt";

export const BCRYPT_ROUNDS = 12;
export { checkPasswordPolicy, MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from "./password-rules";

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
