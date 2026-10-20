// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { computeCodeOnlyLines, escapeRegExp, getSymbolScope, isInCommentOrString } from '../utils';
import { getDocIndex } from '../symbol-index';
import { getProjectSymbols } from '../include-graph';

/** 允许联动编辑的符号种类（内置变量/函数不参与，避免误改） */
function isLinkedCandidate(document: vscode.TextDocument, word: string, line: number): boolean {
    const index = getDocIndex(document);
    if (index.vars.some(v => v.name === word)) return true;
    if (index.funcs.some(f => f.name === word)) return true;
    if (index.structs.some(s => s.name === word)) return true;
    if (index.structs.some(s => s.fields.some(f => f.name === word))) return true;

    // include 里的符号：只联动当前文件，仍然安全
    const project = getProjectSymbols(document);
    return project.vars.some(v => v.sym.name === word)
        || project.funcs.some(f => f.sym.name === word)
        || project.structs.some(s => s.sym.name === word);
}

/**
 * 联动编辑（Linked Editing）：改一个名字，同作用域内的其它同名位置一起改。
 * 等价于"边打字边重命名"，但只在本文件生效，且只对已声明的符号启用。
 */
export class GodotShaderLinkedEditingProvider implements vscode.LinkedEditingRangeProvider {

    public provideLinkedEditingRanges(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.LinkedEditingRanges> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return undefined;
        const word = document.getText(wordRange);
        if (!word || !/^[A-Za-z_]\w*$/.test(word)) return undefined;

        const lineText = document.lineAt(position.line).text;
        if (isInCommentOrString(lineText, position.character)) return undefined;
        if (!isLinkedCandidate(document, word, position.line)) return undefined;

        const rawLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) rawLines.push(document.lineAt(i).text);
        const codeLines = computeCodeOnlyLines(rawLines);

        // 局部符号只在所属函数里联动；全局符号整篇联动
        const scope = getSymbolScope(codeLines, position.line, word);
        const ranges: vscode.Range[] = [];
        const regex = new RegExp('\\b' + escapeRegExp(word) + '\\b', 'g');

        for (let i = scope.start; i <= scope.end && i < codeLines.length; i++) {
            if (token.isCancellationRequested) break;
            const text = codeLines[i];
            if (!text) continue;
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(text)) !== null) {
                ranges.push(new vscode.Range(i, match.index, i, match.index + word.length));
            }
        }

        // 至少两处才有联动的意义
        if (ranges.length < 2) return undefined;
        return new vscode.LinkedEditingRanges(ranges, /[A-Za-z_]\w*/);
    }
}
