import { createHash } from "node:crypto";

import type { ApplyPasswordResult, RouterAdapter } from "./router-adapter";

export interface MockRouterAdapterOptions {
  /** Makes the first N calls throw, to exercise the failure path. */
  failFirst?: number;
  /** Makes every call throw. */
  alwaysFail?: boolean;
}

/**
 * v1 default adapter: nothing is sent to hardware. The rotation service stores
 * the new password encrypted, and an admin applies it on the router by hand
 * (Phase 3 shows it to them), so every result requires manual application.
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
      throw new Error("Mock router: simulated failure");
    }
    this.lastAppliedFingerprint = fingerprint(password);
    return { manualApplicationRequired: true };
  }
}

export function fingerprint(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}
