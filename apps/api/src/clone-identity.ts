import path from "node:path";

/*
 * Which repository a Git remote address names, so Deck matches a clone's
 * remotes with a pull request's clone addresses (#795). Matching is
 * separate from fetching: Deck fetches from the user's own remote, as they
 * set it up, and only compares names here.
 *
 * An address that carries a password, a token, a query or a transport
 * helper has no identity: Ajour never matches, keeps or fetches it. A user
 * name is dropped. Host names compare case-insensitively, and so do GitHub
 * and Azure DevOps names, as both hosts treat them. A port, a server's
 * collection and a GitHub Enterprise host stay part of the identity, so two
 * instances never match by repository name alone.
 */

/** The Azure DevOps Services hosts, which all name `dev.azure.com` organizations. */
const AZURE_SSH_HOSTS = new Set([
  "ssh.dev.azure.com",
  "vs-ssh.visualstudio.com",
]);

/** Splits an address into host and path, or undefined for one Ajour won't read. */
function partsOf(
  address: string,
):
  | { host: string; segments: string[]; ssh: boolean }
  | { local: string }
  | undefined {
  const trimmed = address.trim();
  if (!trimmed || /[\0\r\n]/.test(trimmed)) return undefined;
  // A folder: the address of a repository on this computer.
  if (path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed))
    return { local: trimmed };
  // An address has no white space.
  if (/\s/.test(trimmed)) return undefined;
  // `ext::` and other transport helpers, which run commands.
  if (/^[a-z][a-z0-9+.-]*::/i.test(trimmed)) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === "file") {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        return undefined;
      }
      if (url.search || url.hash || (url.host && url.host !== "localhost"))
        return undefined;
      let file = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(file)) file = file.slice(1);
      return { local: file };
    }
    if (!["https", "http", "ssh", "git"].includes(scheme)) return undefined;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return undefined;
    }
    if (url.password || url.search || url.hash) return undefined;
    const segments = decodedSegments(url.pathname);
    if (!segments) return undefined;
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    return { host: host.toLowerCase(), segments, ssh: scheme === "ssh" };
  }
  // scp-like: `[user@]host:path`, with no slash before the colon.
  const scp = /^(?:([^@/:]+)@)?([^@/:]+):(?!\/\/)(.+)$/.exec(trimmed);
  if (scp && !/^[a-z]$/i.test(scp[2]!)) {
    const segments = decodedSegments(scp[3]!);
    if (!segments) return undefined;
    return { host: scp[2]!.toLowerCase(), segments, ssh: true };
  }
  return undefined;
}

/** Path segments decoded once, or undefined when one hides a separator or a dot step. */
function decodedSegments(pathname: string): string[] | undefined {
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    if (!raw) continue;
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (/[/\\\0]/.test(segment) || segment === "." || segment === "..")
      return undefined;
    segments.push(segment);
  }
  return segments.length ? segments : undefined;
}

const withoutGit = (name: string) => name.replace(/\.git$/i, "");

/**
 * The repository an address names, as one comparable string, or undefined
 * for an address Ajour won't read.
 */
export function cloneIdentityOf(address: string): string | undefined {
  const parts = partsOf(address);
  if (!parts) return undefined;
  if ("local" in parts) {
    const resolved = path.resolve(parts.local).replace(/[\\/]+$/, "");
    return `local:${process.platform === "win32" ? resolved.toLowerCase() : resolved}`;
  }
  const { host, segments } = parts;
  const azure = (organization: string, rest: string[]) => {
    // `project/_git/repo`, `_git/repo` for a repository named like its project.
    const git = rest.indexOf("_git");
    if (git < 0 || git !== rest.length - 2) return undefined;
    const repository = withoutGit(rest[git + 1]!);
    const project = git === 0 ? repository : rest[git - 1]!;
    if (git > 1) return undefined;
    return `azure:${organization}/${project}/${repository}`.toLowerCase();
  };
  if (AZURE_SSH_HOSTS.has(host)) {
    // `v3/org/project/repo`
    if (segments.length !== 4 || segments[0] !== "v3") return undefined;
    const [, organization, project, repository] = segments;
    return `azure:${organization}/${project}/${withoutGit(repository!)}`.toLowerCase();
  }
  if (host === "dev.azure.com") {
    const [organization, ...rest] = segments;
    return azure(organization!, rest);
  }
  const visualStudio = /^([a-z0-9-]+)\.visualstudio\.com$/.exec(host);
  if (visualStudio) {
    const rest =
      segments[0]?.toLowerCase() === "defaultcollection"
        ? segments.slice(1)
        : segments;
    return azure(visualStudio[1]!, rest);
  }
  const git = segments.indexOf("_git");
  if (git >= 0) {
    // Azure DevOps Server: its collection path stays part of the identity.
    if (git !== segments.length - 2 || git < 1) return undefined;
    const repository = withoutGit(segments[git + 1]!);
    return `server:${host}/${segments.slice(0, git).join("/")}/${repository}`.toLowerCase();
  }
  // GitHub and other hosts: `owner/repo`.
  const last = withoutGit(segments.at(-1)!);
  if (!last) return undefined;
  return `git:${host}/${[...segments.slice(0, -1), last].join("/")}`.toLowerCase();
}

/** Whether two addresses name the same repository. */
export function sameRepository(a: string, b: string): boolean {
  const left = cloneIdentityOf(a);
  return left !== undefined && left === cloneIdentityOf(b);
}

/** Whether an address uses SSH, which decides which of a fork's addresses Deck fetches. */
export function isSshAddress(address: string): boolean {
  const parts = partsOf(address);
  return parts !== undefined && "ssh" in parts && parts.ssh;
}
