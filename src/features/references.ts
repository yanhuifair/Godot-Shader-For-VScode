// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { computeCodeOnlyLines, escapeRegExp, getSymbolScope } from '../utils';

export class GodotShaderReferenceProvider implements vscode.ReferenceProvider {

    public provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Location[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;

        const targetWord = document.getText(wordRange);
        if (!targetWord) return null;

        const locations: vscode.Location[] = [];
        const lines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            lines.push(document.lineAt(i).text);
        }
        // 注释/字符串内的同名文字不算引用
        const codeLines = computeCodeOnlyLines(lines);
        // 局部变量只在所属函数内查找，避免把不同函数里的同名变量算进来
        const scope = getSymbolScope(codeLines, position.line, targetWord);

        const wordRegex = new RegExp('\\b' + escapeRegExp(targetWord) + '\\b', 'g');

        for (let i = scope.start; i <= scope.end && i < codeLines.length; i++) {
            const text = codeLines[i];
            if (!text) continue;
            if (token.isCancellationRequested) break;

            wordRegex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = wordRegex.exec(text)) !== null) {
                const range = new vscode.Range(i, match.index, i, match.index + targetWord.length);
                locations.push(new vscode.Location(document.uri, range));
            }
        }

        return locations;
    }
}
