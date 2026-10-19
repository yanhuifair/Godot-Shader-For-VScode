// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { computeCodeOnlyLines, escapeRegExp, getSymbolScope } from '../utils';
import { GODOT_SHADER_KEYWORD_SET } from '../shader-data';

export class GodotShaderHighlightProvider implements vscode.DocumentHighlightProvider {

    public provideDocumentHighlights(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.ProviderResult<vscode.DocumentHighlight[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;

        const targetWord = document.getText(wordRange);
        if (!targetWord || targetWord.length === 0) return null;

        // 关键字不显示高亮（复用统一的 Set）
        if (GODOT_SHADER_KEYWORD_SET.has(targetWord)) return null;

        const lines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            lines.push(document.lineAt(i).text);
        }
        const codeLines = computeCodeOnlyLines(lines);
        // 局部符号只在所属函数内高亮
        const scope = getSymbolScope(codeLines, position.line, targetWord);

        const highlights: vscode.DocumentHighlight[] = [];
        const wordRegex = new RegExp('\\b' + escapeRegExp(targetWord) + '\\b', 'g');

        for (let i = scope.start; i <= scope.end && i < codeLines.length; i++) {
            const text = codeLines[i];
            if (!text) continue;

            wordRegex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = wordRegex.exec(text)) !== null) {
                const range = new vscode.Range(i, match.index, i, match.index + targetWord.length);

                // 判断是否为写入引用（声明行 / 赋值左侧）
                const lineText = lines[i];
                const linePrefix = lineText.substring(0, match.index).trim();
                const lineSuffix = lineText.substring(match.index + targetWord.length).trim();
                const isDeclaration = /^(uniform|varying|in\s|out\s|const|global\s+uniform|instance\s+uniform)\b/.test(linePrefix + targetWord + ' ');

                // 判断是否为赋值左侧（写操作）
                const isWrite = lineSuffix.startsWith('=') || /^(\+=|-=|\*=|\/=|\+\+|--)/.test(lineSuffix) || isDeclaration;

                highlights.push(new vscode.DocumentHighlight(
                    range,
                    isWrite ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read
                ));
            }
        }

        return highlights.length > 0 ? highlights : null;
    }
}
