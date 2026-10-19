// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { computeCodeOnlyLines } from '../utils';

export class GodotShaderFoldingRangeProvider implements vscode.FoldingRangeProvider {

    public provideFoldingRanges(
        document: vscode.TextDocument,
        context: vscode.FoldingContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.FoldingRange[]> {
        const ranges: vscode.FoldingRange[] = [];

        const rawLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            rawLines.push(document.lineAt(i).text);
        }
        // 注释/字符串里的 { } 不参与折叠
        const codeLines = computeCodeOnlyLines(rawLines);

        // ── 1. 大括号块（函数体、if/for/while、struct） ──
        const braceStack: number[] = [];
        for (let i = 0; i < codeLines.length; i++) {
            const code = codeLines[i];
            for (let j = 0; j < code.length; j++) {
                const ch = code[j];
                if (ch === '{') {
                    braceStack.push(i);
                } else if (ch === '}') {
                    const start = braceStack.pop();
                    if (start !== undefined && i - start > 1) {
                        ranges.push(new vscode.FoldingRange(start, i, vscode.FoldingRangeKind.Region));
                    }
                }
            }
        }

        // ── 2. 连续 // 注释块（≥2 行） ──
        let commentStart = -1;
        const flushComment = (endLine: number) => {
            if (commentStart >= 0 && endLine - commentStart >= 1) {
                ranges.push(new vscode.FoldingRange(commentStart, endLine, vscode.FoldingRangeKind.Comment));
            }
            commentStart = -1;
        };
        for (let i = 0; i < rawLines.length; i++) {
            const t = rawLines[i].trim();
            if (t.startsWith('//')) {
                if (commentStart < 0) commentStart = i;
            } else {
                flushComment(i - 1);
            }
        }
        flushComment(rawLines.length - 1);

        // ── 3. 跨行块注释 /* ... */ ──
        let blockStart = -1;
        for (let i = 0; i < rawLines.length; i++) {
            const t = rawLines[i];
            const open = t.indexOf('/*');
            const close = t.indexOf('*/');
            if (blockStart < 0 && open >= 0 && (close < 0 || close < open)) {
                blockStart = i;
            } else if (blockStart >= 0 && close >= 0) {
                if (i - blockStart >= 1) {
                    ranges.push(new vscode.FoldingRange(blockStart, i, vscode.FoldingRangeKind.Comment));
                }
                blockStart = -1;
            }
        }

        // ── 4. #if / #ifdef / #ifndef ... #endif ──
        const preprocStack: number[] = [];
        for (let i = 0; i < rawLines.length; i++) {
            const t = rawLines[i].trim();
            if (/^#(if|ifdef|ifndef)\b/.test(t)) {
                preprocStack.push(i);
            } else if (/^#endif\b/.test(t)) {
                const start = preprocStack.pop();
                if (start !== undefined && i - start >= 2) {
                    ranges.push(new vscode.FoldingRange(start, i, vscode.FoldingRangeKind.Region));
                }
            }
        }

        return ranges;
    }
}
