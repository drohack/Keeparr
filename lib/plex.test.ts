import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractGuids,
  getServerIdentity,
  parseSharedUsers,
  plexConnectUrl,
  sumLeafSizes,
  sumPartSizes,
  plexHistoryScope,
  plexOwnerLogin,
  plexWatchHistory,
  usefulServerConnections,
  type PlexMetadata,
  type ServerConnection,
} from './plex';

/** Minimal Response-like for mocking fetch in these unit tests. */
function fakeRes(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  body?: unknown;
}): Response {
  const { ok = true, status = 200, contentType, body } = opts;
  return {
    ok,
    status,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-type' ? contentType ?? null : null,
    },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('sumPartSizes / sumLeafSizes', () => {
  it('sums all parts across all media versions of a movie', () => {
    const movie: PlexMetadata = {
      ratingKey: '1',
      title: 'Multi',
      Media: [
        { Part: [{ size: 1000 }, { size: 500 }] }, // multi-part (CD1/CD2)
        { Part: [{ size: 2000 }] }, // a second version (e.g. 4K)
      ],
    };
    expect(sumPartSizes(movie)).toBe(3500);
  });

  it('handles missing Media/Part gracefully', () => {
    expect(sumPartSizes({ ratingKey: '1', title: 'x' })).toBe(0);
    expect(sumPartSizes({ ratingKey: '1', title: 'x', Media: [{}] })).toBe(0);
  });

  it('sums episode leaves into a series total', () => {
    const leaves: PlexMetadata[] = [
      { ratingKey: 'e1', title: 'E1', Media: [{ Part: [{ size: 100 }] }] },
      { ratingKey: 'e2', title: 'E2', Media: [{ Part: [{ size: 250 }] }] },
      { ratingKey: 'e3', title: 'E3', Media: [{ Part: [{ size: 50 }] }] },
    ];
    expect(sumLeafSizes(leaves)).toBe(400);
  });

  it('counts a shared multi-episode file ONCE (Plex repeats full size per leaf)', () => {
    // s1.mkv holds E1+E2; Plex reports its full 1000-byte size on both leaves.
    const leaves: PlexMetadata[] = [
      { ratingKey: 'e1', title: 'E1', Media: [{ Part: [{ id: 1, file: '/tv/rvb/s1.mkv', size: 1000 }] }] },
      { ratingKey: 'e2', title: 'E2', Media: [{ Part: [{ id: 1, file: '/tv/rvb/s1.mkv', size: 1000 }] }] },
      { ratingKey: 'e3', title: 'E3', Media: [{ Part: [{ id: 2, file: '/tv/rvb/s2.mkv', size: 500 }] }] },
    ];
    // 1000 (s1, once) + 500 (s2) = 1500, NOT 2500.
    expect(sumLeafSizes(leaves)).toBe(1500);
  });

  it('dedupes by file path even when ids differ', () => {
    const leaves: PlexMetadata[] = [
      { ratingKey: 'e1', title: 'E1', Media: [{ Part: [{ id: 10, file: '/x/a.mkv', size: 800 }] }] },
      { ratingKey: 'e2', title: 'E2', Media: [{ Part: [{ id: 11, file: '/x/a.mkv', size: 800 }] }] },
    ];
    expect(sumLeafSizes(leaves)).toBe(800);
  });
});

describe('extractGuids', () => {
  it('pulls tmdb, tvdb and imdb ids from Guid[]', () => {
    const node: PlexMetadata = {
      ratingKey: '1',
      title: 'x',
      Guid: [{ id: 'tmdb://12345' }, { id: 'tvdb://67890' }, { id: 'imdb://tt1' }],
    };
    expect(extractGuids(node)).toEqual({ tmdb: '12345', tvdb: '67890', imdb: 'tt1' });
  });

  it('returns nulls when no guids', () => {
    expect(extractGuids({ ratingKey: '1', title: 'x' })).toEqual({
      tmdb: null,
      tvdb: null,
      imdb: null,
    });
  });

  it('keeps ALL ids when Plex lists several (real "Love is Blind" case)', () => {
    // Plex carries two tvdb ids and Sonarr keys on 376459, not the last one
    // (407505), so all ids are kept (CSV).
    const node: PlexMetadata = {
      ratingKey: '122531',
      title: 'Love is Blind',
      guid: 'plex://show/5e4d2531',
      Guid: [
        { id: 'imdb://tt11704040' },
        { id: 'tmdb://99353' },
        { id: 'tvdb://376459' },
        { id: 'tvdb://407505' },
      ],
    };
    expect(extractGuids(node)).toEqual({
      tmdb: '99353',
      tvdb: '376459,407505',
      imdb: 'tt11704040',
    });
  });

  it('falls back to the legacy single-guid string when Guid[] is absent', () => {
    expect(
      extractGuids({ ratingKey: '1', title: 'x', guid: 'com.plexapp.agents.thetvdb://376459?lang=en' })
    ).toEqual({ tmdb: null, tvdb: '376459', imdb: null });
    expect(
      extractGuids({ ratingKey: '1', title: 'x', guid: 'com.plexapp.agents.imdb://tt0093629' })
    ).toEqual({ tmdb: null, tvdb: null, imdb: 'tt0093629' });
    // Modern plex:// guid carries no external id -> ignored.
    expect(
      extractGuids({ ratingKey: '1', title: 'x', guid: 'plex://show/abc' })
    ).toEqual({ tmdb: null, tvdb: null, imdb: null });
  });
});

describe('getServerIdentity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads machineIdentifier + friendlyName from / when it returns JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeRes({
        contentType: 'application/json',
        body: { MediaContainer: { machineIdentifier: 'M1', friendlyName: 'Tower' } },
      })
    );
    const id = await getServerIdentity('http://host:32400', 'tok');
    expect(id).toEqual({ machineIdentifier: 'M1', friendlyName: 'Tower' });
  });

  it('falls back to /identity when / returns HTML (no cryptic JSON-parse error)', async () => {
    // Plex serves its web-app HTML at / without a valid token; that must fall
    // back to /identity, not surface as "Unexpected token '<'".
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/identity')) {
          return fakeRes({
            contentType: 'application/json',
            body: { MediaContainer: { machineIdentifier: 'M2' } },
          });
        }
        return fakeRes({
          contentType: 'text/html',
          body: '<!DOCTYPE html><html>Plex Web</html>',
        });
      });
    const id = await getServerIdentity('http://host:32400', '');
    expect(id.machineIdentifier).toBe('M2');
    expect(fetchMock).toHaveBeenCalledTimes(2); // tried / then /identity
  });

  it('throws a clear error (not a JSON SyntaxError) when both fail with HTML', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeRes({ contentType: 'text/html', body: '<!DOCTYPE html><html/>' })
    );
    await expect(getServerIdentity('http://host:32400', '')).rejects.toThrow(
      /non-JSON|text\/html/i
    );
  });
});

