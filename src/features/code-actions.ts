// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { t } from '../i18n';
import { resolveIncludeUri } from '../include-graph';

export class GodotShaderCodeActionProvider implements vscode.CodeActionProvider {

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        // source.fixAll：把所有可自动修复的问题一次性修掉（可配合 codeActionsOnSave）
        const only = context.only;
        if (only && only.contains(vscode.CodeActionKind.SourceFixAll) && !only.contains(vscode.CodeActionKind.SourceOrganizeImports)) {
            const action = this.createFixAll(document);
            return action ? [action] : undefined;
        }

        // source.organizeImports：去重并排序 #include
        if (only && only.contains(vscode.CodeActionKind.SourceOrganizeImports)) {
            const action = this.createOrganizeIncludes(document);
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
        if (msg.includes('never used') || msg.includes('未使用')) {
            return this.createFixRemoveUnusedDeclaration(document, diagnostic);
        }
        if (msg.includes('not a valid function') || msg.includes('不是有效的函数')) {
            return this.createFixDeprecatedFunction(document, diagnostic);
        }
        if (msg.includes('not found') || msg.includes('找不到被包含的文件')) {
            return this.createFixCreateInclude(document, diagnostic);
        }
        return null;
    }

    // 快速修复：删除未使用的 uniform / varying 声明（整行）
    private createFixRemoveUnusedDeclaration(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
        const line = diagnostic.range.start.line;
        const text = document.lineAt(line).text.trim();

        // 只对可以直接删除的声明提供修复（局部变量的初始化可能有副作用）
        if (!/^(?:(?:global|instance)\s+)?(?:uniform|varying)\b/.test(text)) return null;

        const fix = new vscode.CodeAction(t('fix.remove_unused'), vscode.CodeActionKind.QuickFix);
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.delete(document.uri, document.lineAt(line).rangeIncludingLineBreak);
        fix.diagnostics = [diagnostic];
        return fix;
    }

    // 快速修复：废弃函数改名（atan2 → atan，dfdx → dFdx …）
    private createFixDeprecatedFunction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
        const alias: { [key: string]: string } = {
            atan2: 'atan', dfdx: 'dFdx', dfdy: 'dFdy', DFDX: 'dFdx', DFDY: 'dFdy'
        };
        const original = document.getText(diagnostic.range);
        const replacement = alias[original];
        if (!replacement) return null;

        const fix = new vscode.CodeAction(t('fix.rename_function', replacement), vscode.CodeActionKind.QuickFix);
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(document.uri, diagnostic.range, replacement);
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        return fix;
    }

    // 快速修复：创建缺失的 include 文件（写入一个可用的骨架）
    private createFixCreateInclude(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
        if (document.uri.scheme !== 'file') return null;

        const text = document.lineAt(diagnostic.range.start.line).text;
        const match = text.match(/#\s*include\s+"([^"]+)"/);
        if (!match) return null;

        const includePath = match[1];
        const target = resolveIncludeUri(document.uri, includePath);
        if (!target) return null;

        const fix = new vscode.CodeAction(t('fix.create_include', includePath), vscode.CodeActionKind.QuickFix);
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.createFile(target, { ignoreIfExists: true });
        fix.edit.insert(target, new vscode.Position(0, 0),
            `// ${includePath.split('/').pop()} — created by Godot Shader\n\n`);
        fix.diagnostics = [diagnostic];
        return fix;
    }

    /** 整理 include：去重 + 按路径排序（仅当 include 行连续时） */
    private createOrganizeIncludes(document: vscode.TextDocument): vscode.CodeAction | null {
        const includeLines: Array<{ line: number; text: string; path: string }> = [];

        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text;
            const m = text.match(/^\s*#\s*include\s+"([^"]+)"/);
            if (m) includeLines.push({ line: i, text, path: m[1] });
        }
        if (includeLines.length < 2) return null;

        // 只处理连续块，避免误删中间的注释
        for (let i = 1; i < includeLines.length; i++) {
            if (includeLines[i].line !== includeLines[i - 1].line + 1) return null;
        }

        const seen = new Set<string>();
        const unique = includeLines.filter(l => {
            if (seen.has(l.path)) return false;
            seen.add(l.path);
            return true;
        }).sort((a, b) => a.path.localeCompare(b.path));

        const before = includeLines.map(l => l.text.trim()).join('\n');
        const after = unique.map(l => l.text.trim()).join('\n');
        if (before === after) return null;

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(includeLines[0].line, 0, includeLines[includeLines.length - 1].line, document.lineAt(includeLines[includeLines.length - 1].line).text.length),
            after
        );

        const action = new vscode.CodeAction(
            t('fix.organize_includes', String(includeLines.length - unique.length)),
            vscode.CodeActionKind.SourceOrganizeImports
        );
        action.edit = edit;
        return action;
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
