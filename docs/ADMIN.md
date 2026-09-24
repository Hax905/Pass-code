# PassCode for administrators

PassCode changes the building's Wi-Fi password on a schedule and gives the current one only to people
who sign in with their own account. Every time someone gets the password, it's recorded.

Sign in at `/login`. Administrators land on the dashboard at `/admin`.

## Dashboard

- **Rotation**: the schedule, when the password last changed, how old the current one is, and when it
  changes next.
- **Current password**: reveal it (recorded in the audit log, hides itself after 60 seconds) or
  change it immediately with **Rotate now**.
- **On the network**: the devices currently connected to the (virtual) Wi-Fi, and how many the last
  rotation dropped. A device that joined without an account is flagged **No account** — that is
  someone who was given the password informally, which is exactly what this system is for. Rotating
  clears the whole list.
- **Alerts** appear at the top and as a badge in the header on every admin page:
  - the last rotation failed
  - someone asked for the password more than 5 times in 24 hours (they may be passing it on)
  - someone hit the hourly limit
  - more than 10 refused requests, or more than 20 failed sign-ins, in the last hour
  - accounts waiting for approval

Admin pages refresh themselves once a minute, so things that happen in the background show up without
reloading.

## Rotation

Set how often the password changes (hours, days or weeks) and, if you want, a time window so it only
changes at quiet hours (the window may cross midnight). Nothing changes automatically until you save
a schedule for the first time.

Scheduled changes only happen while the app runs with `ROTATION_SCHEDULER_ENABLED=true`, or while
`npm run rotation:worker` is running.

The history table lists every attempt: when, who started it, whether it succeeded, how many attempts
it took, and the error if it failed. A failed rotation keeps the previous password working.

## Users

- **Add user**: creates an account that works immediately. You choose the first password and give it
  to the person yourself.
- **Approve** or **Reject** people who requested access at `/register`.
- **Revoke** removes access instantly: they're signed out everywhere on their next action, can't sign
  in again, and can't get the password. You can add a reason for the log.
- **Reinstate** restores a revoked account (they must sign in again).
- **Make admin / Make user** changes what someone can do; **Reset password** sets a new one. Both sign
  that person out everywhere.

Safety rules: you can't revoke or demote yourself, and the last remaining administrator can't be
removed, so the building can never be left without an admin.

## Password requests

Every request the assistant handles is listed: who asked, when, whether they got it, why not, and the
IP address. Each person can get the password 3 times per hour; further requests are refused and
recorded.

## Good to know

- The password is stored encrypted. Losing `PASSCODE_ENCRYPTION_KEY` makes stored passwords
  unreadable; rotating once fixes that.
- The audit log can't be edited or deleted through the app. Someone with direct database access could
  still change it — a real deployment would use a database account that can only add entries.
- PassCode only talks to a built-in **virtual router**: it doesn't change any physical router. After a
  rotation, the new password is what PassCode hands out, and it's what the (virtual) network expects.
- **Revoking someone doesn't throw their device off the network** — they keep the password they
  already have, just as they would with a real Wi-Fi password. What revoking stops immediately is
  everything else: signing in, the admin app, and getting the _next_ password from the assistant.
  **Rotate after revoking** to remove them from the network itself.
- Anyone who knows the current password can connect a device on the Network tab, with or without an
  account. That is deliberate — it mirrors real Wi-Fi, and it's what makes rotation worth doing.
  Attempts are limited per browser and per IP and all of them are recorded, so the form can't be used
  to guess the password.