describe('usefulServerConnections', () => {
  const hash = 'abc123';
  const conn = (ip: string, local: boolean, relay = false): ServerConnection => ({
    uri: `https://${ip.replace(/\./g, '-')}.${hash}.plex.direct:32400`,
    local,
    relay,
    address: ip,
    port: 32400,
    protocol: 'http',
  });

  it('drops Docker-bridge (172.16/12) addresses and orders LAN → WAN → relay', () => {
    const input: ServerConnection[] = [
      { uri: 'https://relay.plex.direct:443', local: false, relay: true, address: '', port: 443, protocol: 'https' },
      conn('23.88.151.184', false), // remote/WAN
      conn('172.18.0.1', true), // docker bridge - noise
      conn('172.22.0.1', true), // docker bridge - noise
      conn('192.168.1.2', true), // real LAN
    ];
    const out = usefulServerConnections(input);
    const ips = out.map((c) => c.uri);
    // Docker bridges removed
    expect(ips.some((u) => u.includes('172-18-0-1'))).toBe(false);
    expect(ips.some((u) => u.includes('172-22-0-1'))).toBe(false);
    // LAN first, relay last
    expect(out[0].uri).toContain('192-168-1-2');
    expect(out[out.length - 1].relay).toBe(true);
    expect(out).toHaveLength(3);
  });

  it('keeps Docker addresses only if they are the only option (never empties)', () => {
    const input: ServerConnection[] = [conn('172.18.0.1', true)];
    expect(usefulServerConnections(input)).toHaveLength(1);
  });
});

