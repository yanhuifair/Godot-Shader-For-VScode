// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { GODOT_SHADER_KEYWORD_SET, GODOT_SHADER_GLSL_BUILTIN_SET, GODOT_SHADER_BUILTIN_NAME_SET } from '../shader-data';
import { computeCodeOnlyLines, escapeRegExp, getSymbolScope } from '../utils';

export class GodotShaderRenameProvider implements vscode.RenameProvider {

    public prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);

        // 排除关键字（复用统一的 Set）
        if (GODOT_SHADER_KEYWORD_SET.has(word)) {
            return null;
        }

        // 排除内置变量/常量（全大写名称，使用预计算 Set）
        if (word === word.toUpperCase() && word.length > 2) {
            if (GODOT_SHADER_BUILTIN_NAME_SET.has(word)) {
                return null;
            }
        }

        // 排除 GLSL 内置函数（复用统一的 Set）
        if (GODOT_SHADER_GLSL_BUILTIN_SET.has(word)) {
            return null;
        }

        return { range: wordRange, placeholder: word };
    }

    public provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
    ): vscode.ProviderResult<vscode.WorkspaceEdit> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;

        const targetWord = document.getText(wordRange);
        const edit = new vscode.WorkspaceEdit();

        const lines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            lines.push(document.lineAt(i).text);
        }
        const codeLines = computeCodeOnlyLines(lines);
        // 局部变量（函数参数 / 函数体内声明）只在所属函数范围内重命名，
        // 否则另一个函数里的同名变量会被一起改掉
        const scope = getSymbolScope(codeLines, position.line, targetWord);
        const wordRegex = new RegExp('\\b' + escapeRegExp(targetWord) + '\\b', 'g');

        for (let i = scope.start; i <= scope.end && i < codeLines.length; i++) {
            const text = codeLines[i];
            if (!text) continue;

            wordRegex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = wordRegex.exec(text)) !== null) {
                const range = new vscode.Range(i, match.index, i, match.index + targetWord.length);
                edit.replace(document.uri, range, newName);
            }
        }

        return edit;
    }
}
