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
        const braceStack: number[] = [];

        // 注释/字符串里的 { } 不参与折叠
        const rawLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            rawLines.push(document.lineAt(i).text);
        }
        const codeLines = computeCodeOnlyLines(rawLines);

        for (let i = 0; i < document.lineCount; i++) {
            const text = codeLines[i].trim();
            if (!text) continue;

            for (let j = 0; j < codeLines[i].length; j++) {
                const ch = codeLines[i][j];
                if (ch === '{') {
                    braceStack.push(i);
                } else if (ch === '}') {
                    const start = braceStack.pop();
                    if (start !== undefined && i - start > 1) {
                        ranges.push(new vscode.FoldingRange(
                            start,
                            i,
                            vscode.FoldingRangeKind.Region
                        ));
                    }
                }
            }
        }

        return ranges;
    }
}
