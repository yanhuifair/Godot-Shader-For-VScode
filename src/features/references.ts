// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { computeCodeOnlyLines, escapeRegExp, getSymbolScope } from '../utils';
import { findInIncludes, getProjectSourceFiles, getProjectSymbols } from '../include-graph';

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
        const currentLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) currentLines.push(document.lineAt(i).text);

        const project = getProjectSymbols(document);
        const wordRegex = new RegExp('\\b' + escapeRegExp(targetWord) + '\\b', 'g');

        // 符号声明在某个 include 文件里 → 跨文件查找（当前文件 + 所有 include 文件）
        if (findInIncludes(project, n => n === targetWord)) {
            for (const file of getProjectSourceFiles(document)) {
                if (token.isCancellationRequested) break;
                // 注释/字符串内的同名文字不算引用
                const codeLines = computeCodeOnlyLines(file.lines);
                for (let i = 0; i < codeLines.length; i++) {
                    const text = codeLines[i];
                    if (!text) continue;
                    wordRegex.lastIndex = 0;
                    let match: RegExpExecArray | null;
                    while ((match = wordRegex.exec(text)) !== null) {
                        locations.push(new vscode.Location(
                            file.uri,
                            new vscode.Range(i, match.index, i, match.index + targetWord.length)
                        ));
                    }
                }
            }
            return locations;
        }

        // 局部符号（函数参数 / 函数体内声明）只在所属函数内查找
        const codeLines = computeCodeOnlyLines(currentLines);
        const scope = getSymbolScope(codeLines, position.line, targetWord);

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
