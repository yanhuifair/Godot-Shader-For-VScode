// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { buildDocIndex, getDocIndex, getGlobalSymbols, DocIndex, VarSymbol, FuncSymbol, StructSymbol } from './symbol-index';
import { computeCodeOnlyLines } from './utils';

/** include 的最大递归深度（防御异常/循环引用） */
const MAX_DEPTH = 12;

/** 一个被包含的源文件（.gdshaderinc 或被 include 的 .gdshader） */
export interface IncludeFile {
    uri: vscode.Uri;
    /** 工作区相对路径，用于在悬停/补全里标注来源 */
    label: string;
    index: DocIndex;
    lines: string[];
}

export interface SymbolWithOrigin<T> {
    sym: T;
    /** null 表示来自当前文件 */
    origin: IncludeFile | null;
    /** 符号名在该文件对应行中的列号 */
    col: number;
}

export interface MissingInclude {
    /** 原始 include 路径 */
    includePath: string;
    /** 出现在哪个文件（当前文件或某个被包含文件） */
    fromLabel: string;
    line: number;
}

export interface ProjectSymbols {
    vars: Array<SymbolWithOrigin<VarSymbol>>;
    funcs: Array<SymbolWithOrigin<FuncSymbol>>;
    structs: Array<SymbolWithOrigin<StructSymbol>>;
    /** 已成功解析的 include 文件（按 include 顺序，含传递依赖） */
    includes: IncludeFile[];
    missing: MissingInclude[];
}

/** 文件索引缓存：key = `${fsPath}|${mtimeMs}|${size}` 或 `open|${uri}|${version}` */
const fileCache = new Map<string, { index: DocIndex; lines: string[] }>();
/** 项目符号缓存：key = document.uri，随 document.version 与文件变更自动失效 */
const projectCache = new Map<string, { version: number; value: ProjectSymbols }>();

/** include 文件在磁盘上变化后清空缓存（由扩展的文件监听调用） */
export function invalidateIncludeCache(): void {
    fileCache.clear();
    projectCache.clear();
}

// 编辑任何着色器文件都可能影响"包含它的文件"的符号，清掉项目符号缓存即可
// （文件索引仍按 open|uri|version 缓存，避免每次按键都重新解析）
vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.languageId === 'godot-shader') projectCache.clear();
});

vscode.workspace.onDidCloseTextDocument((doc) => {
    if (doc.languageId !== 'godot-shader') return;
    projectCache.delete(doc.uri.toString());
    const prefix = `open|${doc.uri.toString()}|`;
    for (const key of [...fileCache.keys()]) {
        if (key.startsWith(prefix)) fileCache.delete(key);
    }
});

/**
 * 解析 `#include "path"` 的目标 Uri。
 * - `res://x`  → 工作区根目录下的 x
 * - 其他       → 相对当前文件所在目录
 */
export function resolveIncludeUri(fromUri: vscode.Uri, includePath: string): vscode.Uri | null {
    if (includePath.startsWith('res://')) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return null;
        return vscode.Uri.joinPath(folders[0].uri, includePath.substring('res://'.length));
    }
    return vscode.Uri.joinPath(fromUri, '..', includePath);
}

/** 读取文件内容：优先用编辑器里的（含未保存改动），否则读磁盘 */
function readFileContent(uri: vscode.Uri): { text: string; cacheKey: string } | null {
    const open = vscode.workspace.textDocuments?.find(d => d.uri.toString() === uri.toString());
    if (open) {
        return { text: open.getText(), cacheKey: `open|${uri.toString()}|${open.version}` };
    }
    if (uri.scheme !== 'file') return null;
    try {
        const stat = fs.statSync(uri.fsPath);
        const text = fs.readFileSync(uri.fsPath, 'utf8');
        return { text, cacheKey: `${uri.fsPath}|${stat.mtimeMs}|${stat.size}` };
    } catch {
        return null;
    }
}

function labelOf(uri: vscode.Uri): string {
    const rel = vscode.workspace.asRelativePath(uri, false);
    return rel || path.basename(uri.fsPath || uri.path);
}

/**
 * 取得文件索引（带缓存）。返回 null 表示文件不可读。
 */
function getFileIndex(uri: vscode.Uri): { index: DocIndex; lines: string[] } | null {
    const content = readFileContent(uri);
    if (!content) return null;

    const cached = fileCache.get(content.cacheKey);
    if (cached) return cached;

    const lines = content.text.split('\n');
    const codeLines = computeCodeOnlyLines(lines);
    const entry = { index: buildDocIndex(codeLines, lines), lines };
    fileCache.set(content.cacheKey, entry);
    return entry;
}

