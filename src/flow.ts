"use strict";

import * as vscode from "vscode";

import * as path from "path";

import { fail } from "./fail";
import { git } from "./git";
import { cmd } from "./cmd";
import { fs } from "./fs";
import { Branch, } from "./git.d";
import { config } from "./config";

const withProgress = vscode.window.withProgress;

export namespace flow {
  const workspaceDirectory = vscode.workspace.workspaceFolders || [];
  const rootPath: string = workspaceDirectory.length > 0 ? workspaceDirectory[0].uri.fsPath : "";
  export const gitDir = path.join(rootPath, ".git");
  export const gitflowDir = path.join(gitDir, ".gitflow");

  /**
   * Get the release branch prefix
   */
  export async function releasePrefix() {
    const config = await getConfig();
    return config["releasePrefix"];
  }

  /**
   * Get the tag prefix
   */
  export async function tagPrefix() {
    const config = await getConfig();
    return config["tagPrefix"];
  }

  /**
   * Get develop branch name
   */
  export async function getLocalDevelopBranch(): Promise<Branch> {
    const config = await getConfig();
    return await getLocalBranch(config["releaseBranch"]);
  }

  export async function getRemoteDevelopBranch(): Promise<Branch> {
    const config = await getConfig();
    return await getRemoteBranch(config["releaseBranch"]);
  }

  /**
   * Get the master branch name
   */
  export async function getLocalMasterBranch(): Promise<Branch> {
    const config = await getConfig();
    return await getLocalBranch(config["masterBranch"]);
  }

  export async function getRemoteMasterBranch(): Promise<Branch> {
    const config = await getConfig();
    return await getRemoteBranch(config["masterBranch"]);
  }

  export async function getLocalTestBranch(): Promise<Branch> {
    const config = await getConfig();
    return await getLocalBranch(config["testBranch"]);
  }

  export async function getRemoteTestBranch(): Promise<Branch> {
    const config = await getConfig();
    return await getRemoteBranch(config["testBranch"]);
  }

  export async function getLocalBranch(name: string): Promise<Branch> {
    return await git.getBranch(name);
  }

  export async function getRemoteBranch(name: string): Promise<Branch> {
    return await git.getBranch(git.originRemote().name + "/" + name);
  }

  export async function remoteBranchExists(name: string): Promise<boolean> {
    try {
      await getRemoteBranch(name);
      return true;
    } catch {
      return false;
    }
  }

  export async function flowEnabled(): Promise<boolean> {
    const configFilePath = await getConfigFilePath();
    if (configFilePath === null) {
      return false;
    }

    return await fs.exists(configFilePath);
  }

  export async function getConfig(): Promise<any> {
    const configPath = await getConfigFilePath();
    if (configPath === null) {
      return {};
    }

    if (!await fs.exists(configPath)) {
      return {};
    }

    const content = await fs.readFile(configPath);
    return JSON.parse(content.toString());
  }

  export async function writeConfig(config: object) {
    const configPath = await getConfigFilePath();
    if (configPath === null) {
      return;
    }

    fs.createOrWriteFile(configPath, JSON.stringify(config, null, "  "));
  }

  export async function getConfigFilePath(): Promise<string | null> {
    if (rootPath === "") {
      return null;
    }

    return rootPath + "/git-flow-plus.config";
  }

  export async function requireFlowEnabled() {
    if (!(await flowEnabled())) {
      // Ask the user to enable gitflow
      fail.error({
        message: "该项目尚未初始化 GitflowPlus",
        handlers: [
          {
            title: "现在初始化",
            cb: flow.initialize
          }
        ]
      });
    }
  }

  export function throwNotInitializedError(): never {
    throw fail.error({
      message: "该仓库尚未初始化 GitflowPlus",
      handlers: [
        {
          title: "现在初始化",
          cb() {
            return flow.initialize();
          }
        }
      ]
    });
  }

