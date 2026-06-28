import { getSetting, setSetting } from './queries';
import { decryptSecret, encryptSecret } from './crypto';
import {
  DEFAULT_JOB_SCHEDULES,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  type JobSchedule,
} from './config';

/**
 * Typed accessors over the settings key/value table. Token fields are encrypted
 * at rest. Keep all setting keys defined here so callers never use raw strings.
 */

// Keys whose values are secrets (encrypted before storage).
const SECRET_KEYS = new Set([
  'plex_admin_token',
  'plex_server_token',
  'tautulli_api_key',
  'seerr_api_key',
  'api_key',
]);

export function readSetting(key: string): string | null {
  const raw = getSetting(key);
  if (raw == null) return null;
  return SECRET_KEYS.has(key) ? decryptSecret(raw) : raw;
}

export function writeSetting(key: string, value: string): void {
  setSetting(key, SECRET_KEYS.has(key) ? encryptSecret(value) : value);
}

// --- Plex ---
export const getOwnerId = () => readSetting('plex_owner_id');
export const getAdminToken = () => readSetting('plex_admin_token');
export const getMachineId = () => readSetting('plex_machine_id');
export const getPlexBaseUrl = () => readSetting('plex_base_url');
export const getServerToken = () => readSetting('plex_server_token');

/** True once an admin has connected a Plex server. */
export const isServerConfigured = () =>
  !!getMachineId() && !!getPlexBaseUrl() && !!getServerToken();

// --- Tautulli ---
export const getTautulliUrl = () => readSetting('tautulli_url');
export const getTautulliKey = () => readSetting('tautulli_api_key');
export const isTautulliConfigured = () =>
  !!getTautulliUrl() && !!getTautulliKey();

// --- Seerr ---
export const getSeerrUrl = () => readSetting('seerr_url');
export const getSeerrKey = () => readSetting('seerr_api_key');
export const isSeerrConfigured = () => !!getSeerrUrl() && !!getSeerrKey();

// --- Sync ---
export function getSyncIntervalMinutes(): number {
  const v = Number(readSetting('sync_interval_minutes'));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SYNC_INTERVAL_MINUTES;
}

// --- Scheduled job schedules (per job: interval minutes or daily HH:MM) ---
export type { JobSchedule };

export function getJobSchedules(): Record<string, JobSchedule> {
  const out: Record<string, JobSchedule> = { ...DEFAULT_JOB_SCHEDULES };
  const raw = readSetting('job_schedules');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, JobSchedule>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && (v.type === 'interval' || v.type === 'daily')) out[k] = v;
      }
    } catch {
      /* fall back to defaults */
    }
  }
  return out;
}

export function setJobSchedules(schedules: Record<string, JobSchedule>): void {
  writeSetting('job_schedules', JSON.stringify({ ...getJobSchedules(), ...schedules }));
}

// --- Public app URL (Plex auth forwardUrl); overrides the APP_URL env var ---
export const getAppUrl = () => readSetting('app_url') ?? '';
export const setAppUrl = (url: string) => writeSetting('app_url', url.trim());

// --- Plex sections (captured during sync; drives the library lists + storage) ---
export interface StoredSection {
  id: string;
  title: string;
  type: string;
  /** On-disk folder(s) Plex reports for this library (server-side paths). */
  paths?: string[];
}

export function getPlexSections(): StoredSection[] {
  const raw = readSetting('plex_sections');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Back-compat: older rows lack `paths`.
    return (arr as StoredSection[]).map((s) => ({ paths: [], ...s }));
  } catch {
    return [];
  }
}

// --- Storage mappings (section id -> container path to measure free space) ---
export interface StoredStorageMapping {
  sectionId: string;
  path: string;
}

export function getStorageMappings(): StoredStorageMapping[] {
  const raw = readSetting('storage_mappings');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as StoredStorageMapping[]) : [];
  } catch {
    return [];
  }
}

export function setStorageMappings(mappings: StoredStorageMapping[]): void {
  writeSetting('storage_mappings', JSON.stringify(mappings));
}

export function setPlexSections(sections: StoredSection[]): void {
  writeSetting('plex_sections', JSON.stringify(sections));
}

// --- Managed libraries (which Plex sections Keeparr tracks; empty = all) ---
export function getManagedSectionIds(): string[] {
  const raw = readSetting('managed_section_ids');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

export function setManagedSectionIds(ids: string[]): void {
  writeSetting('managed_section_ids', JSON.stringify(ids));
}

/** Discovered sections, filtered to the managed set (all when none chosen). */
export function getManagedSections(): StoredSection[] {
  const managed = new Set(getManagedSectionIds());
  const all = getPlexSections();
  return managed.size === 0 ? all : all.filter((s) => managed.has(s.id));
}

// --- Access control ---
/** Whether any Plex user with server access may sign in (vs only enabled users). */
export function getOpenSignin(): boolean {
  return readSetting('open_signin') !== 'false'; // default: open
}

export function setOpenSignin(open: boolean): void {
  writeSetting('open_signin', open ? 'true' : 'false');
}

// --- API key (for external automation; encrypted at rest) ---
export const getApiKey = () => readSetting('api_key');
export const setApiKey = (key: string) => writeSetting('api_key', key);
export const isApiKeyConfigured = () => !!getApiKey();

// --- Local demo (set only by the dev seed; synthetic storage capacity) ---
export function getDevStorageTotal(): number | null {
  const v = Number(readSetting('dev_storage_total'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

// --- Branding ---
export function getAppTitle(): string {
  const t = readSetting('app_title');
  return t && t.trim() ? t.trim() : 'Keeparr';
}

export function setAppTitle(title: string): void {
  writeSetting('app_title', title.trim());
}
