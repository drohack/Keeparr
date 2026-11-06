import { describe, expect, it } from 'vitest';
import { decideAccess, denyReason, type AccessInputs } from './login';

// Defaults mirror the `open_signin` default (open sign-in on).
function inputs(over: Partial<AccessInputs> = {}): AccessInputs {
  return {
    hasAdmin: true,
    serverConfigured: true,
    isOwner: false,
    hasServerAccess: true,
    openSignin: true,
    userKnown: false,
    userEnabled: false,
    ...over,
  };
}

describe('decideAccess', () => {
  it('first-ever login becomes admin (bootstrap)', () => {
    expect(
      decideAccess(inputs({ hasAdmin: false, serverConfigured: false, hasServerAccess: false }))
    ).toBe('bootstrap_admin');
  });

  it('owner logging in before server configured awaits setup', () => {
    expect(
      decideAccess(inputs({ serverConfigured: false, isOwner: true, hasServerAccess: false }))
    ).toBe('await_setup');
  });

  it('non-owner before server configured is denied', () => {
    expect(
      decideAccess(inputs({ serverConfigured: false, hasServerAccess: false }))
    ).toBe('denied');
  });

  it('owner is always authorized once server configured', () => {
    expect(decideAccess(inputs({ isOwner: true, hasServerAccess: false }))).toBe(
      'authorized'
    );
  });

  it('open sign-in: shared user with access is authorized', () => {
    expect(decideAccess(inputs({ hasServerAccess: true }))).toBe('authorized');
  });

  it('open sign-in: user without server access is denied', () => {
    expect(decideAccess(inputs({ hasServerAccess: false }))).toBe('denied');
  });

  // --- Closed sign-in (only enabled accounts) ---
  it('closed sign-in: known + enabled (with access) is authorized', () => {
    expect(
      decideAccess(inputs({ openSignin: false, userKnown: true, userEnabled: true }))
    ).toBe('authorized');
  });

  it('closed sign-in: unknown user is denied even with server access', () => {
    expect(
      decideAccess(inputs({ openSignin: false, userKnown: false }))
    ).toBe('denied');
  });

  it('closed sign-in: known but disabled is denied', () => {
    expect(
      decideAccess(inputs({ openSignin: false, userKnown: true, userEnabled: false }))
    ).toBe('denied');
  });

  it('closed sign-in: owner still always authorized', () => {
    expect(
      decideAccess(inputs({ openSignin: false, isOwner: true, hasServerAccess: false }))
    ).toBe('authorized');
  });
});

describe('denyReason', () => {
  it('is null whenever decideAccess does not deny', () => {
    expect(denyReason(inputs())).toBeNull();
    expect(denyReason(inputs({ isOwner: true, hasServerAccess: false }))).toBeNull();
    expect(
      denyReason(inputs({ hasAdmin: false, serverConfigured: false, hasServerAccess: false }))
    ).toBeNull();
  });

  it('names an unconfigured server as setup_unfinished', () => {
    expect(denyReason(inputs({ serverConfigured: false, hasServerAccess: false }))).toBe(
      'setup_unfinished'
    );
  });

  it('names a missing share as no_server_access, even with closed sign-in', () => {
    expect(denyReason(inputs({ hasServerAccess: false }))).toBe('no_server_access');
    expect(denyReason(inputs({ hasServerAccess: false, openSignin: false }))).toBe(
      'no_server_access'
    );
  });

  it('names closed sign-in for an unknown or disabled account as not_enabled', () => {
    expect(denyReason(inputs({ openSignin: false }))).toBe('not_enabled');
    expect(denyReason(inputs({ openSignin: false, userKnown: true }))).toBe('not_enabled');
  });

  it('gives a reason for every denied combination', () => {
    const flags = [false, true];
    for (const hasAdmin of flags)
      for (const serverConfigured of flags)
        for (const isOwner of flags)
          for (const hasServerAccess of flags)
            for (const openSignin of flags)
              for (const userKnown of flags)
                for (const userEnabled of flags) {
                  const i = { hasAdmin, serverConfigured, isOwner, hasServerAccess, openSignin, userKnown, userEnabled };
                  expect(denyReason(i) != null).toBe(decideAccess(i) === 'denied');
                }
  });
});
