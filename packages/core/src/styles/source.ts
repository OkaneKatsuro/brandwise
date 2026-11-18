// Where a style pack is read from: a folder on this machine as it is, or the newest commit of a git repository fetched into a
// temporary folder. The one part of the style library that touches the disk and the network; what a pack may hold is decided in
// pack.ts.
import { execFile } from "node:child_process";
import { lstat, mkdtemp, opendir, readFile, rm, stat } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { plain } from "./domain.ts";
import { MAX_FILE_BYTES, type PackEntry } from "./pack.ts";

/** A folder or a commit with more in it is not a pack: the reading stops there instead of listing a whole disk. */
const MAX_ENTRIES = 1000;
const FETCH_SECONDS = 60;

const tooMuch = (where: string) => new Error(`${where} holds more than ${MAX_ENTRIES} files and folders: that is not a style pack`);

/** A file, for the check of a pack. Only a .json file within the size limit is read: those are the files the check parses. */
const fileEntry = async (path: string, bytes: number, read: () => Promise<string>): Promise<PackEntry> =>
  ({ path, kind: "file", bytes, ...(path.endsWith(".json") && bytes <= MAX_FILE_BYTES ? { text: await read() } : {}) });

/**
 * Everything a folder holds, for the check of a pack. A link is reported as a link and never followed. `.git` at the top is the
 * repository's own records and no part of the pack: it is passed over.
 */
export async function readFolder(dir: string): Promise<PackEntry[]> {
  if (!(await stat(dir).then((s) => s.isDirectory(), () => false))) throw new Error(`No folder at ${dir}: give the folder that holds the pack's pack.json`);
  const entries: PackEntry[] = [];
  const walk = async (folder: string): Promise<void> => {
    for await (const item of await opendir(join(dir, folder))) {
      const path = folder === "" ? item.name : `${folder}/${item.name}`;
      if (path === ".git") continue;
      if (entries.length === MAX_ENTRIES) throw tooMuch(dir);
      if (item.isSymbolicLink()) entries.push({ path, kind: "link", bytes: 0 });
      else if (item.isDirectory()) {
        entries.push({ path, kind: "folder", bytes: 0 });
        await walk(path);
      } else if (!item.isFile()) entries.push({ path, kind: "other", bytes: 0 });
      else entries.push(await fileEntry(path, (await lstat(join(dir, path))).size, () => readFile(join(dir, path), "utf8")));
    }
  };
  await walk("");
  return entries;
}

/** What a repository holds at its newest commit, for the check of a pack, and the id of that commit. */
type Fetched = { entries: PackEntry[]; revision: string };
/** Fetches the pack at an https address. The style library takes it as a dependency, so its tests need no network. */
export type Fetch = (url: string) => Promise<Fetched>;

/**
 * What holds git to a plain fetch over https, whatever this machine is set up to do. Its own configuration is left out: an
 * address rewritten to ssh, a credential helper, extra headers, a folder of hooks. No protocol but https is spoken, also after a
 * redirect, and nobody is asked for credentials, on the terminal or in a window.
 */
const FENCE = { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "https", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" };

/** Runs git inside the fence and a time limit, without a shell. Resolves with what git printed; rejects with why it failed. */
const git = (args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile("git", args, { env: { ...process.env, ...FENCE }, timeout: FETCH_SECONDS * 1000, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      if (!error) resolve(stdout);
      else if (error.code === "ENOENT") reject(new Error("git is not installed on this host"));
      else if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") reject(tooMuch("The repository"));
      else if (error.killed) reject(new Error(`git did not finish within ${FETCH_SECONDS} seconds`));
      // git's last words; they may repeat what the server sent
      else reject(new Error(plain(stderr.trim().split("\n").at(-1) ?? "") || error.message));
    }),
  );

/** One entry of a commit as `git ls-tree -l` prints it: mode, type, object, size ("-" for what is not a file), then the path. */
const TREE_ENTRY = /^(\d+) (\w+) ([0-9a-f]+) +(\d+|-)\t([^]+)$/;

/**
 * The newest commit of a repository as the entries of a pack, read from git's own records (`gitDir`). Nothing of the commit is
 * written out as files, so a link stays the entry git keeps it as, and a submodule is an entry that is neither a file nor a
 * folder. Only a .json file within the size limit is read.
 */
export async function readRepository(gitDir: string): Promise<Fetched> {
  const inside = (...args: string[]) => git(["--git-dir", gitDir, ...args]);
  const revision = (await inside("rev-parse", "--verify", "--quiet", "HEAD^{commit}").catch(() => {
    throw new Error("The repository has no commit on its default branch: push the pack there first");
  })).trim();
  const listed = (await inside("ls-tree", "-r", "-t", "-l", "-z", revision)).split("\0").filter((line) => line !== "");
  if (listed.length > MAX_ENTRIES) throw tooMuch("The repository");
  const entries: PackEntry[] = [];
  for (const line of listed) {
    const [, mode, type, object, size, path] = TREE_ENTRY.exec(line) ?? [];
    if (path === undefined) throw new Error(`git listed an entry that cannot be read: ${plain(line)}`);
    if (type === "tree") entries.push({ path, kind: "folder", bytes: 0 });
    else if (type !== "blob") entries.push({ path, kind: "other", bytes: 0 });
    else if (mode === "120000") entries.push({ path, kind: "link", bytes: 0 });
    else entries.push(await fileEntry(path, Number(size), () => inside("cat-file", "blob", object)));
  }
  return { entries, revision };
}

/**
 * The newest commit of the repository at `url`, without its history, fetched into a temporary folder that is removed whatever
 * happens. The clone is bare: nothing is checked out, so no file of the repository is written to disk, no hook or filter of
 * the checkout runs, and no submodule or large-file store is fetched. That the address is https is the caller's rule
 * (packSource); git is held to it.
 */
export const fetchRepository: Fetch = async (url) => {
  const dir = await mkdtemp(join(tmpdir(), "bw-style-pack-"));
  try {
    await git(["clone", "--quiet", "--bare", "--depth", "1", "--template=", "--", url, dir]).catch((cause: Error) => {
      throw new Error(`Could not fetch ${url}: ${cause.message}. A pack's repository is fetched over https without signing in: check the address and that the repository is public.`);
    });
    return await readRepository(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