  export async function deleteBranch() {
    const shouldContinue = !!(await vscode.window.showWarningMessage("即将删除当前分支,是否继续?", "是"));
    if (!shouldContinue) {
      return;
    }

    return withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "删除当前分支"
      },
      async pr => {
        const currentBranch = await git.currentBranch();

        const repository = git.getCurrentRepository();

        const master = await getLocalMasterBranch();
        await repository.checkout(master.name!);

        pr.report({ message: `正在删除本地 ${currentBranch.name} 分支...` });

        await repository.deleteBranch(currentBranch.name!);

        const exists = await remoteBranchExists(currentBranch.name!);
        if (exists) {
          pr.report({ message: `正在删除远程 ${git.originRemote().name}/${currentBranch.name}分支...` });
          await git.deleteRemoteBranch(currentBranch.name!);
        }

        vscode.window.showInformationMessage(`分支 "${currentBranch.name}" 删除成功!`);
      });
  }

  export async function initialize() {
    console.log("初始化 GitFlowPlus");
    if (await flowEnabled()) {
      const doReinit = !!(await vscode.window.showWarningMessage(
        "当前仓库 GitFlowPlus 已经初始化. 是否需要再次初始化?",
        "是"
      ));
      if (!doReinit) { return; }
    }

    const branchNonEmpty = (str: any) => (!!str ? "" : "请输入分支名");

    const masterName = await vscode.window.showInputBox({
      prompt: "请输入主干分支名字",
      value: "master",
      validateInput: branchNonEmpty
    });
    if (!masterName) { return; }

    const developName = await vscode.window.showInputBox({
      prompt: "请输入发布分支名字",
      value: "develop",
      validateInput: branchNonEmpty
    });
    if (!developName) { return; }

    if (masterName === developName) {
      fail.error({
        message: "主干分支和开发分支名字不能相同"
      });
    }

    const develop = git.BranchRef.fromName(developName);
    const master = git.BranchRef.fromName(masterName);

    const remoteDevelop = git.BranchRef.fromName("origin/" + developName);

    // Check if the repository needs to be initialized before we proceed
    if (
      !!(
        await cmd.execute(git.info.path, [
          "rev-parse",
          "--quiet",
          "--verify",
          "HEAD"
        ])
      ).retc
    ) {
      await cmd.executeRequired(git.info.path, [
        "symbolic-ref",
        "HEAD",
        `refs/heads/${master.name}`
      ]);

      await cmd.executeRequired(git.info.path, [
        "commit",
        "--allow-empty",
        "--quiet",
        "-m",
        "Initial commit"
      ]);
    }

    // Ensure the develop branch exists
    if (!(await develop.exists())) {
      if (await remoteDevelop.exists()) {
        // If there is a remote with the branch, set up our local copy to track
        // that one
        cmd.executeRequired(git.info.path, [
          "branch",
          develop.name,
          remoteDevelop.name
        ]);
      } else {
        // Otherwise, create it on top of the master branch
        cmd.executeRequired(git.info.path, [
          "branch",
          "--no-track",
          develop.name,
          master.name
        ]);
      }
      // Checkout develop since we just created it
      await git.checkout(develop);
    }

    const configObj: any = {};

    // Create the branch prefixes and store those in git config
    for (const what of ["feature", "hotfix"]) {
      const prefix = await vscode.window.showInputBox({
        prompt: `请输入 "${what}" 分支前缀`,
        value: `${what}/`,
        validateInput: branchNonEmpty
      });
      if (!prefix) { return; }

      configObj[what + "Prefix"] = prefix;
    }

    const versionTagPrefix = await vscode.window.showInputBox({
      prompt: "输入 Tag 名称前缀 (可选)"
    });
    if (versionTagPrefix) {
      configObj["tagPrefix"] = versionTagPrefix;
    } else {
      configObj["tagPrefix"] = "";
    }

    // Set the main branches, and gitflow is officially 'enabled'
    configObj["masterBranch"] = master.name;
    configObj["releaseBranch"] = develop.name;

    const config = await getConfig();
    Object.assign(config, configObj);

    writeConfig(config);

    console.assert(await flowEnabled());

    vscode.window.showInformationMessage(
      "GitFlowPlus 已完成初始化!"
    );
  }
}

export namespace flow.feature {
  /**
   * Get the feature/bugfix branch prefix
   */
  export async function prefix(branchType: string): Promise<string> {
    const config = await getConfig();
    return config[branchType];
  }

