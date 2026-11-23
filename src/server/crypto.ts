/** AES-256-GCM encryption for credential secrets at rest. */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ALGORITHM = 'aes-256-gcm';

/** Use ENCRYPTION_KEY when set; otherwise keep a local dev key alongside the DB. */
export function resolveEncryptionKey(keyPath: string): Buffer {
  if (process.env.ENCRYPTION_KEY) {
    return createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
  }
  if (existsSync(keyPath)) {
    return Buffer.from(readFileSync(keyPath, 'utf-8').trim(), 'base64');
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 });
  return key;
}

export function encrypt(plainText: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decrypt(payload: string, key: Buffer): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed encrypted credential payload');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivPart, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
