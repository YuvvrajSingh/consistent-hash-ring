import crypto from 'node:crypto';
import type { HashAlgorithm } from './types.js';

export type HashFunction = (val: string | number) => number;

/**
 * 32-bit MurmurHash3 implementation operating on UTF-8 bytes.
 * Returns an unsigned 32-bit integer in the range [0, 2^32 - 1].
 */
export function murmurHash3(key: string, seed = 0): number {
  let h1 = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const bytes = Buffer.from(key, 'utf8');
  const remainder = bytes.length & 3;
  const words = Math.floor(bytes.length / 4);

  for (let i = 0; i < words; i++) {
    let k1 = bytes.readUInt32LE(i * 4);
    k1 = Math.imul(k1, c1) >>> 0;
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2) >>> 0;

    h1 ^= k1;
    h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }

  let k1 = 0;
  if (remainder === 3) {
    k1 ^= bytes[words * 4 + 2] << 16;
  }
  if (remainder >= 2) {
    k1 ^= bytes[words * 4 + 1] << 8;
  }
  if (remainder >= 1) {
    k1 ^= bytes[words * 4];
    k1 = Math.imul(k1, c1) >>> 0;
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2) >>> 0;
    h1 ^= k1;
  }

  h1 ^= bytes.length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b) >>> 0;
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35) >>> 0;
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/**
 * Computes a deterministic 32-bit unsigned integer hash for any string or number.
 * Output is in the range [0, 2^32 - 1].
 *
 * @param val - The value to hash (string or number).
 * @param algorithm - Hash algorithm ('md5', 'sha256', or 'murmur3'). Defaults to 'md5'.
 * @returns 32-bit unsigned integer hash token.
 */
export function hashKey(val: string | number, algorithm: HashAlgorithm = 'md5'): number {
  const input = typeof val === 'string' ? val : String(val);

  if (algorithm === 'murmur3') {
    return murmurHash3(input);
  }

  const digest = crypto.createHash(algorithm).update(input).digest();
  return digest.readUInt32BE(0);
}

/**
 * Returns a bound hash function using the configured algorithm.
 */
export function createHasher(algorithm: HashAlgorithm = 'md5'): HashFunction {
  return (val: string | number) => hashKey(val, algorithm);
}
