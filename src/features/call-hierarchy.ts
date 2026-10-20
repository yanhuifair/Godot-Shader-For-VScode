// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { collectFuncBlocks, computeCodeOnlyLines, escapeRegExp, FuncBlock } from '../utils';
import { buildDocIndex, FuncSymbol, getDocIndex } from '../symbol-index';
import { getProjectSymbols, readSourceLines } from '../include-graph';

interface FuncLocation {
    uri: vscode.Uri;
    name: string;
    line: number;
    col: number;
    lines: string[];
    block: FuncBlock | null;
    symbol: FuncSymbol | null;
}


/**
 * 函数调用层次：
 * - 光标在函数名/调用处 → 显示「谁调用了它」与「它调用了谁」
 * - 搜索范围：当前文件 + 当前文件 include 进来的文件
 */
export class GodotShaderCallHierarchyProvider implements vscode.CallHierarchyProvider {

    public async prepareCallHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | null> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const name = document.getText(range);
        if (!name) return null;

        const located = this.locate(document, name);
        if (!located) return null;

        return this.toItem(located);
    }

    public async provideCallHierarchyIncomingCalls(
        item: vscode.CallHierarchyItem,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyIncomingCall[]> {
        const calleeName = item.name;
        const doc = this.activeShaderDocument();
        if (!doc) return [];

        const results = new Map<string, vscode.CallHierarchyIncomingCall>();
        const callRegex = new RegExp('\\b' + escapeRegExp(calleeName) + '\\s*\\(', 'g');

        for (const file of this.searchFiles(doc)) {
            if (token.isCancellationRequested) break;
            const codeLines = computeCodeOnlyLines(file.lines);
            const blocks = collectFuncBlocks(codeLines);

            for (let line = 0; line < codeLines.length; line++) {
                // 声明行本身不算调用
                if (file.uri.toString() === item.uri.toString() && line === item.range.start.line) continue;

                const text = codeLines[line];
                if (!text) continue;

                callRegex.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = callRegex.exec(text)) !== null) {
                    const block = this.enclosingBlock(blocks, line);
                    if (!block) continue;

                    const key = `${file.uri.toString()}#${block.name}`;
                    const fromItem = this.blockToItem(file.uri, file.lines, block);
                    const existing = results.get(key);
                    const callRange = new vscode.Range(line, match.index, line, match.index + calleeName.length);

                    if (existing) {
                        existing.fromRanges.push(callRange);
                    } else {
                        results.set(key, new vscode.CallHierarchyIncomingCall(fromItem, [callRange]));
                    }
                }
            }
        }

        return [...results.values()];
    }

    public async provideCallHierarchyOutgoingCalls(
        item: vscode.CallHierarchyItem,
        token: vscode.CancellationToken
    ): Promise<vscode.CallHierarchyOutgoingCall[]> {
        const lines = readSourceLines(item.uri);
        if (!lines) return [];

        const codeLines = computeCodeOnlyLines(lines);
        const blocks = collectFuncBlocks(codeLines);
        const self = blocks.find(b => b.name === item.name);
        if (!self) return [];

        // 该文件自身 + 当前文档 include 图里的用户函数
        const fileIndex = buildDocIndex(codeLines, lines);
        const known = new Map<string, FuncLocation>();
        for (const f of fileIndex.funcs) {
            known.set(f.name, {
                uri: item.uri,
                name: f.name,
                line: f.line,
                col: Math.max(0, (lines[f.line] || '').indexOf(f.name)),
                lines,
                block: blocks.find(b => b.name === f.name) || null,
                symbol: f
            });
        }

        const doc = this.activeShaderDocument();
        if (doc) {
            for (const entry of getProjectSymbols(doc).funcs) {
                if (entry.origin && !known.has(entry.sym.name)) {
                    known.set(entry.sym.name, {
                        uri: entry.origin.uri,
                        name: entry.sym.name,
                        line: entry.sym.line,
                        col: entry.col,
                        lines: entry.origin.lines,
                        block: null,
                        symbol: entry.sym
                    });
                }
            }
        }

        const results = new Map<string, vscode.CallHierarchyOutgoingCall>();
        const callRegex = /\b([A-Za-z_]\w*)\s*\(/g;

        for (let line = self.openLine; line <= self.closeLine; line++) {
            if (token.isCancellationRequested) break;
            const text = codeLines[line];
            if (!text) continue;

            callRegex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = callRegex.exec(text)) !== null) {
                const calleeName = match[1];
                if (calleeName === item.name) continue; // 递归单独处理也可以，这里跳过自身减少噪音

                const target = known.get(calleeName);
                if (!target) continue; // 内置函数不展开

                const key = `${target.uri.toString()}#${target.name}`;
                const range = new vscode.Range(line, match.index, line, match.index + calleeName.length);
                const existing = results.get(key);
                if (existing) {
                    existing.fromRanges.push(range);
                } else {
                    results.set(key, new vscode.CallHierarchyOutgoingCall(this.toItem(target), [range]));
                }
            }
        }

        return [...results.values()];
    }

    // ── 内部工具 ──

    private activeShaderDocument(): vscode.TextDocument | null {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'godot-shader') return editor.document;
        return null;
    }

    /** 当前文件 + 所有 include 文件 */
    private searchFiles(document: vscode.TextDocument): Array<{ uri: vscode.Uri; lines: string[] }> {
        const lines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);

        const project = getProjectSymbols(document);
        return [
            { uri: document.uri, lines },
            ...project.includes.map(f => ({ uri: f.uri, lines: f.lines }))
        ];
    }

    /** 在当前文档（含 include）中定位函数定义 */
    private locate(document: vscode.TextDocument, name: string): FuncLocation | null {
        const index = getDocIndex(document);
        const local = index.funcs.find(f => f.name === name);
        if (local) {
            const lines: string[] = [];
            for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);
            const codeLines = computeCodeOnlyLines(lines);
            return {
                uri: document.uri,
                name: local.name,
                line: local.line,
                col: Math.max(0, (lines[local.line] || '').indexOf(local.name)),
                lines,
                block: collectFuncBlocks(codeLines).find(b => b.name === name) || null,
                symbol: local
            };
        }

        const fromInclude = getProjectSymbols(document).funcs.find(e => e.origin && e.sym.name === name);
        if (!fromInclude || !fromInclude.origin) return null;

        const lines = fromInclude.origin.lines;
        return {
            uri: fromInclude.origin.uri,
            name,
            line: fromInclude.sym.line,
            col: fromInclude.col,
            lines,
            block: collectFuncBlocks(computeCodeOnlyLines(lines)).find(b => b.name === name) || null,
            symbol: fromInclude.sym
        };
    }

    private enclosingBlock(blocks: FuncBlock[], line: number): FuncBlock | null {
        let best: FuncBlock | null = null;
        for (const b of blocks) {
            if (line >= b.headerLine && line <= b.closeLine) {
                if (!best || b.closeLine - b.headerLine < best.closeLine - best.headerLine) best = b;
            }
        }
        return best;
    }

    private blockToItem(uri: vscode.Uri, lines: string[], block: FuncBlock): vscode.CallHierarchyItem {
        const header = lines[block.headerLine] || '';
        const col = Math.max(0, header.indexOf(block.name));
        const range = new vscode.Range(block.headerLine, 0, block.closeLine, (lines[block.closeLine] || '').length);
        const selection = new vscode.Range(block.headerLine, col, block.headerLine, col + block.name.length);
        return new vscode.CallHierarchyItem(
            vscode.SymbolKind.Function,
            block.name,
            header.trim(),
            uri,
            range,
            selection
        );
    }

    private toItem(loc: FuncLocation): vscode.CallHierarchyItem {
        const header = loc.lines[loc.line] || '';
        const range = loc.block
            ? new vscode.Range(loc.block.headerLine, 0, loc.block.closeLine, (loc.lines[loc.block.closeLine] || '').length)
            : new vscode.Range(loc.line, 0, loc.line, header.length);
        const selection = new vscode.Range(loc.line, loc.col, loc.line, loc.col + loc.name.length);
        const detail = loc.symbol
            ? `${loc.symbol.returnType} ${loc.symbol.name}(${loc.symbol.params.map(p => `${p.type} ${p.name}`.trim()).join(', ')})`
            : header.trim();

        return new vscode.CallHierarchyItem(
            vscode.SymbolKind.Function,
            loc.name,
            detail,
            loc.uri,
            range,
            selection
        );
    }
}
