// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { getDocIndex } from '../symbol-index';

export class GodotShaderDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    public provideDocumentSymbols(
        document: vscode.TextDocument,
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        const index = getDocIndex(document);
        const symbols: vscode.DocumentSymbol[] = [];

        const lineRange = (line: number): vscode.Range => {
            const length = document.lineAt(line).text.length;
            return new vscode.Range(line, 0, line, length);
        };
        const nameRange = (line: number, name: string): vscode.Range => {
            const col = Math.max(0, document.lineAt(line).text.indexOf(name));
            return new vscode.Range(line, col, line, col + name.length);
        };

        // ── struct（含字段子节点） ──
        for (const s of index.structs) {
            const symbol = new vscode.DocumentSymbol(
                s.name,
                `struct — ${s.fields.length} fields`,
                vscode.SymbolKind.Struct,
                new vscode.Range(s.line, 0, s.endLine, document.lineAt(s.endLine).text.length),
                nameRange(s.line, s.name)
            );
            for (const f of s.fields) {
                symbol.children.push(new vscode.DocumentSymbol(
                    f.name,
                    f.type,
                    vscode.SymbolKind.Field,
                    lineRange(f.line),
                    nameRange(f.line, f.name)
                ));
            }
            symbols.push(symbol);
        }

        // ── 全局变量：uniform / varying / const ──
        for (const v of index.vars) {
            if (v.funcName) continue;
            const kind = v.keyword === 'uniform' ? vscode.SymbolKind.Property
                : v.keyword === 'const' ? vscode.SymbolKind.Constant
                : vscode.SymbolKind.Variable;
            symbols.push(new vscode.DocumentSymbol(
                v.name,
                v.keyword === 'global' ? v.type : `${v.keyword} ${v.type}${v.hint ? ' : ' + v.hint : ''}`,
                kind,
                lineRange(v.line),
                nameRange(v.line, v.name)
            ));
        }

        // ── 函数（含入口函数） ──
        for (const f of index.funcs) {
            symbols.push(new vscode.DocumentSymbol(
                f.name,
                `${f.returnType} ${f.name}(${f.params.map(p => `${p.type} ${p.name}`.trim()).join(', ')})`,
                vscode.SymbolKind.Function,
                lineRange(f.line),
                nameRange(f.line, f.name)
            ));
        }

        // 按行号排序，大纲里顺序与文档一致
        symbols.sort((a, b) => a.range.start.line - b.range.start.line);
        return symbols;
    }
}
