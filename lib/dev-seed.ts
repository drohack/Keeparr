/**
 * Local development seed. Populates the SQLite DB with realistic fake data so you
 * can click through the whole app with no Plex/Tautulli/Seerr. Invoked by the
 * `npm run seed` script (scripts/seed.ts). Safe to delete if unwanted — it only
 * runs when you call it. Pairs with `KEEPARR_DEV_LOGIN=1` (middleware auto-login).
 */
import {
  addKeep,
  addSkip,
  libraryStats,
  recordJobRun,
  replaceSeerrRequests,
  setJobState,
  upsertMediaBatch,
  upsertUser,
  upsertWatchBatch,
  type UpsertMediaInput,
} from './queries';
import {
  setAppTitle,
  setManagedSectionIds,
  setOpenSignin,
  setPlexSections,
  setStorageMappings,
  writeSetting,
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
      guidTmdb: null,
      guidTvdb: null,
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
    upsertMediaBatch(buildItems(), Math.floor(Date.now() / 1000));

    addKeep(DEV_USER_ID, 'dev-1');
    addKeep('dev-friend', 'dev-50');
    addKeep(DEV_USER_ID, 'dev-210');
    addSkip(DEV_USER_ID, 'dev-3');
    addSkip(DEV_USER_ID, 'dev-120');
    upsertWatchBatch([
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-110', plays: 12, lastWatched: 1_700_000_000 },
      { plexUserId: DEV_USER_ID, ratingKey: 'dev-115', plays: 5, lastWatched: 1_699_900_000 },
    ]);
    replaceSeerrRequests(DEV_USER_ID, ['dev-2', 'dev-205']);
  }

  // Synthetic storage capacity so the header shows ~75% full.
  const stats = libraryStats();
  writeSetting('dev_storage_total', String(Math.round(stats.totalBytes / 0.75)));

  // A little job history so the scheduled-jobs + activity views aren't empty.
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [jobId, msg, result] of [
    ['library', `Synced ${stats.totalItems} items.`, stats.totalItems],
    ['requests', 'Cached Seerr requests for 1 user(s).', 1],
  ] as const) {
    setJobState(jobId, {
      lastStatus: 'ok',
      lastRun: nowSec - 300,
      lastMessage: msg,
      lastDurationMs: 1500,
      lastResult: result,
    });
    recordJobRun({
      jobId, startedAt: nowSec - 302, endedAt: nowSec - 300,
      status: 'ok', message: msg, durationMs: 1500, result,
    });
  }

  return {
    seededMedia,
    totalItems: stats.totalItems,
    totalBytes: stats.totalBytes,
  };
}
