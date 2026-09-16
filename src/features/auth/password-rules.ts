// Password rules without the hashing library, so forms in the browser can use them too.

export const MIN_PASSWORD_LENGTH = 12;
// bcrypt silently ignores everything after 72 bytes, so longer passwords are refused.
export const MAX_PASSWORD_BYTES = 72;

/** Returns a problem description, or undefined if the password is acceptable. */
export function checkPasswordPolicy(password: string, email?: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  }
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "Password must not be your email address";
  }
  return undefined;
}
