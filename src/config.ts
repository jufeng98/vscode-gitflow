import * as vscode from "vscode";

class ConfigReader {
  private _readConfig<T>(key: string, default_: T): T {
    const val = vscode.workspace
      .getConfiguration("gitflowplus-actions")
      .get<T>(key);
    if (val === undefined) {
      return default_;
    }
    return val;
  }

  get deleteBranchOnFinish(): boolean {
    return this._readConfig<boolean>("deleteBranchOnFinish", true);
  }

  get deleteRemoteBranches(): boolean {
    return this._readConfig<boolean>("deleteRemoteBranches", true);
  }
}

export const config = new ConfigReader();
