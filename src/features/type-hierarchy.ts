// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { buildDocIndex, getDocIndex, StructSymbol } from '../symbol-index';
import { getProjectSymbols, readSourceLines } from '../include-graph';
import { computeCodeOnlyLines } from '../utils';

interface StructEntry {
    sym: StructSymbol;
    uri: vscode.Uri;
    lines: string[];
}

function toItem(entry: StructEntry): vscode.TypeHierarchyItem {
    const lineText = entry.lines[entry.sym.line] ?? '';
    const col = Math.max(0, lineText.indexOf(entry.sym.name));
    const range = new vscode.Range(entry.sym.line, 0, entry.sym.endLine, (entry.lines[entry.sym.endLine] ?? '').length);
    const selection = new vscode.Range(entry.sym.line, col, entry.sym.line, col + entry.sym.name.length);
    return new vscode.TypeHierarchyItem(
        vscode.SymbolKind.Struct,
        entry.sym.name,
        `${entry.sym.fields.length} field(s)`,
        entry.uri,
        range,
        selection
    );
}

/** 读取某个文件里的全部 struct（编辑器内容优先，其次磁盘） */
function structsOf(uri: vscode.Uri): StructEntry[] {
    const lines = readSourceLines(uri);
    if (!lines) return [];
    const index = buildDocIndex(computeCodeOnlyLines(lines), lines);
    return index.structs.map(sym => ({ sym, uri, lines }));
}

function linesOf(document: vscode.TextDocument): string[] {
    const out: string[] = [];
    for (let i = 0; i < document.lineCount; i++) out.push(document.lineAt(i).text);
    return out;
}

/**
 * struct 组合关系：
 * - 父类型（supertypes）= 把当前 struct 当字段用的其它 struct
 * - 子类型（subtypes）  = 当前 struct 内部使用的其它 struct 类型
 * 着色器没有继承，这是最接近"类型层次"的语义。
 */
export class GodotShaderTypeHierarchyProvider implements vscode.TypeHierarchyProvider {

    public prepareTypeHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TypeHierarchyItem | vscode.TypeHierarchyItem[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;
        let name = document.getText(wordRange);
        if (!name) return null;

        // 当前文件 + include 里找到全部 struct（跨文件也能作为起点）
        const project = getProjectSymbols(document);
        const entries: StructEntry[] = project.structs.map(s => ({
            sym: s.sym,
            uri: s.origin ? s.origin.uri : document.uri,
            lines: s.origin ? s.origin.lines : linesOf(document)
        }));

        if (!entries.some(e => e.sym.name === name)) {
            // 变量 → 它的 struct 类型（本文件优先，其次 include 里的声明）
            const v = getDocIndex(document).vars.find(v => v.name === name)
                ?? project.vars.find(p => p.sym.name === name)?.sym;
            if (!v) return null;
            name = v.type;
        }

        const entry = entries.find(e => e.sym.name === name);
        return entry ? toItem(entry) : null;
    }

    public provideTypeHierarchySupertypes(
        item: vscode.TypeHierarchyItem,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TypeHierarchyItem[]> {
        return this.related(item, 'supertypes');
    }

    public provideTypeHierarchySubtypes(
        item: vscode.TypeHierarchyItem,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TypeHierarchyItem[]> {
        return this.related(item, 'subtypes');
    }

    private related(item: vscode.TypeHierarchyItem, direction: 'supertypes' | 'subtypes'): vscode.TypeHierarchyItem[] {
        const entries = structsOf(item.uri);
        const self = entries.find(e => e.sym.name === item.name);
        if (!self) return [];

        if (direction === 'subtypes') {
            const types = new Set(self.sym.fields.map(f => f.type));
            return entries.filter(e => types.has(e.sym.name) && e.sym.name !== self.sym.name).map(toItem);
        }

        return entries
            .filter(e => e.sym.name !== self.sym.name && e.sym.fields.some(f => f.type === self.sym.name))
            .map(toItem);
    }
}
