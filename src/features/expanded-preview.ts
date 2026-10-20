// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { resolveIncludeUri, readSourceLines } from '../include-graph';
import { t } from '../i18n';

/** 虚拟文档 scheme（只读预览） */
export const EXPANDED_SCHEME = 'godot-shader-expanded';
/** include 展开的最大深度 */
const MAX_DEPTH = 12;

/**
 * 只读虚拟文档：把 `#include` 展开成一份完整着色器，便于整体阅读/搜索。
 * 真正的文件不会被修改。
 */
export class ExpandedShaderProvider implements vscode.TextDocumentContentProvider {
    private static readonly contents = new Map<string, string>();

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    public static setContent(uri: vscode.Uri, text: string): void {
        ExpandedShaderProvider.contents.set(uri.toString(), text);
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return ExpandedShaderProvider.contents.get(uri.toString())
            ?? `// ${t('expand.expired')}`;
    }

    /** 内容变更后刷新已打开的预览 */
    public refresh(uri: vscode.Uri, text: string): void {
        ExpandedShaderProvider.setContent(uri, text);
        this._onDidChange.fire(uri);
    }
}

interface ExpandContext {
    seen: Set<string>;
    out: string[];
}

function banner(text: string): string {
    return `// ${'─'.repeat(3)} ${text} ${'─'.repeat(Math.max(3, 60 - text.length))}`;
}

function expandInto(uri: vscode.Uri, lines: string[], ctx: ExpandContext, depth: number): void {
    if (depth > MAX_DEPTH) {
        ctx.out.push(`// ${t('expand.too_deep')}`);
        return;
    }

    for (const line of lines) {
        const match = line.match(/^(\s*)#\s*include\s+"([^"]+)"\s*(.*)$/);
        if (!match) {
            ctx.out.push(line);
            continue;
        }

        const includePath = match[2];
        const trailing = match[3].trim();
        const target = resolveIncludeUri(uri, includePath);

        if (!target) {
            ctx.out.push(`// ⚠️ ${t('expand.unresolved', includePath)}`);
            continue;
        }

        const key = target.toString();
        if (ctx.seen.has(key)) {
            ctx.out.push(`// ${t('expand.duplicate', includePath)}`);
            continue;
        }

        const incLines = readSourceLines(target);
        if (!incLines) {
            ctx.out.push(`// ⚠️ ${t('expand.missing', includePath)}`);
            continue;
        }

        ctx.seen.add(key);
        ctx.out.push(banner(`include: ${includePath}${trailing ? ' ' + trailing : ''}`));
        expandInto(target, incLines, ctx, depth + 1);
        ctx.out.push(banner(`end: ${includePath}`));
    }
}

/**
 * 生成展开后的完整文本（不写盘、不修改原文件）
 */
export function buildExpandedShader(document: vscode.TextDocument): string {
    const lines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);

    const ctx: ExpandContext = {
        seen: new Set([document.uri.toString()]),
        out: [
            banner(t('expand.header')),
            `// ${t('expand.source', vscode.workspace.asRelativePath(document.uri, false) || document.fileName)}`,
            '// ' + '─'.repeat(60),
            ''
        ]
    };

    expandInto(document.uri, lines, ctx, 0);
    return ctx.out.join('\n');
}

/** 命令实现：把当前文件名展开成只读预览，并排在右侧 */
export async function expandIncludesCommand(provider: ExpandedShaderProvider): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'godot-shader') {
        void vscode.window.showWarningMessage(t('expand.need_shader_file'));
        return;
    }

    const source = editor.document;
    const text = buildExpandedShader(source);

    const baseName = source.fileName.split(/[\\/]/).pop() || 'shader';
    const uri = vscode.Uri.parse(`${EXPANDED_SCHEME}:${encodeURIComponent(baseName)}.expanded?${Date.now()}`);
    provider.refresh(uri, text);

    const doc = await vscode.workspace.openTextDocument(uri);
    try {
        await vscode.languages.setTextDocumentLanguage(doc, 'godot-shader');
    } catch {
        // 语言设置失败不影响预览
    }
    await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
        preserveFocus: false
    });
}
