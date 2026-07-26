/**
 * Local development seed. Populates the SQLite DB with realistic fake data so you
 * can click through the whole app with no Plex/Tautulli/Seerr. Invoked by the
 * `npm run seed` script (scripts/seed.ts). Safe to delete if unwanted — it only
 * runs when you call it. Pairs with `KEEPARR_DEV_LOGIN=1` (middleware auto-login).
 */
import {
  addDelete,
  addKeep,
  addSkip,
  libraryStats,
  recordJobRun,
  replaceArrConflicts,
  replaceArrItems,
  replaceArrUnmatched,
  replaceDiskOrphansForSection,
  replaceSeerrRequests,
  setJobState,
  tombstoneStale,
  upsertMediaBatch,
  upsertUser,
  upsertWatchBatch,
  type ArrItemInput,
  type UpsertMediaInput,
} from './queries';
import {
  setAppTitle,
  setManagedSectionIds,
  setMediaServerType,
  setOpenSignin,
  setPlexSections,
  setRadarrInstances,
  setServerField,
  setSonarrInstances,
  setStorageMappings,
  writeSetting,
  type MediaServerType,
} from './settings';
import { DEV_USER_ID } from './dev-constants';

/** Make the dev login a plain (non-admin) user instead of the Owner/admin. */
const DEV_USER_IS_ADMIN = true;

const GB = 1024 ** 3;

const SECTIONS = [
  { id: '1', title: 'Movies', type: 'movie' },
  { id: '2', title: '4K Movies', type: 'movie' },
  { id: '3', title: 'TV Shows', type: 'show' },
  { id: '4', title: 'Anime', type: 'show' },
];

