const HEX = Array.from({ length: 256 }, (_, byte) =>
  byte.toString(16).padStart(2, "0"),
);

// Bytes from the platform's random source, drawn 4 KiB at a time: one call
// per ID would cost more than the rest of an event.
const pool = new Uint8Array(4096);
let offset = pool.length;

/**
 * `bytes` random bytes from the platform's random source, as lowercase hex.
 * Never all zeros, which W3C trace context forbids.
 */
export function randomHex(bytes: number): string {
  if (offset + bytes > pool.length) {
    crypto.getRandomValues(pool);
    offset = 0;
  }
  let hex = "";
  let zero = true;
  for (let index = offset; index < offset + bytes; index += 1) {
    const value = pool[index]!;
    hex += HEX[value];
    if (value !== 0) zero = false;
  }
  offset += bytes;
  return zero ? randomHex(bytes) : hex;
}
