// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { buildDocIndex, getGlobalSymbols, VarSymbol, FuncSymbol, StructSymbol } from './symbol-index';
import { readSourceLines } from './include-graph';
import { computeCodeOnlyLines } from './utils';

export type WorkspaceSymbolEntry =
    | { kind: 'var'; sym: VarSymbol; uri: vscode.Uri; label: string }
    | { kind: 'func'; sym: FuncSymbol; uri: vscode.Uri; label: string }
    | { kind: 'struct'; sym: StructSymbol; uri: vscode.Uri; label: string };

export interface WorkspaceIncludeSymbols {
    entries: WorkspaceSymbolEntry[];
    /** 扫描到的 .gdshaderinc 文件数 */
    fileCount: number;
}

/** 最多扫描多少个 include 文件（防止超大项目卡顿） */
const MAX_FILES = 200;
/** 缓存有效期：文件监听之外的兜底（ms） */
const TTL = 30_000;

let cache: { value: WorkspaceIncludeSymbols; at: number } | null = null;
let loading: Promise<WorkspaceIncludeSymbols> | null = null;
/** 工作区内所有 `.gdshaderinc`（用于内联补全的路径提示与侧栏列表） */
let fileCache: { uris: vscode.Uri[]; at: number } | null = null;

/** 文件变化时由扩展调用 */
export function invalidateWorkspaceIncludes(): void {
    cache = null;
    fileCache = null;
}

/**
 * 扫描工作区内所有 `.gdshaderinc`，收集其中的 uniform / 函数 / struct，
 * 用于补全时提供「尚未 include 的符号」并在接受时自动补 `#include`。
 */
export function getWorkspaceIncludeSymbols(): Promise<WorkspaceIncludeSymbols> {
    if (cache && Date.now() - cache.at < TTL) {
        return Promise.resolve(cache.value);
    }
    if (loading) return loading;

    loading = (async () => {
        const entries: WorkspaceSymbolEntry[] = [];
        let files: vscode.Uri[] = [];
        try {
            files = await vscode.workspace.findFiles('**/*.gdshaderinc', '**/node_modules/**', MAX_FILES);
        } catch {
            files = [];
        }

        for (const uri of files) {
            const lines = readSourceLines(uri);
            if (!lines) continue;

            const label = vscode.workspace.asRelativePath(uri, false) || uri.path;
            const index = buildDocIndex(computeCodeOnlyLines(lines), lines);

            for (const v of getGlobalSymbols(index)) {
                if (v.name.length > 1) entries.push({ kind: 'var', sym: v, uri, label });
            }
            for (const f of index.funcs) {
                if (f.name.length > 1) entries.push({ kind: 'func', sym: f, uri, label });
            }
            for (const s of index.structs) {
                if (s.name.length > 1) entries.push({ kind: 'struct', sym: s, uri, label });
            }
        }

        const value: WorkspaceIncludeSymbols = { entries, fileCount: files.length };
        cache = { value, at: Date.now() };
        loading = null;
        return value;
    })();

    return loading;
}

/** 工作区内所有 `.gdshaderinc`（用于内联补全的路径提示与侧栏列表） */
export async function getWorkspaceIncludeFiles(): Promise<vscode.Uri[]> {
    if (fileCache && Date.now() - fileCache.at < TTL) return fileCache.uris;
    let uris: vscode.Uri[] = [];
    try {
        uris = await vscode.workspace.findFiles('**/*.gdshaderinc', '**/node_modules/**', MAX_FILES);
    } catch {
        uris = [];
    }
    fileCache = { uris, at: Date.now() };
    return uris;
}

/** 从 `from` 到 `target` 的 include 写法（相对路径，统一用 `/`） */
export function toIncludePath(fromUri: vscode.Uri, targetUri: vscode.Uri): string | null {
    if (fromUri.scheme !== 'file' || targetUri.scheme !== 'file') return null;
    const path = require('path') as typeof import('path');
    const rel = path.relative(path.dirname(fromUri.fsPath), targetUri.fsPath);
    if (!rel) return null;
    return rel.split(path.sep).join('/');
}

/** `#include` 应插入的行号：最后一条 include 之后 → shader_type 之后 → 文件开头 */
export function includeInsertionLine(document: vscode.TextDocument): number {
    let lastInclude = -1;
    let shaderTypeLine = -1;
    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        if (/^\s*#\s*include\b/.test(text)) lastInclude = i;
        else if (/^\s*shader_type\b/.test(text)) shaderTypeLine = i;
    }
    return lastInclude >= 0 ? lastInclude + 1 : (shaderTypeLine >= 0 ? shaderTypeLine + 1 : 0);
}

/**
 * 批量插入 `#include "..."`（一次编辑，保持传入顺序）
 */
export function buildIncludeBlockInsertion(document: vscode.TextDocument, targetUris: vscode.Uri[]): vscode.TextEdit | null {
    const rels: string[] = [];
    for (const uri of targetUris) {
        const rel = toIncludePath(document.uri, uri);
        if (rel && !rels.includes(rel)) rels.push(rel);
    }
    if (rels.length === 0) return null;

    const text = rels.map(r => `#include "${r}"`).join('\n') + '\n';
    return vscode.TextEdit.insert(new vscode.Position(includeInsertionLine(document), 0), text);
}

/**
 * 计算插入 `#include "<rel>"` 的位置：优先放在最后一条 #include 之后，
 * 其次放在 shader_type 之后，都没有就放文件开头。
 */
export function buildIncludeInsertion(document: vscode.TextDocument, targetUri: vscode.Uri): vscode.TextEdit | null {
    return buildIncludeBlockInsertion(document, [targetUri]);
}
