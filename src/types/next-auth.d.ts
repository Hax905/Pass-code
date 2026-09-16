import type { DefaultSession } from "next-auth";

import type { Role } from "@/features/auth/types";

declare module "next-auth" {
  interface User {
    role?: Role;
    tokenVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      role?: Role;
      tokenVersion?: number;
    } & DefaultSession["user"];
  }
}

// next-auth re-exports this type from @auth/core, which is where the callbacks get it.
declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    tokenVersion?: number;
  }
}