  /**
   * Get the current feature/bugfix branch as well as its name.
   */
  export async function current(msg: string = "当前并不是开发或修复分支", branchType: string) {
    const prefix = await feature.prefix(branchType);
    if (!prefix) {
      throw throwNotInitializedError();
    }

    const currentBranch = await git.currentBranch();

    if (!currentBranch.name!.startsWith(prefix)) {
      throw fail.error({ message: msg });
    }
    const name = currentBranch.name!.substr(prefix.length);
    return { branch: currentBranch, name: name };
  }

  export async function createBranch(branchName: string, branchType: string) {
    return withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `创建新分支`
      },
      async pr => {
        await flow.requireFlowEnabled();

        const prefix = await feature.prefix(branchType);
        if (!prefix) {
          throw throwNotInitializedError();
        }

        pr.report({ message: "正在检查分支..." });

        const newBranchName = `${prefix}${branchName}`;
        if (await remoteBranchExists(newBranchName)) {
          fail.error({ message: `"${branchName}" 分支已存在!` });
        }

        const localMasterBranch = await getLocalMasterBranch();

        const repository = git.getCurrentRepository();

        await repository.checkout(localMasterBranch.name!);

        const remoteMasterBranch = await getRemoteMasterBranch();

        if (localMasterBranch.commit !== remoteMasterBranch.commit) {
          pr.report({ message: `${localMasterBranch.name} 内容不是最新的,正在拉取最新内容...` });
          await repository.pull();
        }

        pr.report({ message: `基于 ${localMasterBranch.name} 创建新分支...` });
        await repository.createBranch(newBranchName, true);

        // 推送到远程
        await repository.push(git.originRemote().name, newBranchName, true);

        vscode.window.showInformationMessage(`基于 ${localMasterBranch.name} 创建新分支 "${newBranchName}" 成功并已推送!`);
      });
  }

  export async function startTestBranch() {
    return withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `提测`
      },
      async pr => {
        await requireFlowEnabled();

        pr.report({ message: "正在检查分支..." });
        await git.requireClean();

        const currentBranch = await git.currentBranch();

        const featurePrefix = await feature.prefix("featurePrefix");
        const hotfixPrefix = await feature.prefix("hotfixPrefix");

        if (!currentBranch.name!.startsWith(featurePrefix) && !currentBranch.name!.startsWith(hotfixPrefix)) {
          fail.error({ message: `必须处于希望提测的功能/修复分支下` });
        }

        const shouldContinue = !!(await vscode.window.showWarningMessage("即将提测,是否继续?", "是"));
        if (!shouldContinue) {
          return;
        }

        const localTestBranch = await getLocalTestBranch();
        const remoteTestBranch = await getRemoteTestBranch();

        const repository = git.getCurrentRepository();

        pr.report({ message: `正在切换到 ${localTestBranch.name} 分支...` });
        await repository.checkout(localTestBranch.name!);

        if (localTestBranch.commit !== remoteTestBranch.commit) {
          pr.report({ message: `${localTestBranch.name} 内容不是最新的,正在拉取最新内容...` });
          await repository.pull();
        }

        pr.report({ message: `正在合并当前 ${currentBranch.name} 分支到测试分支 ${localTestBranch.name}...` });

        await git.merge(currentBranch.name!);

        await repository.push(git.originRemote().name, localTestBranch.name!, true);

        await repository.checkout(currentBranch.name!);

        vscode.window.showInformationMessage(`当前分支 ${currentBranch.name} 已合并到测试分支 ${localTestBranch.name} 并已推送,提测成功!`);
      });
  }

  /**
   * Rebase the current feature branch on develop
   */
  export async function rebase(branchType: string) {
    // await requireFlowEnabled();
    // const { branch: feature_branch } = await current(
    //   `You must checkout the ${branchType} branch you wish to rebase on develop`,
    //   branchType
    // );

    // const remote = feature_branch.remoteAt(git.originRemote());
    // const develop = await getConfigDevelopBranch();
    // if ((await remote.exists()) && !(await git.isMerged(remote, develop))) {
    //   const do_rebase = !!(await vscode.window.showWarningMessage(
    //     `A remote branch for ${feature_branch.name} exists, and rebasing ` +
    //     `will rewrite history for this branch that may be visible to ` +
    //     `other users!`,
    //     "Rebase anyway"
    //   ));
    //   if (!do_rebase) { return; }
    // }

    // await git.requireClean();
    // const result = await git.rebase({ branch: feature_branch, onto: develop });
    // if (result.retc) {
    //   const abort_result = await cmd.executeRequired(git.info.path, [
    //     "rebase",
    //     "--abort"
    //   ]);
    //   fail.error({
    //     message:
    //       `Rebase command failed with exit code ${result.retc}. ` +
    //       `The rebase has been aborted: Please perform this rebase from ` +
    //       `the command line and resolve the appearing errors.`
    //   });
    // }
    // await vscode.window.showInformationMessage(
    //   `${feature_branch.name} has been rebased onto ${develop.name}`
    // );
  }
  export async function publishCurrentBranch() {
    await requireFlowEnabled();

    const currentBranch = await git.currentBranch();

    const featurePrefix = await feature.prefix("featurePrefix");
    const hotfixPrefix = await feature.prefix("hotfixPrefix");

    if (currentBranch.name!.startsWith(featurePrefix)) {
      await publishBranch("featurePrefix");
    } else if (currentBranch.name!.startsWith(hotfixPrefix)) {
      await publishBranch("hotfixPrefix");
    } else {
      throw fail.error({ message: `必须处于希望发布的功能/修复分支下` });
    }
  }

  export async function publishBranch(branchType: string) {
    return withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `发布分支`
      },
      async pr => {
        pr.report({ message: "正在获取当前分支..." });
        const { branch: currentBranch } = await current(
          `必须处于希望发布的功能/修复分支下`,
          branchType
        );

        pr.report({ message: "正在检查当前分支情况..." });
        const isClean = await git.isClean();

        pr.report({ message: "正在检查是否有未完成的合并..." });
        const mergeBaseFile = path.join(gitflowDir, "MERGE_BASE");
        if (await fs.exists(mergeBaseFile)) {
          if (isClean) {
            await fs.remove(mergeBaseFile);
          } else {
            fail.error({ message: `存在合并冲突! 请先解决冲突后再重试.` });
          }
        }

        await git.requireClean();

        const shouldContinue = !!(await vscode.window.showWarningMessage("即将开始发布,是否继续?", "是"));
        if (!shouldContinue) {
          return;
        }

        const repository = git.getCurrentRepository();

        pr.report({ message: "正在检查远程分支..." });
        const currentRemoteBranch = await getRemoteBranch(currentBranch.name!);

        if (currentBranch.commit !== currentRemoteBranch.commit) {
          pr.report({ message: `${currentBranch.name} 内容不是最新的,正在拉取最新内容...` });
          await repository.pull();
        }

        // // Make sure the local develop and remote develop haven't diverged either
        const localDevelopBranch = await getLocalDevelopBranch();
        const remoteDevelopBranch = await getRemoteDevelopBranch();

        if (await git.isMerged(currentBranch.name!, localDevelopBranch.name!)) {
          const shouldContinue = !!(await vscode.window.showWarningMessage("分支已经合并过,是否继续?", "是"));
          if (!shouldContinue) {
            return;
          }
        }

        await repository.checkout(localDevelopBranch.name!);

        if (localDevelopBranch.commit !== remoteDevelopBranch.commit) {
          pr.report({ message: `${localDevelopBranch.name} 内容不是最新的,正在拉取最新内容...` });
          await repository.pull();
        }

        pr.report({ message: `正在合并当前 ${currentBranch.name} 分支到发布分支 ${localDevelopBranch.name}...` });

        try {
          await git.merge(currentBranch.name!);
        } catch (e) {
          console.error(e);
          await fs.writeFile(mergeBaseFile, localDevelopBranch.name);
          fail.error({ message: `合并到 ${localDevelopBranch.name} 时出现冲突. 请解决后再重试` });
        }

        await repository.push(git.originRemote().name, localDevelopBranch.name!, true);

        await repository.checkout(currentBranch.name!);

        vscode.window.showInformationMessage(`当前分支 ${currentBranch.name} 已合并到发布分支 ${localDevelopBranch.name} 并已推送,开始发布操作成功!`);
      }
    );
  }
}

