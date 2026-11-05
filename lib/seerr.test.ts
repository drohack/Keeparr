import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setTestDbToMemory, __closeDb } from './db';
import { requestedRatingKeysForUser } from './seerr';

function fakeRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ME = { email: 'me@example.com', username: 'me' };

beforeEach(() => {
  __setTestDbToMemory(); // media_server_type defaults to plex
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => __closeDb());

describe('requestedRatingKeysForUser (paged take/skip)', () => {
  it('collects requests across pages so nothing past 200 is dropped', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      media: { ratingKey: String(i + 1) },
    }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      media: { ratingKey: String(i + 201) },
    }));
    const spy = vi
      .spyOn(globalThis, 'fetch')
      // /user page: the match is on the first (short) page.
      .mockResolvedValueOnce(
        fakeRes({ results: [{ id: 7, email: 'me@example.com' }] })
      )
      // /user/7/requests: a full page, then the remainder.
      .mockResolvedValueOnce(
        fakeRes({ pageInfo: { pages: 2, page: 1 }, results: page1 })
      )
      .mockResolvedValueOnce(
        fakeRes({ pageInfo: { pages: 2, page: 2 }, results: page2 })
      );
    const keys = await requestedRatingKeysForUser('http://seerr', 'k', ME);
    expect(keys.size).toBe(250);
    expect(keys.has('250')).toBe(true); // only on the second page
    expect(spy).toHaveBeenCalledTimes(3);
    expect(String(spy.mock.calls[2][0])).toContain('take=200&skip=200');
  });

  it('finds a user past the first /user page', async () => {
    const strangers = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      email: `other${i}@example.com`,
    }));
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        fakeRes({ pageInfo: { pages: 2, page: 1 }, results: strangers })
      )
      .mockResolvedValueOnce(
        fakeRes({ results: [{ id: 777, email: 'me@example.com' }] })
      )
      .mockResolvedValueOnce(
        fakeRes({ results: [{ media: { ratingKey: '5' } }] })
      );
    const keys = await requestedRatingKeysForUser('http://seerr', 'k', ME);
    expect(keys).toEqual(new Set(['5']));
  });

  it('returns empty when the user matches nowhere', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeRes({ results: [] }));
    const keys = await requestedRatingKeysForUser('http://seerr', 'k', ME);
    expect(keys.size).toBe(0);
  });
});