// ~100 each. Real-ish titles so the lists feel like a real library.
const MOVIES = [
  'The Shawshank Redemption', 'The Godfather', 'The Dark Knight', 'The Godfather Part II',
  '12 Angry Men', "Schindler's List", 'The Lord of the Rings: The Return of the King',
  'Pulp Fiction', 'The Lord of the Rings: The Fellowship of the Ring',
  'The Good, the Bad and the Ugly', 'Forrest Gump', 'Fight Club',
  'The Lord of the Rings: The Two Towers', 'Inception',
  'Star Wars: Episode V - The Empire Strikes Back', 'The Matrix', 'Goodfellas',
  "One Flew Over the Cuckoo's Nest", 'Se7en', 'Seven Samurai', "It's a Wonderful Life",
  'The Silence of the Lambs', 'Saving Private Ryan', 'City of God', 'Life Is Beautiful',
  'The Green Mile', 'Interstellar', 'Star Wars: Episode IV - A New Hope',
  'Terminator 2: Judgment Day', 'Back to the Future', 'The Pianist', 'Psycho', 'Parasite',
  'Gladiator', 'The Lion King', 'The Departed', 'Whiplash', 'The Prestige', 'Casablanca',
  'Harakiri', 'The Intouchables', 'Modern Times', 'Once Upon a Time in the West',
  'Rear Window', 'Alien', 'City Lights', 'Apocalypse Now', 'Memento',
  'Raiders of the Lost Ark', 'Django Unchained', 'WALL·E', 'The Lives of Others',
  'Sunset Boulevard', 'Paths of Glory', 'The Shining', 'The Great Dictator',
  'Witness for the Prosecution', 'Aliens', 'American History X',
  'Spider-Man: Into the Spider-Verse', 'Oldboy', 'Coco', 'Toy Story', 'Braveheart',
  'Once Upon a Time in America', 'Das Boot', 'Joker', 'Avengers: Infinity War',
  'Reservoir Dogs', 'Requiem for a Dream', '3 Idiots', 'Eternal Sunshine of the Spotless Mind',
  '2001: A Space Odyssey', "Singin' in the Rain", 'The Hunt', 'Lawrence of Arabia',
  'The Apartment', 'Vertigo', 'North by Northwest', 'Amadeus', 'Full Metal Jacket',
  'A Clockwork Orange', 'Double Indemnity', 'Citizen Kane', 'To Kill a Mockingbird', 'Up',
  'Metropolis', 'Bicycle Thieves', 'Taxi Driver', 'Snatch', 'Dangal', 'Heat',
  'Inglourious Basterds', 'The Sixth Sense', 'No Country for Old Men', 'The Thing',
  'Blade Runner 2049', 'Dune', 'Arrival', 'Sicario', 'Drive', 'Prisoners',
];
const SHOWS = [
  'Breaking Bad', 'Band of Brothers', 'Chernobyl', 'The Wire', 'The Sopranos',
  'Game of Thrones', 'Sherlock', 'The Office', 'Rick and Morty', 'True Detective',
  'Fargo', 'Person of Interest', "It's Always Sunny in Philadelphia", 'Better Call Saul',
  'The Mandalorian', 'Friends', 'Dark', 'Peaky Blinders', 'Stranger Things', 'The Boys',
  'Mr. Robot', 'Black Mirror', 'Westworld', 'House', 'House of Cards', 'The Crown',
  'Narcos', 'Vikings', 'Mindhunter', 'Ozark', 'Succession', 'The Last of Us', 'Severance',
  'Ted Lasso', 'The Bear', 'Andor', 'Arcane', 'Wednesday', 'The Witcher', 'Money Heist',
  'Dexter', 'Lost', 'Prison Break', '24', 'The Walking Dead', 'Twin Peaks', 'Seinfeld',
  'Frasier', 'Curb Your Enthusiasm', 'Parks and Recreation', 'Community',
  'Brooklyn Nine-Nine', 'Boardwalk Empire', 'Deadwood', 'Six Feet Under', 'The West Wing',
  'Mad Men', 'Homeland', 'Justified', 'Sons of Anarchy', 'The Shield', 'Battlestar Galactica',
  'Firefly', 'Doctor Who', 'The X-Files', 'Star Trek: The Next Generation', 'Hannibal',
  'The Americans', 'Halt and Catch Fire', 'Spartacus', 'Rome', 'Outlander', 'The Expanse',
  'Foundation', 'Silo', 'Shogun', 'The Penguin', 'Fallout', 'House of the Dragon',
  'The Leftovers', 'Watchmen', 'Catch-22', 'The Night Of', 'Sharp Objects', 'Big Little Lies',
  'Euphoria', 'Barry', 'Atlanta', 'Veep', 'Silicon Valley', 'The Newsroom', 'Entourage',
  'The Pacific', 'Fleabag', 'Chernobyl: The Lost Tapes', 'Yellowstone', '1899', 'Dark Matter',
];
const ANIME = [
  'Fullmetal Alchemist: Brotherhood', 'Steins;Gate', 'Hunter x Hunter', 'Gintama',
  "Frieren: Beyond Journey's End", 'Attack on Titan', 'Death Note', 'One Piece',
  'Code Geass', 'Cowboy Bebop', 'Vinland Saga', 'Monster', 'Mob Psycho 100', 'Demon Slayer',
  'My Hero Academia', 'Jujutsu Kaisen', 'Naruto', 'Naruto Shippuden', 'Bleach',
  'Dragon Ball Z', 'Dragon Ball', 'One Punch Man', 'Neon Genesis Evangelion', 'Spy x Family',
  'Chainsaw Man', 'Made in Abyss', 'Re:Zero', 'The Promised Neverland', 'Your Lie in April',
  'A Silent Voice', 'Violet Evergarden', 'Clannad', 'Clannad After Story', 'Anohana',
  'Toradora', 'Kaguya-sama: Love Is War', 'Bocchi the Rock!', 'Haikyuu!!',
  "Kuroko's Basketball", 'Slam Dunk', 'Initial D', "JoJo's Bizarre Adventure", 'Black Lagoon',
  'Hellsing Ultimate', 'Berserk', 'Claymore', 'Akame ga Kill', 'Tokyo Ghoul', 'Parasyte',
  'Erased', 'Terror in Resonance', 'Psycho-Pass', 'Ghost in the Shell: Stand Alone Complex',
  'Samurai Champloo', 'Trigun', 'Fate/Zero', 'Fate/stay night: Unlimited Blade Works',
  'The Rising of the Shield Hero', 'That Time I Got Reincarnated as a Slime', 'Mushoku Tensei',
  'Overlord', 'No Game No Life', 'Sword Art Online', 'Konosuba', 'Dr. Stone', 'Fire Force',
  'Black Clover', "Hell's Paradise", 'Blue Lock', 'Oshi no Ko', "Vivy: Fluorite Eye's Song",
  '86', 'Cyberpunk: Edgerunners', 'Devilman Crybaby', 'Aggretsuko', 'Beastars', 'Dorohedoro',
  'Land of the Lustrous', 'March Comes in Like a Lion', 'Banana Fish', 'Yuri on Ice', 'Free!',
  'K-On!', 'Lucky Star', 'The Melancholy of Haruhi Suzumiya', 'Nichijou', 'Azumanga Daioh',
  'Cells at Work!', 'Food Wars!', 'Assassination Classroom', 'Magi', 'Seven Deadly Sins',
  'Fairy Tail', 'Soul Eater', 'D.Gray-man', 'Blue Exorcist', 'Noragami', 'Durarara!!',
  'Baccano!', 'Great Teacher Onizuka',
];

