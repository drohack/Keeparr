import { describe, expect, it } from 'vitest';
import {
  extractGuids,
  parseSharedUsers,
  sumLeafSizes,
  sumPartSizes,
  type PlexMetadata,
} from './plex';

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
