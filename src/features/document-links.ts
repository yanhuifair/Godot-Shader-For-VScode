// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { t } from '../i18n';

/**
 * DocumentLinkProvider — 让 #include "path" 可点击跳转
 */
export class GodotShaderDocumentLinkProvider implements vscode.DocumentLinkProvider {

    public provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentLink[]> {
        const links: vscode.DocumentLink[] = [];
        const includeRegex = /#include\s+"([^"]+)"/g;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const text = line.text;

            let match: RegExpExecArray | null;
            while ((match = includeRegex.exec(text)) !== null) {
                const includePath = match[1];
                // 相对路径按当前文档目录解析；res:// 指向项目根（工作区根目录）
                let targetUri: vscode.Uri;
                if (includePath.startsWith('res://')) {
                    const folders = vscode.workspace.workspaceFolders;
                    if (!folders || folders.length === 0) continue;
                    targetUri = vscode.Uri.joinPath(folders[0].uri, includePath.substring('res://'.length));
                } else {
                    const currentDir = vscode.Uri.joinPath(document.uri, '..');
                    targetUri = vscode.Uri.joinPath(currentDir, includePath);
                }

                const range = new vscode.Range(
                    i, match.index + match[0].indexOf('"') + 1,
                    i, match.index + match[0].lastIndexOf('"')
                );

                const link = new vscode.DocumentLink(range, targetUri);
                link.tooltip = t('link.open_include', includePath);
                links.push(link);
            }
        }

        return links;
    }
}
