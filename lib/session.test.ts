import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from './session';

describe('session tokens', () => {
  const now = 1_000_000_000_000;

  it('round-trips a valid token to its user id', async () => {
    const token = await createSessionToken('42', now);
    expect(await verifySessionToken(token, now)).toBe('42');
  });

  it('rejects an expired token', async () => {
    const token = await createSessionToken('42', now);
    const farFuture = now + 1000 * 60 * 60 * 24 * 365;
    expect(await verifySessionToken(token, farFuture)).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const token = await createSessionToken('42', now);
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(await verifySessionToken(tampered, now)).toBeNull();
  });

  it('rejects a forged user id (signature mismatch)', async () => {
    const token = await createSessionToken('42', now);
    const parts = token.split('.');
    const forged = ['99', parts[1], parts[2]].join('.');
    expect(await verifySessionToken(forged, now)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifySessionToken(undefined, now)).toBeNull();
    expect(await verifySessionToken('nope', now)).toBeNull();
  });
});
