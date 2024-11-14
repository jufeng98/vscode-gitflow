import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { Branch, GitExtension, Repository } from "./git.d";

import { cmd } from "./cmd";
import { fail } from "./fail";

// Taken from
// https://github.com/Microsoft/vscode/blob/cda3584a99d2832ab9d478c6b65ea45c96fe00c9/extensions/git/src/util.ts
export function denodeify<R>(fn: Function): (...args: any) => Promise<R> {
  return (...args) =>
    new Promise((c, e) => fn(...args, (err: any, r: R | PromiseLike<R>) => (err ? e(err) : c(r))));
}

const readdir = denodeify<string[]>(fs.readdir);

// Taken from
// https://github.com/Microsoft/vscode/blob/cda3584a99d2832ab9d478c6b65ea45c96fe00c9/extensions/git/src/git.ts
export interface IGit {
  path: string;
  version: string;
}

function parseVersion(raw: string): string {
  return raw.replace(/^git version /, "");
}

function findSpecificGit(path: string): Promise<IGit> {
  return new Promise<IGit>((c, e) => {
    const buffers: Buffer[] = [];
    const child = cp.spawn(path, ["--version"]);
    child.stdout.on("data", (b: Buffer) => buffers.push(b));
    child.on("error", e);
    child.on("exit", code =>
      code
        ? e(new Error("Not found"))
        : c({
          path,
          version: parseVersion(
            Buffer.concat(buffers)
              .toString("utf8")
              .trim()
          )
        })
    );
  });
}

function findGitDarwin(): Promise<IGit> {
  return new Promise<IGit>((c, e) => {
    cp.exec("which git", (err, gitPathBuffer) => {
      if (err) {
        return e("git not found");
      }

      const path = gitPathBuffer.toString().replace(/^\s+|\s+$/g, "");

      function getVersion(path: string) {
        // make sure git executes
        cp.exec("git --version", (err: cp.ExecException | null, stdout: string) => {
          if (err) {
            return e("git not found");
          }

          return c({ path, version: parseVersion(stdout.trim()) });
        });
      }

      if (path !== "/usr/bin/git") {
        return getVersion(path);
      }

      // must check if XCode is installed
      cp.exec("xcode-select -p", (err: any) => {
        if (err && err.code === 2) {
          // git is not installed, and launching /usr/bin/git
          // will prompt the user to install it

          return e("git not found");
        }

        getVersion(path);
      });
    });
  });
}

function findSystemGitWin32(base: string): Promise<IGit> {
  if (!base) {
    return Promise.reject<IGit>("Not found");
  }

  return findSpecificGit(path.join(base, "Git", "cmd", "git.exe"));
}

function findGitHubGitWin32(): Promise<IGit> {
  // @ts-ignore
  const github = path.join(process.env["LOCALAPPDATA"], "GitHub");

  return readdir(github).then(children => {
    const git = children.filter(child => /^PortableGit/.test(child))[0];

    if (!git) {
      return Promise.reject<IGit>("Not found");
    }

    return findSpecificGit(path.join(github, git, "cmd", "git.exe"));
  });
}

function id<T>(val: T): T {
  return val;
}

function findGitWin32(): Promise<IGit> {
  // @ts-ignore
  return (
    // @ts-ignore
    findSystemGitWin32(process.env["ProgramW6432"])
      // @ts-ignore
      .then(id, () => findSystemGitWin32(process.env["ProgramFiles(x86)"]))
      // @ts-ignore
      .then(id, () => findSystemGitWin32(process.env["ProgramFiles"]))
      .then(id, () => findSpecificGit("git"))
      .then(id, () => findGitHubGitWin32())
  );
}

export function findGit(hint: string | undefined): Promise<IGit> {
  var first = hint ? findSpecificGit(hint) : Promise.reject<IGit>(null);

  return first.then(id, () => {
    switch (process.platform) {
      case "darwin":
        return findGitDarwin();
      case "win32":
        return findGitWin32();
      default:
        return findSpecificGit("git");
    }
  });
}

export namespace git {
  export let info: IGit;
  /**
   * Represents a git remote
   */
  export class RemoteRef {
    constructor(public name: string) { }

    /// Create a remote reference from a remote's name
    public static fromName(name: string) {
      return new RemoteRef(name);
    }
  }