describe('plexConnectUrl', () => {
  it('uses the raw http://ip:port for a LAN-local connection (container-reachable)', () => {
    expect(
      plexConnectUrl({
        uri: 'https://192-168-1-2.abc.plex.direct:32400',
        local: true,
        relay: false,
        address: '192.168.1.2',
        port: 32400,
        protocol: 'http',
      })
    ).toBe('http://192.168.1.2:32400');
  });

  it('keeps the plex.direct uri for remote/relay (only routable option)', () => {
    const remote: ServerConnection = {
      uri: 'https://23-88-151-184.abc.plex.direct:32400',
      local: false,
      relay: false,
      address: '23.88.151.184',
      port: 32400,
      protocol: 'https',
    };
    expect(plexConnectUrl(remote)).toBe(remote.uri);
    expect(plexConnectUrl({ ...remote, relay: true })).toBe(remote.uri);
  });

  it('falls back to the uri when a local connection lacks address/port', () => {
    expect(
      plexConnectUrl({
        uri: 'https://x.plex.direct:32400',
        local: true,
        relay: false,
        address: '',
        port: 0,
        protocol: 'http',
      })
    ).toBe('https://x.plex.direct:32400');
  });
});

describe('parseSharedUsers', () => {
  const xml = `<?xml version="1.0"?>
    <MediaContainer size="2">
      <User id="111" title="Alice" email="a@x.com">
        <Server id="s1" machineIdentifier="MACHINE_A" name="Home"/>
        <Server id="s2" machineIdentifier="MACHINE_B" name="Other"/>
      </User>
      <User id="222" title="Bob" email="b@x.com"/>
    </MediaContainer>`;

  it('extracts user ids and their accessible machine ids', () => {
    const users = parseSharedUsers(xml);
    expect(users).toHaveLength(2);
    expect(users.find((u) => u.id === '111')?.machineIds).toEqual([
      'MACHINE_A',
      'MACHINE_B',
    ]);
    expect(users.find((u) => u.id === '222')?.machineIds).toEqual([]);
  });

  it('a self-closing user with no servers has no access', () => {
    const users = parseSharedUsers(xml);
    const bob = users.find((u) => u.id === '222');
    expect(bob?.machineIds.includes('MACHINE_A')).toBe(false);
  });

  it('extracts username/email/thumb (username falls back to title)', () => {
    const withThumb = `<MediaContainer>
      <User id="9" username="neo" email="neo@x.com" thumb="https://plex.tv/n.png"/>
      <User id="10" title="Trinity"/>
    </MediaContainer>`;
    const users = parseSharedUsers(withThumb);
    const neo = users.find((u) => u.id === '9')!;
    expect(neo.username).toBe('neo');
    expect(neo.email).toBe('neo@x.com');
    expect(neo.thumb).toBe('https://plex.tv/n.png');
    expect(users.find((u) => u.id === '10')?.username).toBe('Trinity');
  });
});

