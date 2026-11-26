import { describe, expect, it } from "vitest";
import { cloneIdentityOf, sameRepository } from "./clone-identity.ts";

describe("a clone's identity", () => {
  it("is the same for a GitHub repository's HTTPS and SSH addresses", () => {
    const addresses = [
      "https://github.com/acme/api.git",
      "https://github.com/acme/api",
      "https://user@github.com/Acme/API/",
      "git@github.com:acme/api.git",
      "ssh://git@github.com/acme/api.git",
    ];
    for (const address of addresses) {
      expect(sameRepository(address, "https://github.com/acme/api.git")).toBe(
        true,
      );
    }
    expect(
      sameRepository("https://github.com/acme/web.git", addresses[0]!),
    ).toBe(false);
    expect(
      sameRepository("https://github.example.com/acme/api.git", addresses[0]!),
    ).toBe(false);
  });

  it("is the same for an Azure DevOps repository's address forms", () => {
    const target = "https://dev.azure.com/org/My%20Project/_git/api";
    for (const address of [
      "https://user@dev.azure.com/org/My%20Project/_git/api",
      "git@ssh.dev.azure.com:v3/org/My%20Project/api",
      "ssh://git@ssh.dev.azure.com/v3/org/my%20project/API",
      "https://org.visualstudio.com/My%20Project/_git/api",
      "https://org.visualstudio.com/DefaultCollection/My%20Project/_git/api",
      "org@vs-ssh.visualstudio.com:v3/org/My%20Project/api",
    ]) {
      expect(sameRepository(address, target)).toBe(true);
    }
    expect(
      sameRepository(
        "https://dev.azure.com/other/My%20Project/_git/api",
        target,
      ),
    ).toBe(false);
    // A repository named like its project can leave the project out.
    expect(
      sameRepository(
        "https://dev.azure.com/org/_git/api",
        "https://dev.azure.com/org/api/_git/api",
      ),
    ).toBe(true);
  });

  it("keeps a server's port and collection apart", () => {
    expect(
      sameRepository(
        "https://tfs.example.com:8080/tfs/One/Project/_git/api",
        "https://tfs.example.com:8080/tfs/Two/Project/_git/api",
      ),
    ).toBe(false);
    expect(
      sameRepository(
        "https://ghe.example.com:8443/acme/api.git",
        "https://ghe.example.com/acme/api.git",
      ),
    ).toBe(false);
  });

  it("refuses an address that carries a password or a token", () => {
    expect(cloneIdentityOf("https://user:secret@github.com/acme/api.git")).toBe(
      undefined,
    );
    expect(cloneIdentityOf("https://github.com/acme/api.git?token=x")).toBe(
      undefined,
    );
    expect(cloneIdentityOf("ext::sh -c touch% /tmp/pwned")).toBe(undefined);
    expect(cloneIdentityOf("https://github.com/acme/%2e%2e%2fapi")).toBe(
      undefined,
    );
  });

  it("names a local repository by its folder", () => {
    expect(sameRepository("/srv/git/host.git", "/srv/git/host.git/")).toBe(
      true,
    );
    expect(
      sameRepository("file:///srv/git/host.git", "/srv/git/host.git"),
    ).toBe(true);
    expect(sameRepository("/srv/git/host.git", "/srv/git/other.git")).toBe(
      false,
    );
  });
});