  export namespace config {
    /// Get a git config value
    export async function get(setting: string): Promise<string | null> {
      const result = await cmd.execute(info.path, ["config", "--get", setting]);
      if (result.retc) {
        return null;
      }
      return result.stdout.trim();
    }

    /// Set a git config value
    export async function set(setting: string, value: any): Promise<number> {
      const result = await cmd.execute(info.path, ["config", setting, value]);
      return result.retc;
    }
  }

  export class TagRef {
    constructor(public name: string) { }

    /**
     * Get a tag reference by name
     */
    public static fromName(name: string) {
      return new TagRef(name);
    }

    /**
     * Parse a list of tags returned by git
     */
    public static parseListing(output: string): TagRef[] {
      return output
        .replace("\r\n", "\n")
        .trim()
        .split("\n")
        .filter(line => !!line.length)
        .map(line => line.trim())
        .reduce((acc, name) => {
          if (!(name in acc)) { acc.push(name); }

          return acc;
        }, [] as string[])
        .map(name => new TagRef(name));
    }

    /**
     * Get a list of all tags
     */
    public static async all() {
      const result = await cmd.executeRequired(info.path, ["tag", "-l"]);
      return TagRef.parseListing(result.stdout);
    }

    /**
     * Get latest tag
     */
    public async latest(): Promise<string> {
      let last_tag = "";
      const a_tag_exists = await cmd.executeRequired(info.path, ["tag", "-l"]);
      if (a_tag_exists.stdout.trim()) {
        const latest_tagged_commit = await cmd.executeRequired(info.path, [
          "rev-list",
          "--tags",
          "--max-count=1"
        ]);
        const result = await cmd.executeRequired(info.path, [
          "describe",
          "--tags",
          latest_tagged_commit.stdout.trim()
        ]);
        last_tag = result.stdout.trim();
      }
      return last_tag;
    }

    /**
     * Check if the tag exists
     */
    public async exists(): Promise<boolean> {
      const self: TagRef = this;
      const all = await TagRef.all();
      return all.some(tag => tag.name === self.name);
    }
  }

  export class BranchRef {
    constructor(public name: string) { }

    /**
     * Create a branch reference from a string name
     */
    public static fromName(name: string | null) {
      if (name === null) {
        throw new Error("错误");
      }
      return new BranchRef(name);
    }

    /**
     * Parse a list of branches returned by git stdout
     */
    public static parseListing(output: string): BranchRef[] {
      return output
        .replace("\r\n", "\n")
        .trim()
        .split("\n")
        .filter(line => !!line.length)
        .filter(line => line !== "no branch")
        .map(line => line.trim())
        .map(line => line.replace(/^\* /, ""))
        .reduce((acc, name) => {
          if (!(name in acc)) { acc.push(name); }

          return acc;
        }, [] as string[])
        .map(name => new BranchRef(name));
    }

    /**
     * Get a list of branches available in the current directory
     */
    public static async all() {
      const local_result = await cmd.execute(info.path, [
        "branch",
        "--no-color"
      ]);
      const local_stdout = local_result.stdout;
      const remote_result = await cmd.execute(info.path, [
        "branch",
        "-r",
        "--no-color"
      ]);
      const remote_stdout = remote_result.stdout;
      const filter = (output: any) => {
        return output;
      };

      return BranchRef.parseListing(local_stdout + remote_stdout);
    }

    /**
     * Test if a given branch exists
     */
    public async exists(): Promise<boolean> {
      const self: BranchRef = this;
      const all = await BranchRef.all();
      return !!all.find((branch: BranchRef) => branch.name === self.name);
    }

    /**
     * Get the git hash that the branch points to
     */
    public async ref(): Promise<string> {
      const self: BranchRef = this;
      const result = await cmd.execute(info.path, ["rev-parse", self.name]);
      return result.stdout.trim();
    }

    /**
     * Get the name of the branch at a remote
     */
    public remoteAt(remote: RemoteRef): BranchRef {
      return BranchRef.fromName(`${remote.name}/${this.name}`);
    }
  }

  export function getCurrentRepository(): Repository {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
    if (!gitExtension) {
      fail.error({ message: "vscode.git插件不可用" });
    }

    const git = gitExtension!!.getAPI(1);
    const repositories = git.repositories;
    if (repositories.length === 0) {
      fail.error({ message: "未检测到任何git仓库" });
    }

    return git.repositories[0];
  }

