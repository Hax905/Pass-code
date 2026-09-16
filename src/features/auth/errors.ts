/** A request was refused by a guard. `status` is the HTTP status to answer with. */
export class AccessDeniedError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "session_invalid" | "forbidden",
  ) {
    super(code);
    this.name = "AccessDeniedError";
  }
}

/** A user-management action was refused for a business reason. */
export class UserActionError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "email_taken"
      | "user_not_found"
      | "invalid_status"
      | "cannot_modify_self"
      | "last_admin",
    message: string,
  ) {
    super(message);
    this.name = "UserActionError";
  }
}
