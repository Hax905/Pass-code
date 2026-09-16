import { createHash } from "node:crypto";

import type { ApplyPasswordResult, RouterAdapter } from "./router-adapter";

export interface MockRouterAdapterOptions {
  /** Makes the first N calls throw, to exercise the failure path. */
  failFirst?: number;
  /** Makes every call throw. */
  alwaysFail?: boolean;
}

/**
 * The virtual router PassCode ships with (no physical hardware is supported).
 * Applying a password succeeds immediately; the encrypted copy stored by the
 * rotation service is the source of truth for the current password.
 */
export class MockRouterAdapter implements RouterAdapter {
  readonly name = "mock" as const;
  calls = 0;
  /** SHA-256 of the last applied password, so tests can check it without keeping plaintext. */
  lastAppliedFingerprint: string | undefined;

  constructor(private readonly options: MockRouterAdapterOptions = {}) {}

  async applyPassword(password: string): Promise<ApplyPasswordResult> {
    this.calls++;
    if (this.options.alwaysFail || this.calls <= (this.options.failFirst ?? 0)) {
      throw new Error("Virtual router: simulated failure");
    }
    this.lastAppliedFingerprint = fingerprint(password);
    return { manualApplicationRequired: false };
  }
}

export function fingerprint(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}
