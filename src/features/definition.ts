// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { collectFuncBlocks, computeCodeOnlyLines, escapeRegExp, parseDeclaration } from '../utils';

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
        const codeLines = computeCodeOnlyLines(lines);

        // 阶段 1: 当前所在函数的参数（最精确）
        const blocks = collectFuncBlocks(codeLines);
        const enclosing = blocks.find(b => position.line >= b.headerLine && position.line <= b.closeLine);
        if (enclosing) {
            const header = codeLines[enclosing.headerLine];
            const parenIdx = header.indexOf('(');
            if (parenIdx >= 0 && enclosing.params.includes(word)) {
                const paramMatch = new RegExp('\\b' + escapeRegExp(word) + '\\b').exec(header.substring(parenIdx));
                if (paramMatch) {
                    const col = parenIdx + paramMatch.index;
                    return new vscode.Location(
                        document.uri,
                        new vscode.Range(enclosing.headerLine, col, enclosing.headerLine, col + word.length)
                    );
                }
            }
        }

        // 阶段 2: 收集所有候选声明，选"离光标最近"的那个（先前向找，找不到再向后找）
        const candidates: Array<{ line: number; col: number; kind: number }> = [];

        for (let i = 0; i < codeLines.length; i++) {
            const line = lines[i];
            const text = line.trim();
            if (!text) continue;

            // 变量声明: uniform/varying/in/out/const/global uniform/instance uniform type name
            const decl = parseDeclaration(text);
            if (decl) {
                if (decl.name === word) {
                    candidates.push({ line: i, col: line.indexOf(decl.name), kind: 3 });
                }
                continue;
            }

            // 跳过 shader_type / render_mode 等无效行
            if (/^(shader_type|render_mode|stencil_mode|group_uniforms)\b/.test(text)) {
                continue;
            }

            // 函数定义: 可选返回类型 + 函数名 + (
            const funcMatch = text.match(/^(?:(\w+(?:\s+\w+)?)\s+)?(\w+)\s*\(/);
            if (funcMatch && funcMatch[2] === word) {
                // 排除 if/for/while 等关键字误匹配
                if (!/^(if|for|while|switch|return)$/.test(funcMatch[2])) {
                    candidates.push({ line: i, col: line.indexOf(funcMatch[2]), kind: 2 });
                }
                continue;
            }

            // 局部变量 / struct 字段: type name = ... / type name; / type name[...]
            const localMatch = text.match(/^(\w+)\s+(\w+)\s*[=;\[\(]/);
            if (localMatch && localMatch[2] === word &&
                !/^(if|for|while|switch|return|else|case|break|continue|discard)$/.test(localMatch[1])) {
                candidates.push({ line: i, col: line.indexOf(localMatch[2]), kind: 1 });
            }
        }

        if (candidates.length === 0) return null;

        // 就近原则：同文件里可能有多处同名（不同函数、struct 字段、全局声明）
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
