// Boundary between PassCode and the network hardware (STYLES.md §1).
// Password rotation is the only hardware capability PassCode may use: do not
// add firmware, port, traffic or other device operations here (PROMPT.md).
import type { ROUTER_ADAPTERS, VIRTUAL_ROUTER_FAILURE_MODES } from "@/lib/env";

import { MockRouterAdapter } from "./mock-router-adapter";

export type RouterAdapterName = (typeof ROUTER_ADAPTERS)[number];

export interface ApplyPasswordResult {
  /** True when a person still has to enter the password on the device. */
  manualApplicationRequired: boolean;
}

export interface RouterAdapter {
  readonly name: RouterAdapterName;
  /**
   * Sets the network password on the device. Must throw if the password was
   * not applied. Error messages are stored in rotation history, so they must
   * never contain the password.
   */
  applyPassword(password: string): Promise<ApplyPasswordResult>;
}

export function createRouterAdapter(
  name: RouterAdapterName,
  options: { failure?: (typeof VIRTUAL_ROUTER_FAILURE_MODES)[number] } = {},
): RouterAdapter {
  switch (name) {
    case "mock":
      return new MockRouterAdapter({
        alwaysFail: options.failure === "always",
        failFirst: options.failure === "first-attempt" ? 1 : 0,
      });
  }
}