  /**
   * Get a reference to the currently checked out branch
   */
  export async function currentBranch(): Promise<Branch> {
    const result = await cmd.executeRequired(info.path, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]);

    const name = result.stdout.trim();
    if (name === "HEAD") {
      // We aren't attached to a branch at the moment
      fail.error({ message: "无法获取当前分支" });
    }

    return getBranch(name);
  }

  export async function getBranch(name: string): Promise<Branch> {
    const repository = getCurrentRepository();
    const branch = await repository.getBranch(name);
    return branch;
  }

  /**
   * Pull updates from the given ``remote`` for ``branch``
   */
  export async function pull(
    remote: RemoteRef,
    branch: BranchRef
  ): Promise<Number> {
    const result = await cmd.execute(info.path, [
      "pull",
      remote.name,
      branch.name
    ]);
    if (result.retc !== 0) {
      fail.error({ message: "Failed to pull from remote. See git output" });
    }
    return result.retc;
  }

  /**
   * Push updates to ``remote`` at ``branch``
   */
  export async function push(
    remote: RemoteRef,
    branch: BranchRef
  ): Promise<Number> {
    const result = await cmd.execute(info.path, [
      "push",
      remote.name,
      branch.name
    ]);
    if (result.retc !== 0) {
      fail.error({
        message: "Failed to push to remote. See git output"
      });
    }
    return result.retc;
  }

  /**
   * Check if we have any unsaved changes
   */
  export async function isClean(): Promise<boolean> {
    const repository = getCurrentRepository();
    const diffRes = await repository.diff();
    if (diffRes !== "") {
      return false;
    }

    const changes = await repository.diffIndexWithHEAD();
    if (changes.length > 0) {
      return false;
    }

    return true;
  }

  /**
   * Detect if the branch "subject" was merged into "base"
   */
  export async function isMerged(subject: string, base: string) {
    const result = await cmd.executeRequired(info.path, [
      "rev-list",
      "--all",
      "--merges",
      `--grep="Merge branch '${subject}' into ${base}"`,
      `--since`,
      `"${Math.round((Date.now() / 1000 - 86400 * 5))}"`
    ]);
    return result.stdout.length > 0;
  }

  /**
   * Checkout the given branch
   */
  export function checkout(branch: BranchRef) {
    return checkoutRef(branch.name);
  }

  /**
   * Checkout the given git hash
   */
  export function checkoutRef(ref: string) {
    return cmd.executeRequired(info.path, ["checkout", ref]);
  }

  export function deleteBranch(ref: Branch) {
    return cmd.executeRequired(git.info.path, [
      "branch",
      "-D",
      ref.name!
    ]);
  }

  export function deleteRemoteBranch(ref: string) {
    return cmd.executeRequired(git.info.path, [
      "push",
      "origin",
      "--delete",
      ref
    ]);
  }

  export function createAndCheckoutBranch(ref: BranchRef, base: BranchRef) {
    return cmd.executeRequired(git.info.path, [
      "checkout",
      "-b",
      ref.name,
      base.name
    ]);
  }

  export function pushBranch(branch: BranchRef) {
    return cmd.executeRequired(git.info.path, [
      "push",
      "--set-upstream",
      originRemote().name,
      branch.name
    ]);
  }

  export function tagBranch(tagName: string, tagMessage: string) {
    return cmd.executeRequired(git.info.path, [
      "tag",
      "-a",
      tagName,
      "-m",
      tagMessage,
    ]);
  }

  /**
   * Merge one branch into the currently checked out branch
   */
  export function merge(other: string) {
    return cmd.executeRequired(info.path, ["merge", "--no-ff", other]);
  }

  interface IRebaseParameters {
    branch: BranchRef;
    onto: BranchRef;
  }

  /**
   * Rebase one branch onto another
   */
  export function rebase(args: IRebaseParameters) {
    return cmd.executeRequired(info.path, [
      "rebase",
      args.onto.name,
      args.branch.name
    ]);
  }

  export async function requireClean() {
    if (!(await isClean())) {
      fail.error({
        message:
          "存在未提交的文件变动. 请 commit 或 stash 后再重试"
      });
    }
  }

  export function originRemote() {
    return RemoteRef.fromName("origin");
  }
}