export namespace flow.release {
  export async function current() {
    const branches = await git.BranchRef.all();
    const prefix = await releasePrefix();
    if (!prefix) {
      throw throwNotInitializedError();
    }
    return branches.find(br => br.name.startsWith(prefix));
  }

  export async function precheck() {
    // await git.requireClean();

    // const develop = await getConfigDevelopBranch();
    // const remoteDevelop = develop.remoteAt(git.originRemote());
    // if (await remoteDevelop.exists()) {
    //   await git.requireEqual(develop, remoteDevelop);
    // }
  }

  /**
   * Get the tag for a new release branch
   */
  export async function guess_new_version() {
    const tag = git.TagRef.fromName("_start_new_release");
    const tag_prefix = (await tagPrefix()) || "";
    let version_tag = (await tag.latest()) || "0.0.0";
    version_tag = version_tag.replace(tag_prefix, "");
    if (version_tag.match(/^\d+\.\d+\.\d+$/)) {
      let version_numbers = version_tag.split(".");
      version_numbers[1] = String(Number(version_numbers[1]) + 1);
      version_numbers[2] = "0";
      version_tag = version_numbers.join(".");
    }
    return version_tag;
  }

  export async function start(name: string) {
    await requireFlowEnabled();
    const current_release = await release.current();
    if (!!current_release) {
      fail.error({
        message: `There is an existing release branch "${current_release.name}". Finish that release before starting a new one.`
      });
    }

    const tag = git.TagRef.fromName(name);
    if (await tag.exists()) {
      fail.error({
        message: `The tag "${name}" is an existing tag. Please chose another release name.`
      });
    }

    const prefix = await releasePrefix();
    const new_branch = git.BranchRef.fromName(`${prefix}${name}`);
    const develop = await getLocalDevelopBranch();
    await cmd.executeRequired(git.info.path, [
      "checkout",
      "-b",
      new_branch.name,
      develop.name!
    ]);
    await vscode.window.showInformationMessage(
      `New branch ${new_branch.name} has been created. ` +
      `Now is the time to update your version numbers and fix any ` +
      `last minute bugs.`
    );
  }

