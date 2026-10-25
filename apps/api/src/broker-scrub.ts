/*
 * What the broker removes from an answer before a plugin sees it: every
 * secret value of the connection, and the forms a service may echo it in,
 * such as URL-encoded, JSON-escaped, base64 or as the Basic credential the
 * broker sent. Covers #338.
 */

/** What replaces a secret in a body, a header or an error. */
export const SECRET_MARK = "[secret]";

const encoder = new TextEncoder();

function base64(text: string) {
  return Buffer.from(text, "utf8").toString("base64");
}

function base64Url(text: string) {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** encodeURIComponent with lowercase hex, as some servers write it. */
function lowercaseHex(text: string) {
  return text.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
}

/** The forms an address may take: webcal and https, with and without the scheme. */
function addressForms(value: string): string[] {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return [];
  }
  if (!["https:", "http:", "webcal:", "webcals:"].includes(url.protocol)) {
    return [];
  }
  const rest = url.href.slice(url.protocol.length + 2);
  const original = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  return [
    url.href,
    ...["https://", "http://", "webcal://", "webcals://"].flatMap((scheme) => [
      `${scheme}${rest}`,
      `${scheme}${original}`,
    ]),
    `//${rest}`,
    rest,
    original,
  ];
}

/** The texts a secret value may be echoed as. */
function formsOf(value: string): string[] {
  const forms = [value, value.trim()];
  for (const text of [value, ...addressForms(value)]) {
    const encoded = encodeURIComponent(text);
    const json = JSON.stringify(text).slice(1, -1);
    forms.push(
      text,
      encoded,
      lowercaseHex(encoded),
      encoded.replaceAll("%20", "+"),
      encodeURI(text),
      json,
      json.replaceAll("/", "\\/"),
      base64(text),
      base64Url(text),
    );
  }
  return forms;
}

/**
 * Every form of a connection's secrets to scrub, longest first, so a form
 * that holds a shorter one goes whole. `credentials` are the values the
 * broker sent built from them, such as a Basic credential's `user:secret`
 * and its base64, which a service may echo back too.
 */
export function secretForms(
  secrets: readonly string[],
  credentials: readonly string[] = [],
): string[] {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (secret.trim().length === 0) continue;
    for (const form of formsOf(secret)) forms.add(form);
  }
  for (const credential of credentials) {
    if (credential.length === 0) continue;
    forms.add(credential);
    forms.add(base64(credential));
    forms.add(encodeURIComponent(credential));
  }
  forms.delete("");
  return [...forms].sort((left, right) => right.length - left.length);
}

/** A scrubber for one request's secret forms. */
export class SecretScrubber {
  private readonly forms: readonly string[];
  private readonly formBytes: readonly Uint8Array[];
  private readonly mark = encoder.encode(SECRET_MARK);

  constructor(forms: readonly string[]) {
    this.forms = forms;
    this.formBytes = forms.map((form) => encoder.encode(form));
  }

  get empty() {
    return this.forms.length === 0;
  }

  /** Whether the text holds a secret in any form. */
  holdsSecret(text: string) {
    return this.forms.some((form) => text.includes(form));
  }

  /** The text with every secret form replaced. */
  text(text: string): string {
    let scrubbed = text;
    for (const form of this.forms) {
      if (scrubbed.includes(form))
        scrubbed = scrubbed.split(form).join(SECRET_MARK);
    }
    return scrubbed;
  }

  /**
   * The bytes with every secret form's UTF-8 bytes replaced, whatever the
   * content type, so an answer with a wrong or missing type can't carry one.
   */
  bytes(body: Uint8Array): Uint8Array {
    let scrubbed = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    let changed = false;
    for (const form of this.formBytes) {
      let index = scrubbed.indexOf(form);
      if (index === -1) continue;
      const parts: Buffer[] = [];
      let start = 0;
      while (index !== -1) {
        parts.push(scrubbed.subarray(start, index), Buffer.from(this.mark));
        start = index + form.byteLength;
        index = scrubbed.indexOf(form, start);
      }
      parts.push(scrubbed.subarray(start));
      scrubbed = Buffer.concat(parts);
      changed = true;
    }
    return changed ? new Uint8Array(scrubbed) : body;
  }
}
