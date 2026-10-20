// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { t } from '../i18n';

export class GodotShaderCodeActionProvider implements vscode.CodeActionProvider {

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        // source.fixAll：把所有可自动修复的问题一次性修掉（可配合 codeActionsOnSave）
        const only = context.only;
        if (only && (only.contains(vscode.CodeActionKind.SourceFixAll) || only.contains(vscode.CodeActionKind.Source))) {
            const action = this.createFixAll(document);
            return action ? [action] : undefined;
        }

        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            const fix = this.fixForDiagnostic(document, diagnostic);
            if (fix) actions.push(fix);
        }

        return actions.length > 0 ? actions : undefined;
    }

    /** 根据诊断消息选择对应的修复 */
    private fixForDiagnostic(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
        const msg = diagnostic.message;

        if (msg.includes('semicolon') || msg.includes('分号')) {
            return this.createFixAddSemicolon(document, diagnostic);
        }
        if (msg.includes('shader_type') && (msg.includes('Missing') || msg.includes('缺少'))) {
            return this.createFixAddShaderType(document, diagnostic);
        }
        if ((msg.includes('Unexpected') || msg.includes('多余')) && (msg.includes('brace') || msg.includes('大括号'))) {
            return this.createFixRemoveBrace(document, diagnostic);
        }
        if ((msg.includes('Missing') || msg.includes('缺少')) && (msg.includes('brace') || msg.includes('大括号'))) {
            return this.createFixAddClosingBrace(document, diagnostic);
        }
        return null;
    }

    /**
     * Fix All：把当前文件中所有可自动修复的诊断合并成一个 WorkspaceEdit。
     * 重叠的编辑会被跳过（例如同一行既有缺分号又有多余大括号）。
     */
    private createFixAll(document: vscode.TextDocument): vscode.CodeAction | null {
        const diagnostics = vscode.languages
            .getDiagnostics(document.uri)
            .filter(d => d.source === 'godot-shader');

        const edit = new vscode.WorkspaceEdit();
        const applied: vscode.Diagnostic[] = [];
        const usedRanges: vscode.Range[] = [];

        for (const diagnostic of diagnostics) {
            const fix = this.fixForDiagnostic(document, diagnostic);
            if (!fix || !fix.edit) continue;

            // 收集该 fix 里的编辑（我们自己的 fix 都只写当前文档）
            const edits = fix.edit.get(document.uri);
            if (!edits || edits.length === 0) continue;
            const overlaps = edits.some(e => usedRanges.some(r => r.intersection(e.range)));
            if (overlaps) continue;

            for (const e of edits) {
                edit.replace(document.uri, e.range, e.newText);
                usedRanges.push(e.range);
            }
            applied.push(diagnostic);
        }

        if (applied.length === 0) return null;

        const action = new vscode.CodeAction(
            t('fix.fix_all', String(applied.length)),
            vscode.CodeActionKind.SourceFixAll
        );
        action.edit = edit;
        action.diagnostics = applied;
        action.isPreferred = true;
        return action;
    }

    // 快速修复：添加分号
    private createFixAddSemicolon(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const fix = new vscode.CodeAction(
            t('fix.add_semicolon'),
            vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.insert(document.uri, diagnostic.range.end, ';');
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        return fix;
    }

    // 快速修复：添加 shader_type 声明
    private createFixAddShaderType(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const fix = new vscode.CodeAction(
            t('fix.add_shader_type'),
            vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        const insertPos = new vscode.Position(0, 0);
        fix.edit.insert(document.uri, insertPos, 'shader_type canvas_item;\n\n');
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        return fix;
    }

    // 快速修复：删除多余的反大括号
    private createFixRemoveBrace(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const fix = new vscode.CodeAction(
            t('fix.remove_brace'),
            vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        // 诊断范围正好是那个 `}`；若整行只剩它，则连行一起删掉
        const line = document.lineAt(diagnostic.range.start.line).text;
        const range = line.trim() === '}'
            ? document.lineAt(diagnostic.range.start.line).rangeIncludingLineBreak
            : diagnostic.range;
        fix.edit.delete(document.uri, range);
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        return fix;
    }

    // 快速修复：补全缺少的大括号
    private createFixAddClosingBrace(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const fix = new vscode.CodeAction(
            t('fix.add_brace'),
            vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        const lastLine = document.lineAt(document.lineCount - 1);
        fix.edit.insert(document.uri, lastLine.range.end, '\n}');
        fix.diagnostics = [diagnostic];
        return fix;
    }
}
