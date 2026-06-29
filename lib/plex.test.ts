import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractGuids,
  getServerIdentity,
  parseSharedUsers,
  sumLeafSizes,
  sumPartSizes,
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
  it('pulls tmdb and tvdb ids from Guid[]', () => {
    const node: PlexMetadata = {
      ratingKey: '1',
      title: 'x',
      Guid: [{ id: 'tmdb://12345' }, { id: 'tvdb://67890' }, { id: 'imdb://tt1' }],
    };
    expect(extractGuids(node)).toEqual({ tmdb: '12345', tvdb: '67890' });
  });

  it('returns nulls when no guids', () => {
    expect(extractGuids({ ratingKey: '1', title: 'x' })).toEqual({
      tmdb: null,
      tvdb: null,
    });
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
    // Plex serves its web-app HTML at / without a valid token — this used to
    // surface as "Unexpected token '<'". Now it must fall back cleanly.
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
  });

  it('drops Docker-bridge (172.16/12) addresses and orders LAN → WAN → relay', () => {
    const input: ServerConnection[] = [
      { uri: 'https://relay.plex.direct:443', local: false, relay: true },
      conn('23.88.151.184', false), // remote/WAN
      conn('172.18.0.1', true), // docker bridge — noise
      conn('172.22.0.1', true), // docker bridge — noise
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
