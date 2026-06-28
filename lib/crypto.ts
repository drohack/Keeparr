import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { SESSION_SECRET } from './config';

/**
 * Symmetric encryption for service tokens (Plex/Tautulli/Seerr) stored in the
 * settings table. The key is derived from SESSION_SECRET, so rotating the
 * secret invalidates stored tokens (admin must re-enter them) — acceptable for
 * a self-hosted single-tenant app. Node-only (uses node:crypto).
 */

const KEY = createHash('sha256').update(SESSION_SECRET).digest(); // 32 bytes
const PREFIX = 'enc:v1:';

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(
      '.'
    )
  );
}

export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) {
    // Tolerate plaintext (e.g. legacy / manual edits) rather than throwing.
    return stored;
  }
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split('.');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8'
    );
  } catch {
    // Wrong key (e.g. SESSION_SECRET rotated) or corrupt value: treat as unset
    // rather than crashing every page that reads a secret.
    return null;
  }
}