describe('plexWatchHistory', () => {
  afterEach(() => vi.restoreAllMocks());

  /** One /status/sessions/history/all page. */
  const page = (rows: unknown[], totalSize?: number) =>
    fakeRes({
      contentType: 'application/json',
      body: { MediaContainer: { totalSize: totalSize ?? rows.length, Metadata: rows } },
    });

  const ep = (account: number, series: string, viewedAt: number) => ({
    type: 'episode',
    accountID: account,
    ratingKey: String(viewedAt), // the EPISODE's key - must not be used
    grandparentKey: `/library/metadata/${series}`,
    viewedAt,
  });
  const movie = (account: number, key: string, viewedAt: number) => ({
    type: 'movie',
    accountID: account,
    ratingKey: key,
    viewedAt,
  });

  it('rolls episodes up to the series key and keeps movies on their own key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      page([ep(7, '24186', 100), ep(7, '24186', 200), movie(7, '555', 300)])
    );
    const rows = await plexWatchHistory('http://plex:32400', 'tok');
    expect(rows).toEqual(
      expect.arrayContaining([
        // Two episode views of one series collapse into a single series row.
        { plexUserId: '7', ratingKey: '24186', plays: 2, lastWatched: 200 },
        { plexUserId: '7', ratingKey: '555', plays: 1, lastWatched: 300 },
      ])
    );
    expect(rows).toHaveLength(2);
  });

  it('counts plays per user separately and takes the latest viewedAt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      page([ep(1, '9', 500), ep(2, '9', 100), ep(1, '9', 900), ep(1, '9', 300)])
    );
    const rows = await plexWatchHistory('http://plex:32400', 'tok');
    expect(rows).toEqual(
      expect.arrayContaining([
        { plexUserId: '1', ratingKey: '9', plays: 3, lastWatched: 900 },
        { plexUserId: '2', ratingKey: '9', plays: 1, lastWatched: 100 },
      ])
    );
    expect(rows).toHaveLength(2);
  });

  it('drops rows for deleted media and unexpected types rather than counting them', async () => {
    // Plex keeps the view record but drops key/ratingKey once the media is gone
    // (a few percent of rows on the live server). Those must not become watch rows.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      page([
        { type: 'episode', accountID: 1, viewedAt: 10 }, // no grandparentKey
        { type: 'movie', accountID: 1, viewedAt: 20 }, // no ratingKey
        { type: 'track', accountID: 1, ratingKey: '3', viewedAt: 30 }, // not media we track
        { type: 'movie', ratingKey: '4', viewedAt: 40 }, // no accountID
        movie(1, '5', 50), // the only usable row
      ])
    );
    const rows = await plexWatchHistory('http://plex:32400', 'tok');
    expect(rows).toEqual([{ plexUserId: '1', ratingKey: '5', plays: 1, lastWatched: 50 }]);
  });

  it('pages until totalSize is exhausted, advancing by rows received', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      // A short first page: the loop must advance by batch.length, not pageSize,
      // or it would skip the rows in between.
      .mockResolvedValueOnce(page([movie(1, 'a', 1), movie(1, 'b', 2)], 3))
      .mockResolvedValueOnce(page([movie(1, 'c', 3)], 3));
    const rows = await plexWatchHistory('http://plex:32400', 'tok', { pageSize: 2 });
    expect(rows).toHaveLength(3);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1][0])).toContain('X-Plex-Container-Start=2');
  });

  it('sends BOTH container params on every request', async () => {
    // Plex silently ignores X-Plex-Container-Size unless X-Plex-Container-Start
    // is also present, and then returns the entire history (100k+ rows) in one
    // response. That still produces correct output, so only this assertion
    // catches it.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(page([movie(1, 'a', 1)], 2))
      .mockResolvedValueOnce(page([movie(1, 'b', 2)], 2));
    await plexWatchHistory('http://plex:32400', 'tok');
    for (const call of spy.mock.calls) {
      expect(String(call[0])).toContain('X-Plex-Container-Start=');
      expect(String(call[0])).toContain('X-Plex-Container-Size=');
    }
  });

  it('stops immediately on an empty page', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(page([], 999));
    const rows = await plexWatchHistory('http://plex:32400', 'tok');
    expect(rows).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('remaps the owner (PMS account 1) onto their plex.tv id', async () => {
    // Shared users appear under their plex.tv id, but PMS numbers the OWNER 1
    // in its local accounts table. Verified live: history accountID 1 is the
    // same person Tautulli lists under their plex.tv id.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      page([movie(1, 'm1', 10), movie(3629986, 'm1', 20)])
    );
    const rows = await plexWatchHistory('http://plex:32400', 'tok', {
      ownerId: '10000001',
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { plexUserId: '10000001', ratingKey: 'm1', plays: 1, lastWatched: 10 },
        { plexUserId: '3629986', ratingKey: 'm1', plays: 1, lastWatched: 20 },
      ])
    );
  });

  it('leaves account 1 alone when no ownerId is supplied', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(page([movie(1, 'm1', 10)]));
    const rows = await plexWatchHistory('http://plex:32400', 'tok');
    expect(rows[0].plexUserId).toBe('1');
  });

  it('keeps paging on a short page when the server omits totalSize', async () => {
    // Defaulting total to batch.length would stop after page one and silently
    // return a fraction of the history.
    const noTotal = (rows: unknown[]) =>
      fakeRes({
        contentType: 'application/json',
        body: { MediaContainer: { Metadata: rows } },
      });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(noTotal([movie(1, 'a', 1), movie(1, 'b', 2)]))
      .mockResolvedValueOnce(noTotal([movie(1, 'c', 3)]));
    const rows = await plexWatchHistory('http://plex:32400', 'tok', { pageSize: 2 });
    expect(rows).toHaveLength(3);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws rather than truncating when maxPages is exhausted', async () => {
    // A silently short history marks watched titles as never-watched - the
    // expensive direction. Fail the job instead.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(page([movie(1, 'a', 1)], 10_000));
    await expect(
      plexWatchHistory('http://plex:32400', 'tok', { pageSize: 1, maxPages: 3 })
    ).rejects.toThrow(/truncated/);
  });

  it('throws when the server ignores paging and returns everything', async () => {
    // Dropping X-Plex-Container-Start makes Plex return all 100k+ rows at once.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      page([movie(1, 'a', 1), movie(1, 'b', 2), movie(1, 'c', 3)], 3)
    );
    await expect(
      plexWatchHistory('http://plex:32400', 'tok', { pageSize: 2 })
    ).rejects.toThrow(/ignored history paging/);
  });
});

