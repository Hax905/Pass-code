import type { ROLES, USER_STATUSES } from "@/lib/db/models";

export type Role = (typeof ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];

/** A user whose session passed a guard: loaded from the database, ACTIVE, current tokenVersion. */
export interface AuthorizedUser {
  id: string;
  email: string;
  name?: string;
  role: Role;
  tokenVersion: number;
}

/** What the rest of the app may know about a user (never the password hash). */
export interface PublicUser {
  id: string;
  email: string;
  name?: string;
  role: Role;
  status: UserStatus;
  createdAt: Date;
  revokedAt?: Date;
}
