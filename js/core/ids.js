/**
 * MemoryOS — core/ids.js
 *
 * UUIDv7 generation (RFC 9562).
 *
 * Why UUIDv7 and not v4: the first 48 bits are a millisecond Unix
 * timestamp, so IDs sort chronologically by default — a natural fit for
 * an app whose core metaphor is a timeline — and they remain globally
 * unique, which makes future multi-device sync collision-free.
 *
 * Layout (128 bits):
 *   unix_ts_ms (48) | ver=7 (4) | rand_a (12) | var=10 (2) | rand_b (62)
 */

const HEX = "0123456789abcdef";

/** Monotonicity state (RFC 9562 §6.2, Method 3): a 12-bit counter in
 *  rand_a guarantees that IDs minted within the SAME millisecond still
 *  sort strictly — important because the whole point of UUIDv7 here is
 *  "IDs sort chronologically". We also never let the clock appear to
 *  run backwards (e.g. NTP adjustments). */
let lastTimestamp = 0;
let counter = 0;

/**
 * Generate a UUIDv7 string. Strictly increasing within this process.
 * @param {number} [now] Optional ms timestamp (injectable for tests).
 * @returns {string} e.g. "0190d2f0-5a3c-7d1e-8f00-3a5b9c1d2e4f"
 */
export function uuidv7(now = Date.now()) {
  if (now <= lastTimestamp) {
    now = lastTimestamp;
    counter++;
    if (counter > 0x0fff) {
      // Counter exhausted within one ms: roll into the next ms.
      now = ++lastTimestamp;
      counter = randomCounterSeed();
    }
  } else {
    lastTimestamp = now;
    counter = randomCounterSeed();
  }

  const bytes = new Uint8Array(16);

  // 48-bit big-endian timestamp.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // rand_a (12 bits) = monotonic counter; rand_b (62 bits) = random.
  bytes[6] = (counter >> 8) & 0x0f;
  bytes[7] = counter & 0xff;
  fillRandom(bytes, 8);

  // Version (0b0111) and variant (0b10).
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return format(bytes);
}

/** Seed the per-millisecond counter randomly in the lower half of its
 *  range, leaving headroom to increment (RFC 9562 §6.2 guidance). */
function randomCounterSeed() {
  const buf = new Uint8Array(2);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && cryptoObj.getRandomValues) cryptoObj.getRandomValues(buf);
  else { buf[0] = Math.random() * 256; buf[1] = Math.random() * 256; }
  return ((buf[0] << 8) | buf[1]) & 0x07ff; // 0..2047 of 0..4095
}

/**
 * Extract the creation Date encoded in a UUIDv7.
 * Useful for debugging and for sync conflict diagnostics later.
 * @param {string} id
 * @returns {Date}
 */
export function timestampOf(id) {
  const hex = id.replace(/-/g, "").slice(0, 12);
  return new Date(parseInt(hex, 16));
}

/** @param {Uint8Array} bytes @param {number} from */
function fillRandom(bytes, from) {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    cryptoObj.getRandomValues(bytes.subarray(from));
  } else {
    // Extremely defensive fallback; every modern browser has WebCrypto.
    for (let i = from; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
}

/** @param {Uint8Array} b */
function format(b) {
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[b[i] >> 4] + HEX[b[i] & 0x0f];
  }
  return out;
}