describe('plexOwnerLogin', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the server owner from /myplex/account (an email, not a username)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeRes({
        contentType: 'application/json',
        body: { MyPlex: { username: 'owner@example.com', signInState: 'ok' } },
      })
    );
    expect(await plexOwnerLogin('http://plex:32400', 'tok')).toBe('owner@example.com');
  });

  it('returns null instead of throwing when PMS will not say', async () => {
    // The caller only uses this to attribute history; failing to resolve must
    // degrade to "do not remap", never break the watch sync.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeRes({ ok: false, status: 401, contentType: 'application/json', body: {} })
    );
    expect(await plexOwnerLogin('http://plex:32400', 'tok')).toBeNull();
  });

  it('returns null when the payload has no username', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeRes({ contentType: 'application/json', body: { MyPlex: {} } })
    );
    expect(await plexOwnerLogin('http://plex:32400', 'tok')).toBeNull();
  });
});

describe('plexHistoryScope (catching a non-owner token at paste time)', () => {
  afterEach(() => vi.restoreAllMocks());

  const hist = (rows: unknown[], totalSize: number) =>
    fakeRes({
      contentType: 'application/json',
      body: { MediaContainer: { totalSize, Metadata: rows } },
    });

  it('accepts a token that sees several accounts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      hist(
        [
          { type: 'movie', accountID: 1, ratingKey: 'a', viewedAt: 1 },
          { type: 'movie', accountID: 3629986, ratingKey: 'b', viewedAt: 2 },
        ],
        99016
      )
    );
    const r = await plexHistoryScope('http://plex:32400', 'tok');
    expect(r.ok).toBe(true);
    expect(r.status).toBe('all');
    expect(r.message).toContain('99016');
  });

  it('rejects a shared-user token that can only see itself', async () => {
    // The dangerous case: HTTP 200, plausible data, silently one account.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      hist(
        [
          { type: 'movie', accountID: 3629986, ratingKey: 'a', viewedAt: 1 },
          { type: 'episode', accountID: 3629986, grandparentKey: '/library/metadata/9', viewedAt: 2 },
        ],
        15714
      )
    );
    const r = await plexHistoryScope('http://plex:32400', 'tok');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('limited');
    expect(r.message).toMatch(/not the server owner/i);
  });

  it('reports an empty history rather than calling it a pass', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(hist([], 0));
    expect((await plexHistoryScope('http://plex:32400', 'tok')).ok).toBe(false);
  });

  it('reports UNKNOWN rather than "limited" when Plex is unreachable', async () => {
    // Unreachable says nothing about scope. Calling it limited would tell an
    // admin their token is too narrow every time their server is down.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'));
    const r = await plexHistoryScope('http://plex:32400', 'tok');
    expect(r.status).toBe('unknown');
    expect(r.ok).toBe(false);
  });

  it('never throws on a bad token, and does not call that limited either', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeRes({ ok: false, status: 401, contentType: 'application/json', body: {} })
    );
    const r = await plexHistoryScope('http://plex:32400', 'bad');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('unknown');
  });
});