  export async function publishBranchFinish() {
    return withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "完成发布"
      },
      async pr => {
        await requireFlowEnabled();

        const featurePrefix = await feature.prefix("featurePrefix");
        const hotfixPrefix = await feature.prefix("hotfixPrefix");

        const currentBranch = await git.currentBranch();
        const currentRemoteBranch = await getRemoteBranch(currentBranch.name!);

        if (!currentBranch.name!.startsWith(featurePrefix) && !currentBranch.name!.startsWith(hotfixPrefix)) {
          throw fail.error({ message: `必须处于希望发布的开发/修复分支下` });
        }

        pr.report({ message: "正在检查分支..." });
        await git.requireClean();

        const repository = git.getCurrentRepository();

        const develop = await getLocalDevelopBranch();
        const remoteDevelop = await getRemoteDevelopBranch();

        if (!(await git.isMerged(git.originRemote().name + "/" + currentBranch.name!, develop.name!))) {
          fail.error({ message: `请先点击开始发布!` });
        }

        // Get the name of the tag we will use. Default is the branch's flow name
        pr.report({ message: "获取 Tag 信息..." });
        const tagName = await vscode.window.showInputBox({ prompt: "请输入 Tag 名称", value: `${currentBranch.name}` });
        if (!tagName) { return; }

        const tagMessage = await vscode.window.showInputBox({ prompt: "请输入 Tag 描述", value: `${new Date().toLocaleString()}` });
        if (!tagMessage) { return; }

        await repository.checkout(develop.name!);

        if (develop.commit !== remoteDevelop.commit) {
          pr.report({ message: `${develop.name} 内容不是最新的,正在拉取最新内容...` });
          await repository.pull();
        }

        const master = await getLocalMasterBranch();
        const remoteMaster = await getRemoteMasterBranch();

        pr.report({ message: `正在切换到 ${master.name}...` });

        await repository.checkout(master.name!);

        if (master.commit !== remoteMaster.commit) {
          pr.report({ message: `${master.name} 内容不是最新的,正在拉取最新内容...` });
          await repository.pull();
        }

        // Merge develop into the master branch
        pr.report({ message: `正在合并 ${develop.name} 到 ${master.name}...` });
        await git.merge(develop.name!);

        pr.report({ message: `正在为 ${master.name} 打标签...` });

        await git.tagBranch(tagName, tagMessage);

        const remote = git.originRemote();
        pr.report({ message: `正在推送 ${master.name} 到远程...` });

        await repository.push(remote.name, master.name!);

        pr.report({ message: `正在推送 Tag ...` });

        await cmd.executeRequired(git.info.path, ["push", "--tags", remote.name]);

        if (config.deleteBranchOnFinish) {
          pr.report({ message: `正在删除本地 ${currentBranch.name} 分支...` });
          await repository.deleteBranch(currentBranch.name!);

          if (config.deleteRemoteBranches) {
            pr.report({ message: `正在删除远程 ${currentRemoteBranch.remote}/${currentRemoteBranch.name} 分支...` });
            await repository.removeRemote(git.originRemote().name + "/" + currentBranch.name!);
          }

          vscode.window.showInformationMessage(`${develop.name} 已合并到 ${master.name} 并已推送,完成发布操作成功!`);
        }
      }
    );
  }

  export async function finish() {
    await requireFlowEnabled();
    const prefix = await releasePrefix();
    if (!prefix) {
      throw throwNotInitializedError();
    }
    const current_release = await release.current();
    if (!current_release) {
      throw fail.error({ message: "No active release branch to finish" });
    }
    await finalizeWithBranch(prefix, current_release, finish);
  }

  export async function finalizeWithBranch(
    rel_prefix: string,
    branch: git.BranchRef,
    reenter: Function
  ) {
    return withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Finishing release branch"
      },
      async pr => {
        // await requireFlowEnabled();
        // pr.report({ message: "Getting current branch..." });
        // const currentBranch = await git.currentBranch();

        // if (currentBranch.name !== branch.name) {
        //   fail.error({
        //     message: `You are not currently on the "${branch.name}" branch`,
        //     handlers: [
        //       {
        //         title: `Checkout ${branch.name} and continue.`,
        //         cb: async function () {
        //           await git.checkout(branch);
        //           await reenter();
        //         }
        //       }
        //     ]
        //   });
        // }

        // pr.report({ message: "Checking cleanliness..." });
        // await git.requireClean();

        // pr.report({ message: "Checking remotes..." });
        // const master = await getConfigMasterBranch();
        // const remote_master = master.remoteAt(git.originRemote());
        // if (await remote_master.exists()) {
        //   await git.requireEqual(master, remote_master);
        // }

        // const develop = await getConfigDevelopBranch();
        // const remote_develop = develop.remoteAt(git.originRemote());
        // if (await remote_develop.exists()) {
        //   await git.requireEqual(develop, remote_develop);
        // }

        // // Get the name of the tag we will use. Default is the branch's flow name
        // pr.report({ message: "Getting a tag message..." });
        // const tag_message = await vscode.window.showInputBox({
        //   prompt: "Enter a tag message (optional)"
        // });
        // if (tag_message === undefined) { return; }

        // // Now the crux of the logic, after we've done all our sanity checking
        // pr.report({ message: "Switching to master..." });
        // await git.checkout(master);

        // // Merge the branch into the master branch
        // if (!(await git.isMerged(branch, master))) {
        //   pr.report({ message: `Merging ${branch} into ${master}...` });
        //   await git.merge(branch);
        // }

        // // Create a tag for the release
        // const tag_prefix = (await tagPrefix()) || "";
        // const release_name = tag_prefix.concat(
        //   branch.name.substr(rel_prefix.length)
        // );
        // pr.report({ message: `Tagging ${master}: ${release_name}...` });
        // await cmd.executeRequired(git.info.path, [
        //   "tag",
        //   "-m",
        //   tag_message,
        //   release_name,
        //   master.name
        // ]);

        // // Merge the release into develop
        // pr.report({ message: `Checking out ${develop}...` });
        // await git.checkout(develop);
        // if (!(await git.isMerged(branch, develop))) {
        //   pr.report({ message: `Merging ${branch} into ${develop}...` });
        //   await git.merge(branch);
        // }

        // if (config.deleteBranchOnFinish) {
        //   // Delete the release branch
        //   pr.report({ message: `Deleting ${branch.name}...` });
        //   await cmd.executeRequired(git.info.path, [
        //     "branch",
        //     "-d",
        //     branch.name
        //   ]);
        //   if (
        //     config.deleteRemoteBranches &&
        //     (await remote_develop.exists()) &&
        //     (await remote_master.exists())
        //   ) {
        //     const remote = git.originRemote();
        //     pr.report({
        //       message: `Pushing to ${remote.name}/${develop.name}...`
        //     });
        //     await git.push(remote, develop);
        //     pr.report({
        //       message: `Pushing to ${remote.name}/${master.name}...`
        //     });
        //     await git.push(remote, master);
        //     const remote_branch = branch.remoteAt(remote);
        //     pr.report({ message: `Pushing tag ${release_name}...` });
        //     cmd.executeRequired(git.info.path, ["push", "--tags", remote.name]);
        //     if (await remote_branch.exists()) {
        //       // Delete the remote branch
        //       pr.report({
        //         message: `Deleting remote ${remote.name}/${branch.name}`
        //       });
        //       await git.push(remote, git.BranchRef.fromName(":" + branch.name));
        //     }
        //   }
        // }

        // vscode.window.showInformationMessage(
        //   `The release "${release_name}" has been created. You are now on the ${develop.name} branch.`
        // );
      }
    );
  }
}

