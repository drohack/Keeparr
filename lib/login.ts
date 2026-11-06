/**
 * Pure access-control decision for a completed login (any backend). Kept separate from
 * the route handler (which does the I/O) so the branching is unit-testable.
 */

export interface AccessInputs {
  /** Does any admin already exist in our users table? */
  hasAdmin: boolean;
  /** Is a media server connected (`isServerConfigured()`)? */
  serverConfigured: boolean;
  /** Is the logging-in account the recorded owner/admin account? */
  isOwner: boolean;
  /** Server access: the server is in the user's own Plex resources; true for Jellyfin/Emby logins. */
  hasServerAccess: boolean;
  /** Setting: may any server member sign in (vs only enabled accounts)? */
  openSignin: boolean;
  /** Does this account already have a row in our users table? */
  userKnown: boolean;
  /** Is that account's `enabled` flag set? (false when unknown.) */
  userEnabled: boolean;
}

export type AccessDecision =
  | 'bootstrap_admin' // first-ever login -> becomes admin, must set up server
  | 'await_setup' // owner logging in again before server is configured
  | 'authorized' // normal allowed login
  | 'denied'; // no access to the configured server

export function decideAccess(i: AccessInputs): AccessDecision {
  if (!i.serverConfigured) {
    if (!i.hasAdmin) return 'bootstrap_admin';
    return i.isOwner ? 'await_setup' : 'denied';
  }
  // Server configured: owner always in; others must have shared access.
  if (i.isOwner) return 'authorized';
  if (!i.hasServerAccess) return 'denied';
  // Open sign-in: any server member is allowed. Otherwise only an admin-enabled
  // (known + enabled) account may sign in.
  if (i.openSignin) return 'authorized';
  return i.userKnown && i.userEnabled ? 'authorized' : 'denied';
}

export type DenyReason = 'setup_unfinished' | 'no_server_access' | 'not_enabled';

/** Why `decideAccess` denied these inputs; null when it would not deny. */
export function denyReason(i: AccessInputs): DenyReason | null {
  if (decideAccess(i) !== 'denied') return null;
  if (!i.serverConfigured) return 'setup_unfinished';
  if (!i.hasServerAccess) return 'no_server_access';
  return 'not_enabled';
}
