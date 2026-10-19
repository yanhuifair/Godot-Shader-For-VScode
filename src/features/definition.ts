// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { getDocIndex } from '../symbol-index';

export class GodotShaderDefinitionProvider implements vscode.DefinitionProvider {

    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
        // 阶段 0: 检查是否在 #include 路径上 — 跳转到被引用的文件
        const lineText = document.lineAt(position.line).text;
        const includeMatch = lineText.match(/#include\s+"([^"]+)"/);
        if (includeMatch) {
            const quoteStart = lineText.indexOf('"');
            const quoteEnd = lineText.lastIndexOf('"');
            if (position.character > quoteStart && position.character < quoteEnd) {
                const includePath = includeMatch[1];
                // Godot 的 res:// 指向项目根（工作区根目录），不能按"当前文件目录 + res://..."拼接
                if (includePath.startsWith('res://')) {
                    const folders = vscode.workspace.workspaceFolders;
                    if (!folders || folders.length === 0) return null;
                    const target = vscode.Uri.joinPath(folders[0].uri, includePath.substring('res://'.length));
                    return new vscode.Location(target, new vscode.Position(0, 0));
                }
                const currentDir = vscode.Uri.joinPath(document.uri, '..');
                const targetUri = vscode.Uri.joinPath(currentDir, includePath);
                return new vscode.Location(targetUri, new vscode.Position(0, 0));
            }
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;
        const word = document.getText(wordRange);

        const lines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);

        // 阶段 1: 从文档符号索引收集所有同名声明（变量 / 参数 / 函数 / struct / 字段）
        const index = getDocIndex(document);
        const candidates: Array<{ line: number; col: number }> = [];
        const add = (line: number, name: string) => {
            const col = lines[line] ? lines[line].indexOf(name) : -1;
            if (col >= 0) candidates.push({ line, col });
        };

        for (const v of index.vars) {
            if (v.name === word) add(v.line, word);
        }
        for (const f of index.funcs) {
            if (f.name === word) add(f.line, word);
        }
        for (const s of index.structs) {
            if (s.name === word) add(s.line, word);
            for (const field of s.fields) {
                if (field.name === word) add(field.line, word);
            }
        }

        if (candidates.length === 0) return null;

        // 阶段 2: 就近原则（同名符号可能出现在不同函数/struct 里）
        const before = candidates.filter(c => c.line <= position.line).sort((a, b) => b.line - a.line);
        const after = candidates.filter(c => c.line > position.line).sort((a, b) => a.line - b.line);
        const pick = before[0] || after[0];
        if (!pick) return null;

        return new vscode.Location(
            document.uri,
            new vscode.Range(pick.line, pick.col, pick.line, pick.col + word.length)
        );
    }
}
