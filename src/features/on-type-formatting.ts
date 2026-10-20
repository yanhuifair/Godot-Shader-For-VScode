// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { computeCodeOnlyLines } from '../utils';
import { GodotShaderFormatter } from './formatting';

/**
 * On-type formatting：
 * - 输入 `}` 时把该行缩进对齐到匹配的 `{` 所在行
 * - 输入 `;` 时规范化当前行的空格（保留行尾注释与缩进）
 *
 * 只在用户开启了 `editor.formatOnType` 时生效。
 */
export class GodotShaderOnTypeFormattingProvider implements vscode.OnTypeFormattingEditProvider {

    constructor(private readonly formatter: GodotShaderFormatter) {}

    public provideOnTypeFormattingEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        ch: string,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        if (document.languageId !== 'godot-shader') return [];

        if (ch === '}') return this.alignClosingBrace(document, position);
        if (ch === ';') return this.formatStatementLine(document, position);
        return [];
    }

    /** 把刚输入的 `}` 对齐到匹配 `{` 的缩进 */
    private alignClosingBrace(document: vscode.TextDocument, position: vscode.Position): vscode.TextEdit[] {
        const rawLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) rawLines.push(document.lineAt(i).text);
        // 注释/字符串里的括号不参与匹配
        const codeLines = computeCodeOnlyLines(rawLines);

        const lineNo = position.line;
        const openLine = this.findMatchingOpenBrace(codeLines, lineNo, position.character);
        if (openLine < 0 || openLine === lineNo) return [];

        const targetIndent = (rawLines[openLine].match(/^[ \t]*/) || [''])[0];
        const currentIndent = (rawLines[lineNo].match(/^[ \t]*/) || [''])[0];
        if (targetIndent === currentIndent) return [];

        return [vscode.TextEdit.replace(
            new vscode.Range(lineNo, 0, lineNo, currentIndent.length),
            targetIndent
        )];
    }

    /** 从 `}` 向前找匹配的 `{` 所在行，找不到返回 -1 */
    private findMatchingOpenBrace(codeLines: string[], lineNo: number, character: number): number {
        let depth = 0;
        for (let line = lineNo; line >= 0; line--) {
            const code = codeLines[line] ?? '';
            let start = code.length - 1;
            if (line === lineNo) {
                start = Math.min(character - 1, code.length - 1);
            }
            for (let i = start; i >= 0; i--) {
                const c = code[i];
                if (c === '}') {
                    depth++;
                } else if (c === '{') {
                    depth--;
                    if (depth === 0) return line;
                }
            }
        }
        return -1;
    }

    /** 输入 `;` 后规范化当前行（仅当光标在该行末尾） */
    private formatStatementLine(document: vscode.TextDocument, position: vscode.Position): vscode.TextEdit[] {
        const line = document.lineAt(position.line);
        const text = line.text;

        // 只在行尾触发，避免输入 for(;;) 中间的分号时打断输入
        if (text.slice(position.character).trim().length > 0) return [];

        const trimmed = text.trim();
        if (!trimmed || trimmed.startsWith('#')) return [];

        const indent = (text.match(/^[ \t]*/) || [''])[0];
        const body = text.slice(indent.length);
        const formatted = this.formatter.formatSingleLine(body);
        if (formatted === body) return [];

        return [vscode.TextEdit.replace(
            new vscode.Range(position.line, indent.length, position.line, text.length),
            formatted
        )];
    }
}
