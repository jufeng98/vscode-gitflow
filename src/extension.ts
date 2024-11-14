"use strict";

import * as vscode from "vscode";
import { findGit, git } from "./git";
import { flow } from "./flow";
import { fail } from "./fail";
import { buildTreeView } from "./treeview";
import * as myLang from "./language";

async function runWrapped<T>(fn: (...arg0: any[]) => Thenable<T>, args: any[] = []): Promise<T | null> {
  try {
    return await fn(...args);
  } catch (e: any) {
    console.error(e);
    if (!e.handlers && !e.message) {
      throw e;
    }

    const err: fail.IError = e;
    const chosen = await vscode.window.showErrorMessage(
      err.message,
      ...(err.handlers || [])
    );
    if (!!chosen) {
      return await runWrapped(chosen.cb);
    }
    return null;
  }
}

async function setup(): Promise<vscode.Disposable[]> {
  const pathHint = vscode.workspace.getConfiguration("git").get<string>("path");
  git.info = await findGit(pathHint);
  vscode.window.setStatusBarMessage(`GitFlowPlus 使用的 git 路径:${git.info.path},版本:${git.info.version}`, 8000);

  return [
    vscode.commands.registerCommand("gitflowplus-actions.initialize", async () => {
      await runWrapped(flow.initialize);
    }),

    vscode.commands.registerCommand("gitflowplus-actions.createFeatureBranch", async () => {
      const name = await vscode.window.showInputBox({
        placeHolder: "my-awesome-feature",
        prompt: "请输入新功能分支名字"
      });
      if (!name) {
        return;
      }

      await runWrapped(flow.feature.createBranch, [
        name.split(" ").join("-"),
        "featurePrefix"
      ]);
    }
    ),
    vscode.commands.registerCommand("gitflowplus-actions.createBugfixBranch", async () => {
      const name = await vscode.window.showInputBox({
        placeHolder: "my-awesome-bugfix",
        prompt: "请输入新修复分支名字"
      });
      if (!name) {
        return;
      }

      await runWrapped(flow.feature.createBranch, [
        name.split(" ").join("-"),
        "hotfixPrefix"
      ]);
    }),

    vscode.commands.registerCommand("gitflowplus-actions.startTestBranch", async () => {
      await runWrapped(flow.feature.startTestBranch, []);
    }),

    vscode.commands.registerCommand("gitflowplus-actions.publishBranch", async () => {
      await runWrapped(flow.feature.publishCurrentBranch);
    }),
    vscode.commands.registerCommand("gitflowplus-actions.publishFinish", async () => {
      await runWrapped(flow.release.publishBranchFinish);
    }),

    vscode.commands.registerCommand("gitflowplus-actions.deleteBranch", async () => {
      await runWrapped(flow.deleteBranch);
    }),

    vscode.commands.registerCommand("gitflowplus-actions.publishFeatureBranch", async () => {
      await runWrapped(flow.feature.publishBranch, ["featurePrefix"]);
    }),
    vscode.commands.registerCommand("gitflowplus-actions.publishBugfixBranch", async () => {
      await runWrapped(flow.feature.publishBranch, ["hotfixPrefix"]);
    }),

    vscode.commands.registerCommand("gitflowplus-actions.releaseStart", async () => {
      await runWrapped(flow.requireFlowEnabled);
      await runWrapped(flow.release.precheck);
      const guessedVersion =
        (await runWrapped(flow.release.guess_new_version)) || "";
      const name = await vscode.window.showInputBox({
        placeHolder: guessedVersion,
        prompt: "The name of the release",
        value: guessedVersion
      });
      if (!name) {
        return;
      }
      await runWrapped(flow.release.start, [name.split(" ").join("-")]);
    }),
    vscode.commands.registerCommand("gitflowplus-actions.releaseFinish", async () => {
      await runWrapped(flow.release.finish);
    }),

    vscode.commands.registerCommand("gitflowplus-actions.hotfixStart", async () => {
      await runWrapped(flow.requireFlowEnabled);
      const guessedVersion =
        (await runWrapped(flow.hotfix.guess_new_version)) || "";
      const name = await vscode.window.showInputBox({
        placeHolder: guessedVersion,
        prompt: "The name of the hotfix version",
        value: guessedVersion
      });
      if (!name) {
        return;
      }
      await runWrapped(flow.hotfix.start, [name.split(" ").join("-")]);
    }),
    vscode.commands.registerCommand("gitflowplus-actions.hotfixFinish", async () => {
      await runWrapped(flow.hotfix.finish);
    }),

    vscode.commands.registerCommand("gitflowplus-actions.featureRebase", async () => {
      await runWrapped(flow.feature.rebase, ["feature"]);
    }
    ),
    vscode.commands.registerCommand("gitflowplus-actions.bugfixRebase", async () => {
      await runWrapped(flow.feature.rebase, ["bugfix"]);
    }),

    vscode.languages.registerDefinitionProvider(['json'], new myLang.MyDefinitionProvider()),
    vscode.languages.registerCompletionItemProvider(['javascript'], new myLang.MyCompletionItemProvider(), '.'),
    vscode.languages.registerHoverProvider('json', new myLang.MyHoverProvider()),
  ];
}

export async function activate(context: vscode.ExtensionContext) {
  const disposables = await setup();

  buildTreeView(context);

  context.subscriptions.push(...disposables);
}

// tslint:disable-next-line:no-empty
export function deactivate() { }
