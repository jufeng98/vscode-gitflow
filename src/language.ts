import * as vscode from "vscode";
import * as path from "path";
import * as fs from 'fs';
import exp from "constants";



export class MyDefinitionProvider implements vscode.DefinitionProvider {
    /**
     * 查找文件定义的provider，匹配到了就return一个location，否则不做处理
     * 最终效果是，当按住Ctrl键时，如果return了一个location，字符串就会变成一个可以点击的链接，否则无任何效果
     * @param document The document in which the command was invoked.
     * @param position The position at which the command was invoked.
     * @param token A cancellation token.
     * @returns A definition or a thenable that resolves to such. The lack of a result can be signaled 
     * by returning `undefined` or `null`.
     */
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
        const fileName = document.fileName;
        const workDir = path.dirname(fileName);
        const word = document.getText(document.getWordRangeAtPosition(position));
        // const line = document.lineAt(position);

        // const workspaceDirectory = vscode.workspace.workspaceFolders || [];
        // const projectPath: string = workspaceDirectory.length > 0 ? workspaceDirectory[0].uri.fsPath : "";

        // console.log('fileName: ' + fileName); // 当前文件完整路径
        // console.log('workDir: ' + workDir); // 当前文件所在目录
        // console.log('word: ' + word); // 当前光标所在单词
        // console.log('line: ' + line.text); // 当前光标所在行
        // console.log('projectPath: ' + projectPath); // 当前工程目录

        // 只处理package.json文件
        if (!/package\.json$/.test(fileName)) {
            return null;
        }

        const json = document.getText();
        const reg = new RegExp(`"(dependencies|devDependencies)":\\s*?\\{[\\s\\S]*?${word.replace(/\//g, '\\/')}[\\s\\S]*?\\}`, 'gm');
        if (!reg.test(json)) {
            return null;
        }

        let destPath = `${workDir}/node_modules/${word.replace(/"/g, '')}/package.json`;
        if (!fs.existsSync(destPath)) {
            return null;
        }

        // new vscode.Position(0, 0) 表示跳转到某个文件的第一行第一列
        return new vscode.Location(vscode.Uri.file(destPath), new vscode.Position(0, 0));
    }

}

export class MyCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionList<vscode.CompletionItem> | vscode.CompletionItem[]> {
        const line = document.lineAt(position);

        const workspaceDirectory = vscode.workspace.workspaceFolders || [];
        const projectPath = workspaceDirectory.length > 0 ? workspaceDirectory[0].uri.fsPath : "";

        // 只截取到光标位置为止，防止一些特殊情况
        const lineText = line.text.substring(0, position.character);
        // 简单匹配，只要当前光标前的字符串为`this.dependencies.`都自动带出所有的依赖
        if (/(^|=| )\w+\.dependencies\.$/g.test(lineText)) {
            const jsonString = fs.readFileSync(`${projectPath}/package.json`, 'utf8');
            const json = JSON.parse(jsonString);
            const dependencies = Object.keys(json.dependencies || {}).concat(Object.keys(json.devDependencies || {}));
            return dependencies.map(dep => {
                // vscode.CompletionItemKind 表示提示的类型
                return new vscode.CompletionItem(dep, vscode.CompletionItemKind.Field);
            });
        }
    }

    resolveCompletionItem?(
        item: vscode.CompletionItem,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CompletionItem> {
        return null;
    }

}

export class MyHoverProvider implements vscode.HoverProvider {

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const fileName = document.fileName;
        const workDir = path.dirname(fileName);
        const word = document.getText(document.getWordRangeAtPosition(position));

        if (!/package\.json$/.test(fileName)) {
            return null;
        }

        const json = document.getText();
        const reg = new RegExp(`"(dependencies|devDependencies)":\\s*?\\{[\\s\\S]*?${word.replace(/\//g, '\\/')}[\\s\\S]*?\\}`, 'gm');
        if (!reg.test(json)) {
            return null;
        }

        let destPath = `${workDir}/node_modules/${word.replace(/"/g, '')}/README.md`;
        if (!fs.existsSync(destPath)) {
            return null;
        }

        const mdContent = fs.readFileSync(destPath, 'utf8');
        // hover内容支持markdown语法
        return new vscode.Hover(mdContent);
    }

}