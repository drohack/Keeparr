/**
 * Edge-safe constants shared by middleware (dev auto-login) and the dev seed.
 * Must not import anything Node-only (no better-sqlite3, etc.).
 */
export const DEV_USER_ID = 'dev-user';
