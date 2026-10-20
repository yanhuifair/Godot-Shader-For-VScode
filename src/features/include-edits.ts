// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { getProjectSymbols } from '../include-graph';
import { buildIncludeBlockInsertion, getWorkspaceIncludeSymbols, toIncludePath } from '../workspace-includes';
import { GODOT_SHADER_KEYWORDS, GODOT_SHADER_TYPES } from '../shader-data';
import { t } from '../i18n';

/** 自定义 kind：粘贴/拖拽时顺带补 #include */
export const INCLUDE_EDIT_KIND = vscode.DocumentDropOrPasteEditKind.TextUpdateImports;

const WORD_RE = /[A-Za-z_]\w*/g;

/** 取 DataTransfer 里的纯文本（string / Uint8Array / 文件对象都兼容） */
function readText(dataTransfer: vscode.DataTransfer): string | null {
    const item = dataTransfer.get('text/plain');
    if (!item) return null;
    const value = item.value;
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    return null;
}

/** 取 DataTransfer 里的 uri 列表（拖拽文件时提供） */
function readUris(dataTransfer: vscode.DataTransfer): vscode.Uri[] {
    const item = dataTransfer.get('text/uri-list');
    if (!item) return [];
    const value = item.value;
    const raw = typeof value === 'string' ? value : (value instanceof Uint8Array ? new TextDecoder().decode(value) : '');
    const uris: vscode.Uri[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const text = line.trim();
        if (!text || text.startsWith('#')) continue;
        try {
            const parsed = vscode.Uri.parse(text);
            if (parsed.scheme === 'file') uris.push(parsed);
        } catch {
            // 忽略无法解析的行
        }
    }
    return uris;
}

/** 从一段文本里挑出"可能是符号"的标识符 */
function collectIdentifiers(text: string): Set<string> {
    const words = new Set<string>();
    const keywordSet = new Set(GODOT_SHADER_KEYWORDS);
    const typeSet = new Set(GODOT_SHADER_TYPES);
    let match: RegExpExecArray | null;
    WORD_RE.lastIndex = 0;
    while ((match = WORD_RE.exec(text)) !== null) {
        const word = match[0];
        if (word.length < 2) continue;
        if (keywordSet.has(word) || typeSet.has(word)) continue;
        words.add(word);
    }
    return words;
}

/**
 * 找出「文本里用到、但当前文件（含已有 include）拿不到」的符号，
 * 返回能提供这些符号的 include 文件。
 */
export async function resolveMissingIncludes(
    document: vscode.TextDocument,
    identifiers: Set<string>
): Promise<vscode.Uri[]> {
    if (document.uri.scheme !== 'file') return [];

    const project = getProjectSymbols(document);
    const reachable = new Set<string>();
    for (const v of project.vars) reachable.add(v.sym.name);
    for (const f of project.funcs) reachable.add(f.sym.name);
    for (const s of project.structs) reachable.add(s.sym.name);

    const missing = new Set<string>();
    for (const name of identifiers) {
        if (!reachable.has(name)) missing.add(name);
    }
    if (missing.size === 0) return [];

    const alreadyIncluded = new Set(project.includes.map(inc => inc.uri.toString()));
    const workspace = await getWorkspaceIncludeSymbols();

    const needed: vscode.Uri[] = [];
    const seen = new Set<string>();
    for (const entry of workspace.entries) {
        if (!missing.has(entry.sym.name)) continue;
        const key = entry.uri.toString();
        if (key === document.uri.toString()) continue;
        if (alreadyIncluded.has(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        needed.push(entry.uri);
    }
    return needed;
}

/**
 * 粘贴时自动补 `#include`：
 * 粘贴过来的代码引用了工作区其它 `.gdshaderinc` 里的符号时，
 * 直接把对应的 include 行加进当前文件。
 */
export class GodotShaderPasteEditProvider implements vscode.DocumentPasteEditProvider {

    public async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentPasteEdit[] | undefined> {
        if (document.languageId !== 'godot-shader') return undefined;
        if (context.only && !INCLUDE_EDIT_KIND.contains(context.only)) return undefined;
        if (!vscode.workspace.getConfiguration('godot-shader').get<boolean>('paste.autoInclude', true)) return undefined;

        const text = readText(dataTransfer);
        if (!text || text.length > 200_000) return undefined;

        const identifiers = collectIdentifiers(text);
        if (identifiers.size === 0) return undefined;

        const needed = await resolveMissingIncludes(document, identifiers);
        if (token.isCancellationRequested || needed.length === 0) return undefined;

        const includeEdit = buildIncludeBlockInsertion(document, needed);
        if (!includeEdit) return undefined;

        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, [includeEdit]);

        const edit = new vscode.DocumentPasteEdit(
            text,
            t('paste.add_includes', needed.length),
            INCLUDE_EDIT_KIND
        );
        edit.additionalEdit = workspaceEdit;
        return [edit];
    }
}

/**
 * 拖拽 `.gdshaderinc`（或 `.gdshader`）到编辑器里 → 插入对应的 `#include`
 */
export class GodotShaderDropEditProvider implements vscode.DocumentDropEditProvider {

    public async provideDocumentDropEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentDropEdit[] | undefined> {
        if (document.languageId !== 'godot-shader') return undefined;

        const candidates = readUris(dataTransfer).filter(uri => /\.(gdshaderinc|gdshader)$/i.test(uri.path));
        if (candidates.length === 0 || token.isCancellationRequested) return undefined;

        // 已经 include 过的文件不重复插入
        const project = getProjectSymbols(document);
        const included = new Set(project.includes.map(inc => inc.uri.toString()));

        const lines: string[] = [];
        for (const uri of candidates) {
            if (included.has(uri.toString())) continue;
            const rel = toIncludePath(document.uri, uri);
            if (!rel) continue;
            lines.push(`#include "${rel}"`);
        }
        if (lines.length === 0) return undefined;

        const edit = new vscode.DocumentDropEdit(
            lines.join('\n') + '\n',
            t('drop.add_includes', lines.length),
            INCLUDE_EDIT_KIND
        );
        return [edit];
    }
}

