// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { getWorkspaceIncludeFiles, toIncludePath } from '../workspace-includes';
import { computeCodeOnlyLines } from '../utils';

/** shader_type 的合法值（与诊断保持一致） */
const SHADER_TYPES = ['canvas_item', 'spatial', 'sky', 'fog', 'particles'];

/**
 * 内联补全（灰字提示）——只做「几乎不可能猜错」的三件事：
 * 1. `#include "` 之后补全工作区里的 .gdshaderinc 路径
 * 2. `shader_type ` 之后补全类型名并与分号
 * 3. `group_uniforms ` 之后补全当前文件已有的分组名
 */
export class GodotShaderInlineCompletionProvider implements vscode.InlineCompletionItemProvider {

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        if (document.languageId !== 'godot-shader') return undefined;
        if (!vscode.workspace.getConfiguration('godot-shader').get<boolean>('inlineCompletions.enabled', true)) return undefined;

        const lineText = document.lineAt(position.line).text;
        const before = lineText.slice(0, position.character);
        const at = new vscode.Range(position.line, position.character, position.line, position.character);

        // 1) #include "…  → 路径
        const includeMatch = /^\s*#\s*include\s*"([^"]*)$/.exec(before);
        if (includeMatch) {
            const ghost = await this.includeGhost(document, includeMatch[1], lineText.slice(position.character), token);
            if (ghost) return [new vscode.InlineCompletionItem(ghost, at)];
            return undefined;
        }

        // 2) shader_type <prefix>
        const typeMatch = /^\s*shader_type\s+([a-z_]*)$/.exec(before);
        if (typeMatch) {
            const prefix = typeMatch[1];
            const hits = SHADER_TYPES.filter(v => v.startsWith(prefix));
            if (hits.length === 1 && hits[0] !== prefix) {
                const rest = lineText.slice(position.character);
                const tail = /^\s*;/.test(rest) ? '' : ';';
                return [new vscode.InlineCompletionItem(hits[0].slice(prefix.length) + tail, at)];
            }
            return undefined;
        }

        // 3) group_uniforms <prefix> → 当前文件里已有的分组名
        const groupMatch = /^\s*group_uniforms\s+([A-Za-z_]\w*)$/.exec(before);
        if (groupMatch) {
            const prefix = groupMatch[1];
            const groups = new Set<string>();
            const rawLines: string[] = [];
            for (let i = 0; i < document.lineCount; i++) rawLines.push(document.lineAt(i).text);
            // 用抹掉注释的代码行判断，注释里的分组名不算
            for (const text of computeCodeOnlyLines(rawLines)) {
                const m = /^\s*group_uniforms\s+([A-Za-z_]\w*)\s*;/.exec(text);
                if (m) groups.add(m[1]);
            }
            const hits = [...groups].filter(g => g.startsWith(prefix) && g !== prefix);
            if (hits.length === 1) {
                return [new vscode.InlineCompletionItem(hits[0].slice(prefix.length), at)];
            }
        }

        return undefined;
    }

    /** 根据已输入的路径片段，给出唯一的补全后缀（含收尾引号） */
    private async includeGhost(
        document: vscode.TextDocument,
        typed: string,
        restOfLine: string,
        token: vscode.CancellationToken
    ): Promise<string | null> {
        if (document.uri.scheme !== 'file') return null;

        const files = await getWorkspaceIncludeFiles();
        if (token.isCancellationRequested) return null;

        const candidates: string[] = [];
        for (const uri of files) {
            const rel = toIncludePath(document.uri, uri);
            if (rel) candidates.push(rel);
        }
        if (candidates.length === 0) return null;

        const lower = typed.toLowerCase();
        const matches = candidates.filter(c => c.toLowerCase().startsWith(lower) && c.length > typed.length);
        if (matches.length === 0) return null;

        // 多条时只补全它们的公共前缀，避免乱猜
        let tail = matches[0].slice(typed.length);
        for (const m of matches.slice(1)) {
            let i = 0;
            while (i < tail.length && i < m.length - typed.length && tail[i] === m[typed.length + i]) i++;
            tail = tail.slice(0, i);
        }
        if (!tail) return null;

        // 已经精确到一个文件、且光标后面还没有引号 → 顺手补上引号
        const closed = /^[^"]*"/.test(restOfLine);
        const complete = matches.length === 1 && typed.length + tail.length === matches[0].length;
        if (complete && !closed) tail += '"';

        return tail;
    }
}
