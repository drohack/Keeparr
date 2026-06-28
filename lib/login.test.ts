import { describe, expect, it } from 'vitest';
import { decideAccess, type AccessInputs } from './login';

// Defaults represent the historical behavior (open sign-in on).
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