/** Tiny deterministic PRNG (mulberry32 step) so reseeds produce stable sizes. */
function rng(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function buildItems(): UpsertMediaInput[] {
  const items: UpsertMediaInput[] = [];
  let n = 0;
  const add = (
    title: string,
    sectionId: string,
    kind: 'movie' | 'show',
    minGB: number,
    maxGB: number
  ) => {
    n++;
    const sizeBytes = Math.round((minGB + rng(n) * (maxGB - minGB)) * GB);
    items.push({
      ratingKey: `dev-${n}`,
      sectionId,
      libraryKind: kind,
      title,
      year: 1972 + Math.floor(rng(n + 7) * 52),
      thumb: null, // no Plex → cards fall back to the title
      sizeBytes,
      addedAt: 1_700_000_000 - n * 43_200,
      // Most items carry an external id (so arr matching works); leave every
      // 13th null to demo the "Plex item missing tmdb/tvdb id" match-health case.
      guidTmdb: kind === 'movie' && n % 13 !== 0 ? String(n) : null,
      guidTvdb: kind === 'show' && n % 13 !== 0 ? String(n) : null,
      // On-disk names (disk-orphan matching) — lets a real local Disk scan pass
      // the safety guard if you map a section to a scratch folder.
      dirName: title,
      fileName: kind === 'movie' ? `${title}.mkv` : null,
    });
  };

  // Split movies: every 3rd goes to the 4K library with much larger files.
  MOVIES.forEach((t, i) =>
    i % 3 === 0 ? add(t, '2', 'movie', 40, 90) : add(t, '1', 'movie', 2, 18)
  );
  SHOWS.forEach((t) => add(t, '3', 'show', 8, 300));
  ANIME.forEach((t) => add(t, '4', 'show', 5, 120));
  return items;
}

// Two Sonarr instances (main + a separate Anime one) and one Radarr — exercises
// the N-instances support and gives the Quality view real instance variety.
const SONARR_MAIN = { id: 'sonarr-main', name: 'Sonarr' };
const SONARR_ANIME = { id: 'sonarr-anime', name: 'Sonarr (Anime)' };
const RADARR_MAIN = { id: 'radarr-main', name: 'Radarr' };

const MOVIE_QUALITIES = ['Bluray-1080p', 'WEBDL-1080p', 'Bluray-720p', 'HDTV-720p'];
const SHOW_PROFILES = ['HD-1080p', 'Ultra-HD', 'Any', 'SD'];

/** Fabricate arr_items for the seeded media so /quality is populated offline.
 *  Every 9th item is skipped (no arr row) → demos the "Not in *arr" bucket + the
 *  Browse "unmatched" filter. Every 17th gets a divergent arr size → mismatch ⚠. */
function buildArrItems(items: UpsertMediaInput[]): ArrItemInput[] {
  const out: ArrItemInput[] = [];
  items.forEach((m, i) => {
    const n = i + 1;
    if (n % 9 === 0) return; // leave some titles unmatched
    const movie = m.libraryKind === 'movie';
    const anime = m.sectionId === '4';
    const inst = movie ? RADARR_MAIN : anime ? SONARR_ANIME : SONARR_MAIN;
    const tags: string[] = [];
    if (anime) tags.push('Anime');
    if (n % 6 === 0) tags.push('Bounty');
    if (movie && n % 10 === 0) tags.push('Kids');
    out.push({
      ratingKey: m.ratingKey,
      source: movie ? 'radarr' : 'sonarr',
      instanceId: inst.id,
      instanceName: inst.name,
      arrId: n,
      monitored: n % 11 !== 0, // a few unmonitored to demo the filter
      status: movie ? 'released' : n % 5 === 0 ? 'ended' : 'continuing',
      quality: movie
        ? m.sectionId === '2'
          ? 'Bluray-2160p'
          : MOVIE_QUALITIES[n % MOVIE_QUALITIES.length]
        : SHOW_PROFILES[n % SHOW_PROFILES.length],
      qualityKind: movie ? 'file' : 'profile',
      rootFolder: movie ? '/movies' : anime ? '/anime' : '/tv',
      // Usually matches Plex; every 17th diverges sharply to demo the ⚠ flag.
      arrSizeBytes: n % 17 === 0 ? Math.round(m.sizeBytes * 0.3) : m.sizeBytes,
      tags,
    });
  });
  return out;
}

/** A few fake unmatched arr titles (downloaded but no Plex match) for Match health. */
const ARR_UNMATCHED = [
  { source: 'sonarr', instanceId: SONARR_MAIN.id, instanceName: 'Sonarr', title: 'Some Obscure Show', extKind: 'tvdb' as const, extId: '999001', sizeBytes: Math.round(42 * GB) },
  { source: 'sonarr', instanceId: SONARR_ANIME.id, instanceName: 'Sonarr (Anime)', title: 'Niche OVA', extKind: 'tvdb' as const, extId: '999002', sizeBytes: Math.round(3.5 * GB) },
  { source: 'radarr', instanceId: RADARR_MAIN.id, instanceName: 'Radarr', title: 'Unreleased Indie Film', extKind: 'tmdb' as const, extId: '999003', sizeBytes: Math.round(8 * GB) },
  { source: 'radarr', instanceId: RADARR_MAIN.id, instanceName: 'Radarr', title: 'Festival Short', extKind: 'tmdb' as const, extId: '999004', sizeBytes: Math.round(0.9 * GB) },
];

export interface SeedResult {
  seededMedia: boolean;
  totalItems: number;
  totalBytes: number;
}

/**
 * Idempotent: configures fake connections + dev user every run, and seeds media
 * (+ keeps/skips/history) only when the library is empty so your toggles survive
 * a reseed. Pass `{ reset: true }` after clearing tables for a fresh load.
 */
export function seedDevData(opts: { reset?: boolean } = {}): SeedResult {
  // A fake "connected server" so the pages render (dummy values; the image proxy
  // simply 503s and cards show titles).
  writeSetting('plex_machine_id', 'dev-machine');
  writeSetting('plex_base_url', 'http://localhost:32400');
  writeSetting('plex_server_token', 'dev-token');
  writeSetting('plex_server_name', 'Dev Server');
  writeSetting('plex_owner_id', DEV_USER_ID);

  // Demo a non-Plex backend with `KEEPARR_DEV_SERVER=jellyfin|emby npm run seed`.
  // Reuses the seeded media (ids/guids/keeps all work the same); watch comes
  // "native" (the seeded watch_history rows stand in). Default = Plex.
  const devServer = process.env.KEEPARR_DEV_SERVER as MediaServerType | undefined;
  if (devServer === 'jellyfin' || devServer === 'emby') {
    setMediaServerType(devServer);
    setServerField(devServer, 'url', 'http://localhost:8096');
    setServerField(devServer, 'token', 'dev-mediaserver-token');
    setServerField(devServer, 'id', 'dev-mediaserver');
    setServerField(devServer, 'name', devServer === 'emby' ? 'Dev Emby' : 'Dev Jellyfin');
    setServerField(devServer, 'ownerId', DEV_USER_ID);
    setServerField(devServer, 'adminToken', 'dev-mediaserver-token');
  } else {
    setMediaServerType('plex');
  }
  // Fake Tautulli so the watch surfaces (Browse "Watched" filter, the watched
  // badge, Big Picture "never watched") are visible in the demo. No real calls
  // are made — the seeded watch_history rows below stand in for synced history.
  writeSetting('tautulli_url', 'http://localhost:8181');
  writeSetting('tautulli_api_key', 'dev-tautulli-key');
  // Fake Seerr so the "OK to delete" surfaces (the requester sign-off control,
  // its Browse filters, and the Big Picture KPI/drill-down) are demoable. No real
  // calls are made — the seeded seerr_requests below stand in for synced requests.
  writeSetting('seerr_url', 'http://localhost:5055');
  writeSetting('seerr_api_key', 'dev-seerr-key');
  // Fake Sonarr (×2: main + anime) and Radarr so the Quality view + N-instance
  // filters are demoable. No real calls are made; arr_items is seeded below.
  setSonarrInstances([
    { ...SONARR_MAIN, url: 'http://localhost:8989', apiKey: 'dev-sonarr-key' },
    { ...SONARR_ANIME, url: 'http://localhost:8990', apiKey: 'dev-sonarr-anime-key' },
  ]);
  setRadarrInstances([
    { ...RADARR_MAIN, url: 'http://localhost:7878', apiKey: 'dev-radarr-key' },
  ]);
  setPlexSections(SECTIONS.map((s) => ({ ...s, paths: [`/media/${s.title}`] })));
  setManagedSectionIds([]); // all libraries managed
  setOpenSignin(true);
  setAppTitle('Keeparr');
  // Map each library to a path so the storage report is "configured"; the actual
  // free/total comes from the synthetic dev_storage_total set below (no real disk).
  setStorageMappings(SECTIONS.map((s) => ({ sectionId: s.id, path: `/media/${s.title}` })));

  // Owner + a couple of accounts so the Users screen has rows to toggle.
  upsertUser({
    plexUserId: DEV_USER_ID,
    username: 'dev-user',
    email: 'dev@example.com',
    thumb: null,
    isAdmin: DEV_USER_IS_ADMIN,
  });
  upsertUser({ plexUserId: 'dev-friend', username: 'friend', email: 'friend@example.com', thumb: null, isAdmin: false });
  upsertUser({ plexUserId: 'dev-kid', username: 'kid', email: null, thumb: null, isAdmin: false });

  const seededMedia = opts.reset || libraryStats().totalItems === 0;
  if (seededMedia) {
    const mediaItems = buildItems();
    const seedTs = Math.floor(Date.now() / 1000);
    upsertMediaBatch(mediaItems, seedTs);
    replaceArrItems(buildArrItems(mediaItems));
    replaceArrUnmatched(ARR_UNMATCHED);

    // --- Problems-page demo rows (mismatch/notInArr/unmatched/missingIds are
    // already covered by the modular seeding above) ---
    // Duplicates: re-import an existing movie + show under new rating keys but
    // the SAME external ids, so the Duplicates check groups them.
    const dupMovieSrc = mediaItems.find((m) => m.libraryKind === 'movie' && m.guidTmdb)!;
    const dupShowSrc = mediaItems.find((m) => m.libraryKind === 'show' && m.guidTvdb)!;
    upsertMediaBatch(
      [
        { ...dupMovieSrc, ratingKey: 'dev-dup-movie', sectionId: '2', sizeBytes: Math.round(48 * GB) },
        { ...dupShowSrc, ratingKey: 'dev-dup-show', sizeBytes: Math.round(0.8 * dupShowSrc.sizeBytes) },
        // Zero size: the server lists it but reports no file bytes.
        {
          ratingKey: 'dev-zero-1',
          sectionId: '1',
          libraryKind: 'movie',
          title: 'Corrupted Import Demo',
          year: 2024,
          thumb: null,
          sizeBytes: 0,
          addedAt: seedTs - 3 * 86400,
          guidTmdb: '990001',
          guidTvdb: null,
        },
      ],
      seedTs
    );
    // Removed but kept: seed it slightly "older", keep it, then tombstone it —
    // the same path a real deletion takes (full sync tombstones stale rows).
    upsertMediaBatch(
      [
        {
          ratingKey: 'dev-removed-1',
          sectionId: '3',
          libraryKind: 'show',
          title: 'Deleted Anyway',
          year: 2019,
          thumb: null,
          sizeBytes: Math.round(64 * GB),
          addedAt: seedTs - 400 * 86400,
          guidTmdb: null,
          guidTvdb: '990002',
        },
      ],
      seedTs - 100
    );
    addKeep('dev-friend', 'dev-removed-1');
    tombstoneStale(seedTs - 50);
    // Disk orphans: fake scan results so the "On disk, in neither" pill/table
    // demo offline (no real filesystem walk happens in the seed).
    replaceDiskOrphansForSection('3', [
      {
        name: 'Cancelled Show (2017)',
        path: '/media/TV Shows/Cancelled Show (2017)',
        isDir: true,
        sizeBytes: Math.round(18 * GB),
        sizeSkipped: false,
        mtime: seedTs - 90 * 86400,
      },
      {
        name: 'random-rip-backup',
        path: '/media/TV Shows/random-rip-backup',
        isDir: true,
        sizeBytes: Math.round(2.4 * GB),
        sizeSkipped: false,
        mtime: seedTs - 30 * 86400,
      },
    ]);
    replaceDiskOrphansForSection('1', [
      {
        name: 'Some.Movie.2019.1080p.WEB-DL.mkv',
        path: '/media/Movies/Some.Movie.2019.1080p.WEB-DL.mkv',
        isDir: false,
        sizeBytes: Math.round(4.2 * GB),
        sizeSkipped: false,
        mtime: seedTs - 200 * 86400,
      },
    ]);

    // Cross-instance conflict: both Sonarr instances manage the first anime
    // title; the Anime instance won the match (it owns the arr_items row).
    const conflictSrc = mediaItems.find((m) => m.sectionId === '4')!;
    replaceArrConflicts([
      {
        ratingKey: conflictSrc.ratingKey,
        title: conflictSrc.title,
        firstSource: 'sonarr',
        firstInstanceId: SONARR_ANIME.id,
        firstInstanceName: SONARR_ANIME.name,
        source: 'sonarr',
        instanceId: SONARR_MAIN.id,
        instanceName: SONARR_MAIN.name,
        sizeOnDisk: conflictSrc.sizeBytes,
      },
    ]);

    addKeep(DEV_USER_ID, 'dev-1');
    addKeep(DEV_USER_ID, 'dev-210');

    // Keeps by OTHER users (friend/kid), spread across every library and biased
    // toward large TV/4K titles, so "Kept by others" is clearly visible on the
    // graphs. None of these are also kept by the dev user (so they count as
    // others', not yours). Keys: dev-1..100 = Movies (every 3rd is 4K, larger),
    // dev-101..200 = TV Shows (largest), dev-201..300 = Anime.
    const keptByFriend = [
      'dev-102', 'dev-106', 'dev-111', 'dev-119', 'dev-127', 'dev-134', // TV Shows
      'dev-205', 'dev-212', 'dev-230', 'dev-248', // Anime
      'dev-7', 'dev-13', 'dev-22', // 4K Movies (large)
      'dev-12', 'dev-35', 'dev-50', // Movies
    ];
    const keptByKid = [
      'dev-104', 'dev-115', 'dev-122', 'dev-140', 'dev-160', // TV Shows
      'dev-220', 'dev-260', // Anime
      'dev-10', 'dev-19', // 4K Movies (large)
      'dev-44', // Movies
    ];
    for (const rk of keptByFriend) addKeep('dev-friend', rk);
    for (const rk of keptByKid) addKeep('dev-kid', rk);

    addSkip(DEV_USER_ID, 'dev-3');
    addSkip(DEV_USER_ID, 'dev-120');

    // Watch history with now-relative timestamps so the Browse "Watched" windows
    // (≤30/60/90d, stale 90d+) are demoable. Most titles stay unwatched so the
    // Big Picture "never watched by anyone" metric is meaningful.
    const wnow = Math.floor(Date.now() / 1000);
    const dago = (d: number) => wnow - d * 86400;
    upsertWatchBatch([
      // You — watched recently (hits ≤30/60/90)
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-101', plays: 8, lastWatched: dago(6) },
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-205', plays: 20, lastWatched: dago(12) },
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-1', plays: 1, lastWatched: dago(20) },
      // You — watched a couple months ago (hits ≤90 only)
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-110', plays: 12, lastWatched: dago(75) },
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-115', plays: 5, lastWatched: dago(82) },
      // You — watched long ago (stale: not watched in 90+ days)
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-150', plays: 2, lastWatched: dago(210) },
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-30', plays: 1, lastWatched: dago(260) },
      // Someone else watched it (you didn't) — proves "watched by anyone" so this
      // is excluded from "never watched", but absent from YOUR watched filter.
      { plexUserId: 'dev-friend', ratingKey: 'dev-160', plays: 4, lastWatched: dago(40) },
    ]);
    // Seerr requests per user — the gate for "OK to delete". Spread across
    // people so the by-anyone view + attribution have variety. dev-300 is
    // requested by both friend and kid so it ends up with multiple markers.
    // Also request a few of the VERY largest titles, spaced so the "Largest"
    // feed shows an "OK to delete" card in every visible row (~7/row at 1080,
    // ~11/row at 4K → these positions cover rows 1–3 at both widths).
    const bySize = [...mediaItems].sort((a, b) => b.sizeBytes - a.sizeBytes);
    const largestDemoRequests = [0, 5, 9, 13, 18, 24, 30]
      .map((i) => bySize[i]?.ratingKey)
      .filter((rk): rk is string => !!rk);
    replaceSeerrRequests(DEV_USER_ID, [
      ...new Set([
        'dev-2', 'dev-12', 'dev-30', 'dev-50', 'dev-160', 'dev-205',
        ...largestDemoRequests,
      ]),
    ]);
    replaceSeerrRequests('dev-friend', ['dev-50', 'dev-106', 'dev-300']);
    replaceSeerrRequests('dev-kid', ['dev-300']);

    // "OK to delete" marks (the original requester signing off). Each marker
    // must have requested the title (above) and must not also keep it.
    //  - dev-12 is kept by friend → demos "released but still protected".
    //  - dev-300 is released by BOTH friend and kid → multiple markers.
    addDelete(DEV_USER_ID, 'dev-12');
    addDelete(DEV_USER_ID, 'dev-30');
    addDelete('dev-friend', 'dev-300');
    addDelete('dev-kid', 'dev-300');
  }

  // Synthetic storage capacity so the header shows ~75% full.
  const stats = libraryStats();
  writeSetting('dev_storage_total', String(Math.round(stats.totalBytes / 0.75)));

  // Job history so the scheduled-jobs + activity views aren't empty. Last-status
  // per job drives the Scheduled jobs list.
  const nowSec = Math.floor(Date.now() / 1000);
  const jobStates: [string, 'ok', string, number][] = [
    ['recentlyAdded', 'ok', 'Synced 2 new items.', 2],
    ['library', 'ok', `Synced ${stats.totalItems} items.`, stats.totalItems],
    ['sizes', 'ok', 'Recomputed sizes for 96 series.', 96],
    ['watch', 'ok', 'Refreshed 8 watch-history rows.', 8],
    ['requests', 'ok', 'Cached Seerr requests for 1 user(s).', 1],
    ['arr', 'ok', 'Matched 300 of 300 titles (0 unmatched).', 300],
    ['diskScan', 'ok', 'Found 3 orphaned item(s) (24.60 GB) across 4 mapped root(s).', 3],
  ];
  for (const [jobId, status, msg, result] of jobStates) {
    setJobState(jobId, {
      lastStatus: status,
      lastRun: nowSec - 300,
      lastMessage: msg,
      lastDurationMs: 1500,
      lastResult: result,
    });
  }

  // Run history: a flood of recentlyAdded successes (these collapse to one
  // expandable row) + one error + the daily jobs, so the Recent activity
  // grouping is demoable rather than wall-to-wall identical rows.
  const runs: {
    jobId: string;
    startedAt: number;
    status: 'ok' | 'error';
    message: string;
    result: number;
  }[] = [];
  for (let i = 1; i <= 12; i++) {
    runs.push({
      jobId: 'recentlyAdded',
      startedAt: nowSec - i * 300,
      status: 'ok',
      message: `Synced ${i % 3} new items.`,
      result: i % 3,
    });
  }
  runs.push({ jobId: 'recentlyAdded', startedAt: nowSec - 13 * 300, status: 'error', message: 'Plex unreachable — fetch failed.', result: 0 });
  runs.push({ jobId: 'arr', startedAt: nowSec - 4000, status: 'ok', message: 'Matched 300 of 300 titles (0 unmatched).', result: 300 });
  runs.push({ jobId: 'sizes', startedAt: nowSec - 7000, status: 'ok', message: 'Recomputed sizes for 96 series.', result: 96 });
  runs.push({ jobId: 'watch', startedAt: nowSec - 9000, status: 'ok', message: 'Refreshed 8 watch-history rows.', result: 8 });
  runs.push({ jobId: 'requests', startedAt: nowSec - 11000, status: 'ok', message: 'Cached Seerr requests for 1 user(s).', result: 1 });
  runs.push({ jobId: 'library', startedAt: nowSec - 13000, status: 'ok', message: `Synced ${stats.totalItems} items.`, result: stats.totalItems });
  runs.push({ jobId: 'diskScan', startedAt: nowSec - 15000, status: 'ok', message: 'Found 3 orphaned item(s) (24.60 GB) across 4 mapped root(s).', result: 3 });
  for (const r of runs) {
    recordJobRun({
      jobId: r.jobId,
      startedAt: r.startedAt,
      endedAt: r.startedAt + 2,
      status: r.status,
      message: r.message,
      durationMs: 1500,
      result: r.result,
    });
  }

  return {
    seededMedia,
    totalItems: stats.totalItems,
    totalBytes: stats.totalBytes,
  };
}