export namespace flow.hotfix {
  /**
   * Get the hotfix branch prefix
   */
  export function prefix() {
    return git.config.get("gitflow.prefix.hotfix");
  }

  /**
   * Get the current hotfix branch, or null if there is nonesuch
   */
  export async function current() {
    const branches = await git.BranchRef.all();
    const prefix = await hotfix.prefix();
    if (!prefix) {
      throw throwNotInitializedError();
    }
    return branches.find(br => br.name.startsWith(prefix));
  }

  /**
   * Get the tag for a new hotfix branch
   */
  export async function guess_new_version() {
    const tag = git.TagRef.fromName("_start_new_hotfix");
    const tag_prefix = (await tagPrefix()) || "";
    let version_tag = (await tag.latest()) || "0.0.0";
    version_tag = version_tag.replace(tag_prefix, "");
    if (version_tag.match(/^\d+\.\d+\.\d+$/)) {
      let version_numbers = version_tag.split(".");
      version_numbers[2] = String(Number(version_numbers[2]) + 1);
      version_tag = version_numbers.join(".");
    }
    return version_tag;
  }

  export async function start(name: string) {
    // await requireFlowEnabled();
    // const current_hotfix = await current();
    // if (!!current_hotfix) {
    //   fail.error({
    //     message: `There is an existing hotfix branch "${current_hotfix.name}". Finish that one first.`
    //   });
    // }

    // await git.requireClean();

    // const master = await getConfigMasterBranch();
    // const remoteMaster = master.remoteAt(git.originRemote());
    // if (await remoteMaster.exists()) {
    //   await git.requireEqual(master, remoteMaster);
    // }

    // const tag = git.TagRef.fromName(name);
    // if (await tag.exists()) {
    //   fail.error({
    //     message: `The tag "${tag.name}" is an existing tag. Choose another hotfix name.`
    //   });
    // }

    // const prefix = await hotfix.prefix();
    // const new_branch = git.BranchRef.fromName(`${prefix}${name}`);
    // if (await new_branch.exists()) {
    //   fail.error({
    //     message: `"${new_branch.name}" is the name of an existing branch`
    //   });
    // }
    // await cmd.executeRequired(git.info.path, [
    //   "checkout",
    //   "-b",
    //   new_branch.name,
    //   master.name
    // ]);
  }

  export async function finish() {
    await requireFlowEnabled();
    const prefix = await hotfix.prefix();
    if (!prefix) {
      throw throwNotInitializedError();
    }
    const current_hotfix = await hotfix.current();
    if (!current_hotfix) {
      throw fail.error({ message: "No active hotfix branch to finish" });
    }
    await release.finalizeWithBranch(prefix, current_hotfix, finish);
  }
}
