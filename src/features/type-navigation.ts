// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { escapeRegExp } from '../utils';
import { getDocIndex, StructSymbol } from '../symbol-index';
import { getProjectSymbols, resolveIncludeUri, IncludeFile } from '../include-graph';

/** 在项目符号里按名字找 struct（含 include 进来的） */
function findStruct(document: vscode.TextDocument, name: string): { sym: StructSymbol; origin: IncludeFile | null; col: number } | null {
    const project = getProjectSymbols(document);
    const hit = project.structs.find(s => s.sym.name === name);
    return hit ? { sym: hit.sym, origin: hit.origin, col: hit.col } : null;
}

/** 变量 / 参数 / 局部变量声明处的类型名 */
function declaredTypeOf(document: vscode.TextDocument, word: string): string | null {
    const index = getDocIndex(document);
    const candidates = index.vars.filter(v => v.name === word);
    if (candidates.length === 0) return null;
    const local = candidates.find(v => v.keyword === 'local' || v.keyword === 'param');
    return (local ?? candidates[0]).type;
}

/**
 * 类型定义跳转：从变量 / struct 字段跳到它的 struct 定义。
 * 支持跨 `#include`（struct 定义在 `.gdshaderinc` 里也能跳）。
 */
export class GodotShaderTypeDefinitionProvider implements vscode.TypeDefinitionProvider {

    public provideTypeDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;
        const word = document.getText(wordRange);
        if (!word) return null;

        let typeName = declaredTypeOf(document, word);

        // `foo.field` 形式：按字段类型再跳一层
        if (!typeName) {
            const lineText = document.lineAt(position.line).text;
            if (new RegExp('\\.\\s*' + escapeRegExp(word) + '\\b').test(lineText)) {
                const project = getProjectSymbols(document);
                for (const s of project.structs) {
                    const field = s.sym.fields.find(f => f.name === word);
                    if (field) { typeName = field.type; break; }
                }
            }
        }
        if (!typeName) return null;

        const struct = findStruct(document, typeName);
        if (!struct) return null;

        const uri = struct.origin ? struct.origin.uri : document.uri;
        const lines = struct.origin ? struct.origin.lines : null;
        const lineText = lines ? (lines[struct.sym.line] ?? '') : document.lineAt(struct.sym.line).text;
        const col = lineText.indexOf(struct.sym.name) >= 0 ? lineText.indexOf(struct.sym.name) : struct.col;

        return new vscode.Location(uri, new vscode.Range(struct.sym.line, col, struct.sym.line, col + struct.sym.name.length));
    }
}

/**
 * 「转到声明」：对 include 进来的符号，声明位置就是当前文件里那条 `#include`；
 * 其余情况交给定义跳转（着色器没有单独的声明/定义之分）。
 */
export class GodotShaderDeclarationProvider implements vscode.DeclarationProvider {

    constructor(private readonly definitionProvider: { provideDefinition: (d: vscode.TextDocument, p: vscode.Position, t: vscode.CancellationToken) => vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> }) { }

    public provideDeclaration(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;
        const word = document.getText(wordRange);

        const project = getProjectSymbols(document);
        const known =
            project.vars.some(v => v.sym.name === word) ||
            project.funcs.some(f => f.sym.name === word) ||
            project.structs.some(s => s.sym.name === word);
        if (!known) return this.definitionProvider.provideDefinition(document, position, token);

        const origin = (project.vars.find(v => v.sym.name === word)?.origin)
            ?? (project.funcs.find(f => f.sym.name === word)?.origin)
            ?? (project.structs.find(s => s.sym.name === word)?.origin)
            ?? null;

        // 本文件声明的符号：声明即定义
        if (!origin) return this.definitionProvider.provideDefinition(document, position, token);

        // 找到当前文件里引入它的那条 #include（直接 include 才有唯一答案）
        const originKey = origin.uri.toString();
        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text;
            const m = /^\s*#\s*include\s+"([^"]+)"/.exec(text);
            if (!m) continue;
            const target = resolveIncludeUri(document.uri, m[1]);
            if (!target || target.toString() !== originKey) continue;
            const start = text.indexOf(m[1]);
            return new vscode.Location(document.uri, new vscode.Range(i, start, i, start + m[1].length));
        }

        return this.definitionProvider.provideDefinition(document, position, token);
    }
}