/**
 * 收集当前文档 + 所有 `#include` 进来的文件里的符号。
 * 结果里 `origin === null` 的项就是当前文件自己的符号。
 */
export function getProjectSymbols(document: vscode.TextDocument): ProjectSymbols {
    const key = document.uri.toString();
    const version = document.version ?? 0;
    const hit = projectCache.get(key);
    if (hit && hit.version === version) return hit.value;

    const value: ProjectSymbols = { vars: [], funcs: [], structs: [], includes: [], missing: [] };

    // 1) 当前文件
    const localIndex = getDocIndex(document);
    const localLines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) localLines.push(document.lineAt(i).text);

    const pushLocal = <T extends { name: string; line: number }>(arr: Array<SymbolWithOrigin<T>>, sym: T) => {
        const lineText = localLines[sym.line] || '';
        arr.push({ sym, origin: null, col: Math.max(0, lineText.indexOf(sym.name)) });
    };
    for (const v of getGlobalSymbols(localIndex)) pushLocal(value.vars, v);
    for (const f of localIndex.funcs) pushLocal(value.funcs, f);
    for (const s of localIndex.structs) pushLocal(value.structs, s);

    // 2) 递归解析 include
    const visited = new Set<string>([key]);
    const fromLabels = new Map<string, string>([[key, labelOf(document.uri)]]);

    const walk = (fromUri: vscode.Uri, lines: string[], depth: number) => {
        if (depth > MAX_DEPTH) return;

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^\s*#include\s+"([^"]+)"/);
            if (!m) continue;

            const includePath = m[1];
            const targetUri = resolveIncludeUri(fromUri, includePath);
            if (!targetUri) continue;

            const targetKey = targetUri.toString();
            if (visited.has(targetKey)) continue; // 循环 / 重复 include

            const fileIndex = getFileIndex(targetUri);
            if (!fileIndex) {
                value.missing.push({
                    includePath,
                    fromLabel: fromLabels.get(fromUri.toString()) || labelOf(fromUri),
                    line: i
                });
                continue;
            }

            visited.add(targetKey);
            const entry: IncludeFile = {
                uri: targetUri,
                label: labelOf(targetUri),
                index: fileIndex.index,
                lines: fileIndex.lines
            };
            value.includes.push(entry);
            fromLabels.set(targetKey, entry.label);

            const pushFrom = <T extends { name: string; line: number }>(arr: Array<SymbolWithOrigin<T>>, sym: T) => {
                const lineText = entry.lines[sym.line] || '';
                arr.push({ sym, origin: entry, col: Math.max(0, lineText.indexOf(sym.name)) });
            };
            for (const v of getGlobalSymbols(fileIndex.index)) pushFrom(value.vars, v);
            for (const f of fileIndex.index.funcs) pushFrom(value.funcs, f);
            for (const s of fileIndex.index.structs) pushFrom(value.structs, s);

            // 传递 include
            walk(targetUri, fileIndex.lines, depth + 1);
        }
    };

    walk(document.uri, localLines, 0);

    projectCache.set(key, { version, value });
    return value;
}

/** 只在被 include 的文件里查找某个符号（供 hover / definition / signature help 用） */
export function findInIncludes(
    project: ProjectSymbols,
    predicate: (name: string) => boolean
): { kind: 'var' | 'func' | 'struct'; entry: SymbolWithOrigin<VarSymbol | FuncSymbol | StructSymbol> } | null {
    for (const entry of project.vars) {
        if (entry.origin && predicate(entry.sym.name)) return { kind: 'var', entry };
    }
    for (const entry of project.funcs) {
        if (entry.origin && predicate(entry.sym.name)) return { kind: 'func', entry };
    }
    for (const entry of project.structs) {
        if (entry.origin && predicate(entry.sym.name)) return { kind: 'struct', entry };
    }
    return null;
}

/**
 * 当前文档 + 所有 include 文件的源码行，供跨文件「查找引用 / 重命名」使用。
 * 顺序：当前文件优先，随后按 include 顺序。
 */
export function getProjectSourceFiles(document: vscode.TextDocument): Array<{ uri: vscode.Uri; lines: string[] }> {
    const lines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);

    const project = getProjectSymbols(document);
    return [
        { uri: document.uri, lines },
        ...project.includes.map(f => ({ uri: f.uri, lines: f.lines }))
    ];
}
