import { describe, expect, it } from "vitest";
import { scrubErrorMessage } from "../scrub.ts";
import { recordingEmitter } from "./fixtures.ts";

const windows = {
  homeDirectory: "C:\\Users\\Ana",
  userDataPath: "C:\\Users\\Ana\\AppData\\Roaming\\Ajour",
};

describe("the error scrubber", () => {
  it("replaces secret values, with the redaction plugin errors use", () => {
    expect(
      scrubErrorMessage("Token pat-7c1e9a refused, PIN 4829.", {
        secrets: ["pat-7c1e9a", "4829"],
      }),
    ).toBe("Token [secret] refused, PIN [secret].");
  });

  it("replaces the user data path and the home directory, however the message writes them", () => {
    expect(
      scrubErrorMessage(
        "EPERM: open 'C:\\Users\\Ana\\AppData\\Roaming\\Ajour\\app-api-state.json'",
        windows,
      ),
    ).toBe("EPERM: open '[user data]\\app-api-state.json'");
    expect(
      scrubErrorMessage(
        'Cannot read c:/users/ana/Documents/plan.xlsx or {"path":"C:\\\\Users\\\\Ana\\\\x"}',
        windows,
      ),
    ).toBe('Cannot read ~/Documents/plan.xlsx or {"path":"~\\\\x"}');
    expect(
      scrubErrorMessage(
        "ENOENT: /Users/ana/Library/Application Support/Ajour/x",
        {
          homeDirectory: "/Users/ana/",
          userDataPath: "/Users/ana/Library/Application Support/Ajour",
        },
      ),
    ).toBe("ENOENT: [user data]/x");
  });

  it("leaves a message alone when it has no home or user data path to replace", () => {
    expect(scrubErrorMessage("Row 3 has no project.", {})).toBe(
      "Row 3 has no project.",
    );
    // A root path would replace every separator, so it is skipped.
    expect(scrubErrorMessage("a/b\\c", { homeDirectory: "/" })).toBe("a/b\\c");
  });

  it("replaces URLs, and keeps the punctuation after them", () => {
    expect(
      scrubErrorMessage(
        "GET https://acme.atlassian.net/rest/api/3/issue/ACME-12?expand=all failed. See file:///C:/Users/Ana/log.txt, or (http://127.0.0.1:8787/api).",
        windows,
      ),
    ).toBe("GET [url] failed. See [url], or ([url]).");
  });

  it("finds secrets, URLs and paths on the original text, so a secret inside one can't break the others", () => {
    // The secret is the URL's scheme: the host and path still go.
    expect(
      scrubErrorMessage("GET https://private.example/a failed", {
        secrets: ["https"],
      }),
    ).toBe("GET [url] failed");
    // The secret sits inside the home path: the path still goes.
    expect(
      scrubErrorMessage("open C:\\Users\\Ana\\notes.txt", {
        ...windows,
        secrets: ["Users\\Ana"],
      }),
    ).toBe("open ~\\notes.txt");
    // A secret that starts before a URL and ends inside it goes with it, as
    // one mark: the widest range's.
    expect(
      scrubErrorMessage("key=pat-9 https://acme.example/x", {
        secrets: ["pat-9 https://acme"],
      }),
    ).toBe("key=[url]");
    // A secret that holds the home path is one secret.
    expect(
      scrubErrorMessage("Key C:\\Users\\Ana\\key.pem refused", {
        ...windows,
        secrets: ["C:\\Users\\Ana\\key.pem"],
      }),
    ).toBe("Key [secret] refused");
  });

  it("replaces the home directory only where a path segment ends", () => {
    expect(
      scrubErrorMessage("C:\\Users\\Anabel\\x and C:\\Users\\Ana", windows),
    ).toBe("C:\\Users\\Anabel\\x and ~");
  });

  it("leaks no secret, host or home path when they overlap, across random messages", () => {
    const hosts = ["private.example", "acme.atlassian.net", "intra.local"];
    const pieces = [
      ...hosts.map((host) => `https://${host}/rest/2/issue?t=pat-7c1e9a`),
      "C:\\Users\\Ana\\AppData\\Roaming\\Ajour\\state.json",
      "c:/users/ana/Documents/plan.xlsx",
      "pat-7c1e9a",
      "Bearer pat-7c1e9a",
      "failed",
      "with",
      "(",
      ")",
      ",",
      "\n",
    ];
    const secretPool = [
      "pat-7c1e9a",
      "https",
      "Users\\Ana",
      "private",
      "atlassian.net/rest",
      "Ajour\\state",
      "ana/Documents",
    ];
    let seed = 7;
    const random = (below: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % below;
    };
    for (let round = 0; round < 2_000; round += 1) {
      const secrets = secretPool.filter(() => random(2) === 0);
      const message = Array.from(
        { length: 1 + random(8) },
        () => pieces[random(pieces.length)],
      ).join(random(2) === 0 ? " " : "");
      const scrubbed = scrubErrorMessage(message, { ...windows, secrets });
      for (const leak of [...secrets, ...hosts, "Users\\Ana", "users/ana"]) {
        expect([message, scrubbed.toLowerCase()]).not.toEqual([
          message,
          expect.stringContaining(leak.toLowerCase()),
        ]);
      }
    }
  });

  it("caps a message at 512 characters, never inside a mark", () => {
    const long = scrubErrorMessage("x".repeat(600));
    expect(long).toHaveLength(512);
    expect(long.endsWith("x…")).toBe(true);

    // The cut would fall inside the [url] that starts at 508.
    const nearUrl = scrubErrorMessage(
      `${"x".repeat(507)} https://acme.example/${"y".repeat(50)}`,
    );
    expect(nearUrl).toBe(`${"x".repeat(507)} …`);
  });

  it("hides a message it can't check for secrets within the redaction's budget", () => {
    expect(
      scrubErrorMessage("a".repeat(1_000), {
        secrets: Array.from({ length: 1_000 }, (_, index) =>
          "a".repeat(index + 1),
        ),
      }),
    ).toBe("Hidden because it couldn't be checked for secrets.");
  });
});

describe("error messages in events", () => {
  it("scrubs every message a unit records, with the runtime's paths and the call's secrets", () => {
    const { events, recorded } = recordingEmitter({ scrub: windows });

    events.run("backlog.sync", { kind: "request", trigger: "system" }, (unit) =>
      unit.fail(
        new Error(
          "401 from https://dev.azure.com/acme for token pat-7c1e9a in C:\\Users\\Ana\\AppData\\Roaming\\Ajour",
        ),
        { secrets: ["pat-7c1e9a"] },
      ),
    );
    expect(() =>
      events.run("backlog.sync", { kind: "job", trigger: "user" }, () => {
        throw new Error("EBUSY: C:\\Users\\Ana\\Desktop\\week.xlsx");
      }),
    ).toThrow();

    expect(recorded.map((event) => event.error?.message)).toEqual([
      "401 from [url] for token [secret] in [user data]",
      "EBUSY: ~\\Desktop\\week.xlsx",
    ]);
  });
});
