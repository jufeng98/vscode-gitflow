"use strict";

import * as vscode from "vscode";
import { findGit, git } from "./git";
import { flow } from "./flow";
import { fail } from "./fail";
import { buildTreeView } from "./treeview";

async function runWrapped<T>(fn: (...arg0: any[]) => Thenable<T>, args: any[] = []): Promise<T | null> {
  try {
    return await fn(...args);
  } catch (e: any) {
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

async function setup(disposables: vscode.Disposable[]) {
  const pathHint = vscode.workspace.getConfiguration("git").get<string>("path");
  git.info = await findGit(pathHint);
  vscode.window.setStatusBarMessage(
    "gitflow using git executable: " +
    git.info.path +
    " with version " +
    git.info.version,
    5000
  );
  const commands = [
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
      await runWrapped(flow.release.publishFinish);
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
  ];
  // add disposable
  disposables.push(...commands);
}

export function activate(context: vscode.ExtensionContext) {
  const disposables: vscode.Disposable[] = [];
  buildTreeView(context);
  context.subscriptions.push(
    new vscode.Disposable(() =>
      vscode.Disposable.from(...disposables).dispose()
    )
  );

  setup(disposables).catch(err => console.error(err));
}

export function // tslint:disable-next-line:no-empty
  deactivate() { }
