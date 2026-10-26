import { describe, expect, it } from "vitest";
import {
  BYTES_WORK_BUDGET,
  SecretBytesRedaction,
  secretEchoForms,
} from "../secret-redaction.ts";

/*
 * The redaction of a whole answer, as the credential broker scrubs one
 * before a plugin reads it: every secret in the forms a service may echo it
 * in, found in one pass over the bytes, within a work budget.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function redacted(secrets: readonly string[], text: string) {
  const redaction = new SecretBytesRedaction(secrets.flatMap(secretEchoForms));
  const result = redaction.bytes(encoder.encode(text));
  return result === undefined ? undefined : decoder.decode(result);
}

const TOKEN = "tok-9f2c1e/7a+b=Q";
const ADDRESS =
  "webcal://calendar.example.org/private-abc123/basic.ics?a=1&token=s3cr3t";

describe("the forms a secret is echoed in", () => {
  it.each([
    ["as it is", TOKEN],
    ["URL-encoded", encodeURIComponent(TOKEN)],
    [
      "URL-encoded with lowercase hex",
      encodeURIComponent(TOKEN).replace(/%[0-9A-F]{2}/g, (hex) =>
        hex.toLowerCase(),
      ),
    ],
    ["JSON-escaped", JSON.stringify(TOKEN).slice(1, -1).replaceAll("/", "\\/")],
    ["in base64", Buffer.from(TOKEN).toString("base64")],
    ["in base64 without padding", Buffer.from(TOKEN).toString("base64url")],
  ])("%s", (_name, echo) => {
    expect(redacted([TOKEN], `<${echo}>`)).toBe("<[secret]>");
  });

  // The scheme, which tells nothing, stays outside the mark.
  it.each([
    ["whole", ADDRESS, "[secret]"],
    [
      "as https",
      "https://calendar.example.org/private-abc123/basic.ics?a=1&token=s3cr3t",
      "https://[secret]",
    ],
    [
      "without its scheme",
      "calendar.example.org/private-abc123/basic.ics?a=1&token=s3cr3t",
      "[secret]",
    ],
    [
      "by its path and query",
      "Cannot GET /private-abc123/basic.ics?a=1&token=s3cr3t",
      "Cannot GET [secret]",
    ],
    [
      "HTML-escaped",
      "https://calendar.example.org/private-abc123/basic.ics?a=1&amp;token=s3cr3t",
      "https://[secret]",
    ],
    [
      "with an uppercase host",
      "HTTPS://CALENDAR.EXAMPLE.ORG/private-abc123/basic.ics?a=1&token=s3cr3t",
      "HTTPS://[secret]",
    ],
    [
      "JSON-escaped, & as \\u0026",
      "https:\\/\\/calendar.example.org\\/private-abc123\\/basic.ics?a=1\\u0026token=s3cr3t",
      "https:\\/\\/[secret]",
    ],
    [
      "URL-encoded",
      encodeURIComponent(
        "https://calendar.example.org/private-abc123/basic.ics?a=1&token=s3cr3t",
      ),
      "https%3A%2F%2F[secret]",
    ],
    [
      "in base64",
      Buffer.from(
        "https://calendar.example.org/private-abc123/basic.ics?a=1&token=s3cr3t",
      ).toString("base64"),
      "[secret]",
    ],
    [
      "by a path segment that isn't a word",
      "id private-abc123.",
      "id [secret].",
    ],
    ["by a credential's query value", "token=s3cr3t", "token=[secret]"],
    [
      "but not by a word of it",
      "basic.ics on calendar.example.org, a=1",
      "basic.ics on calendar.example.org, a=1",
    ],
  ])("an address %s", (_name, echo, expected) => {
    expect(redacted([ADDRESS], echo)).toBe(expected);
  });
});

describe("redacting bytes", () => {
  it("replaces secrets that overlap or touch as one", () => {
    expect(redacted(["abc123", "123xyz9"], "-abc123xyz9-")).toBe("-[secret]-");
    expect(redacted(["abc123", "xyz789"], "abc123xyz789")).toBe("[secret]");
  });

  it("finds a secret HTML-escaped", () => {
    expect(redacted(['p&ss<w0rd>"1'], 'v="p&amp;ss&lt;w0rd&gt;&quot;1"')).toBe(
      'v="[secret]"',
    );
  });

  it("matches ASCII letters in any case, and leaves other bytes as they are", () => {
    expect(redacted(["Secret-Token-1"], "é SECRET-TOKEN-1 ü")).toBe(
      "é [secret] ü",
    );
  });

  it("hands back the same bytes when nothing matches", () => {
    const redaction = new SecretBytesRedaction(secretEchoForms(TOKEN));
    const body = encoder.encode("nothing to see");
    expect(redaction.bytes(body)).toBe(body);
    expect(redaction.holdsSecret("nothing")).toBe(false);
    expect(redaction.holdsSecret(`x${TOKEN}`)).toBe(true);
  });

  it("checks nothing past its budget, so a caller can refuse the answer", () => {
    const small = new SecretBytesRedaction(secretEchoForms(TOKEN), {
      budget: 1_000,
    });
    expect(small.bytes(new Uint8Array(2_000))).toBeUndefined();
    // Spent: even a small answer is unchecked from then on.
    expect(small.bytes(new Uint8Array(1))).toBeUndefined();
    expect(small.holdsSecret("x")).toBeUndefined();
  });

  it("checks nothing when its forms are too large to hold", () => {
    const huge = new SecretBytesRedaction(secretEchoForms(TOKEN), {
      maxFormBytes: 100,
    });
    expect(huge.empty).toBe(false);
    expect(huge.bytes(encoder.encode("nothing"))).toBeUndefined();
    expect(huge.holdsSecret("nothing")).toBeUndefined();
  });

  it("checks an 8 MB answer full of matches within its budget, quickly", () => {
    const secrets = [
      TOKEN,
      ADDRESS,
      "https://cdn1.example.net/signed/Zx81kQ-77/feed.ics?sig=0f9e8d7c6b5a",
      "https://cdn2.example.net/signed/Qw90pL-12/feed.ics?sig=1a2b3c4d5e6f",
      "https://cdn3.example.net/signed/Er45tY-34/feed.ics?sig=9z8y7x6w5v4u",
    ];
    const redaction = new SecretBytesRedaction(
      secrets.flatMap(secretEchoForms),
    );
    const unit = `${TOKEN} ${encodeURIComponent(ADDRESS)} `;
    const body = encoder.encode(
      unit.repeat(Math.floor((8 << 20) / unit.length)),
    );

    const started = performance.now();
    const result = redaction.bytes(body);
    const elapsed = performance.now() - started;

    expect(body.byteLength).toBeLessThan(BYTES_WORK_BUDGET);
    expect(result).toBeDefined();
    const text = decoder.decode(result);
    expect(text.startsWith("[secret] [secret] [secret]")).toBe(true);
    expect(text).not.toContain("tok-9f2c1e");
    expect(text).not.toContain("private-abc123");
    // A few tens of milliseconds on a laptop; the bound leaves room for a
    // slow machine.
    expect(elapsed).toBeLessThan(2_000);
  });
});
