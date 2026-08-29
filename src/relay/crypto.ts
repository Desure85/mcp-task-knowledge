/**
 * relay/crypto.ts — AES-256-GCM wire encryption for LAN Relay (BM-012)
 *
 * Same primitives as src/core/secret-manager.ts but with an explicit key
 * parameter (the relay uses a shared peer key from env, not the local
 * master key). Wire format: base64(iv).base64(authTag).base64(ciphertext).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const SALT = 'mcp-task-knowledge-relay-v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

/** Derive a 256-bit key from a shared passphrase. */
export function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, SALT, KEY_LENGTH);
}

/** Encrypt plaintext with AES-256-GCM; returns iv.authTag.ciphertext (base64). */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

/** Decrypt iv.authTag.ciphertext; throws on tamper (GCM auth failure). */
export function decrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('invalid ciphertext format');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
