// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { GODOT_SHADER_KEYWORD_SET, GODOT_SHADER_GLSL_BUILTIN_SET, GODOT_SHADER_BUILTIN_NAME_SET, GODOT_SHADER_ENTRY_POINTS } from '../shader-data';
import { computeCodeOnlyLines, escapeRegExp, getSymbolScope } from '../utils';
import { findInIncludes, getProjectSourceFiles, getProjectSymbols } from '../include-graph';
import { getDocIndex } from '../symbol-index';
import { t } from '../i18n';

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

        // 着色器入口函数由引擎按名字调用，改名会直接让着色器失效
        // （只拦函数，`vec3 light = …` 这类同名变量照常可以改）
        if (GODOT_SHADER_ENTRY_POINTS.has(word) && getDocIndex(document).funcs.some(f => f.name === word)) {
            throw new Error(t('rename.entry_point', word));
        }

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
        const wordRegex = new RegExp('\\b' + escapeRegExp(targetWord) + '\\b', 'g');

        const currentLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) currentLines.push(document.lineAt(i).text);

        const project = getProjectSymbols(document);

        // 声明在 include 文件里 → 连同该 include 文件一起重命名（否则声明处会留在旧名字）
        if (findInIncludes(project, n => n === targetWord)) {
            for (const file of getProjectSourceFiles(document)) {
                const codeLines = computeCodeOnlyLines(file.lines);
                for (let i = 0; i < codeLines.length; i++) {
                    const text = codeLines[i];
                    if (!text) continue;
                    wordRegex.lastIndex = 0;
                    let match: RegExpExecArray | null;
                    while ((match = wordRegex.exec(text)) !== null) {
                        edit.replace(file.uri, new vscode.Range(i, match.index, i, match.index + targetWord.length), newName);
                    }
                }
            }
            return edit;
        }

        // 局部变量（函数参数 / 函数体内声明）只在所属函数范围内重命名
        const codeLines = computeCodeOnlyLines(currentLines);
        const scope = getSymbolScope(codeLines, position.line, targetWord);

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
