// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { t } from './i18n';
import { invalidateIncludeCache } from './include-graph';
import { invalidateWorkspaceIncludes } from './workspace-includes';
import { GODOT_SHADER_TYPE_DESCRIPTIONS } from './shader-data';
import { GodotShaderWorkspaceSymbolProvider } from './features/workspace-symbols';
import { ExpandedShaderProvider, expandIncludesCommand } from './features/expanded-preview';

export const COMMANDS = {
    expandIncludes: 'godotShader.expandIncludes',
    switchShaderType: 'godotShader.switchShaderType',
    insertTemplate: 'godotShader.insertTemplate',
    showOutput: 'godotShader.showOutput',
    reloadSymbols: 'godotShader.reloadSymbols',
    revealLocation: 'godotShader.revealLocation',
    refreshTree: 'godotShader.refreshTree'
} as const;

const LANGUAGE_ID = 'godot-shader';

/**
 * 注册所有命令。outputChannel 用于把 include 解析等问题暴露给用户。
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    expandedProvider: ExpandedShaderProvider,
    treeProvider?: { refresh(): void }
): void {
    const push = (d: vscode.Disposable) => context.subscriptions.push(d);

    // 1. 展开 #include 预览（只读虚拟文档）
    push(vscode.commands.registerCommand(COMMANDS.expandIncludes, async () => {
        await expandIncludesCommand(expandedProvider);
        outputChannel.appendLine(`[expand] ${t('output.expand_done')}`);
    }));

    // 2. 切换 / 插入 shader_type
    push(vscode.commands.registerCommand(COMMANDS.switchShaderType, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== LANGUAGE_ID) {
            void vscode.window.showWarningMessage(t('expand.need_shader_file'));
            return;
        }
        // .gdshaderinc 是被 include 的片段，不应该有 shader_type
        if (/\.gdshaderinc$/i.test(editor.document.uri.path)) {
            void vscode.window.showWarningMessage(t('cmd.switch_type.not_include'));
            return;
        }

        const items = Object.keys(GODOT_SHADER_TYPE_DESCRIPTIONS).sort().map(type => ({
            label: type,
            description: GODOT_SHADER_TYPE_DESCRIPTIONS[type].desc
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: t('cmd.switch_type.placeholder'),
            title: t('cmd.switch_type.title')
        });
        if (!picked) return;

        const document = editor.document;
        const newLine = `shader_type ${picked.label};`;
        const edit = new vscode.WorkspaceEdit();

        let existingLine = -1;
        for (let i = 0; i < document.lineCount; i++) {
            if (/^\s*shader_type\b/.test(document.lineAt(i).text)) {
                existingLine = i;
                break;
            }
        }

        if (existingLine >= 0) {
            edit.replace(document.uri, document.lineAt(existingLine).range, newLine);
        } else {
            // 插到第一条非注释/非预处理语句之前，保持注释头的阅读顺序
            let insertAt = 0;
            for (let i = 0; i < document.lineCount; i++) {
                const text = document.lineAt(i).text.trim();
                if (!text || text.startsWith('//') || text.startsWith('/*') || text.startsWith('*') || text.startsWith('#')) {
                    insertAt = i + 1;
                    continue;
                }
                break;
            }
            edit.insert(document.uri, new vscode.Position(insertAt, 0), newLine + '\n');
        }

        await vscode.workspace.applyEdit(edit);
        outputChannel.appendLine(`[shader_type] ${picked.label}`);
    }));

    // 3. 插入着色器模板（复用 snippets，避免模板重复维护）
    push(vscode.commands.registerCommand(COMMANDS.insertTemplate, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== LANGUAGE_ID) {
            void vscode.window.showWarningMessage(t('expand.need_shader_file'));
            return;
        }

        const templates = [
            { label: 'canvas_item', snippet: 'Canvas Item Shader', description: t('cmd.template.canvas') },
            { label: 'spatial', snippet: 'Spatial Shader', description: t('cmd.template.spatial') },
            { label: 'sky', snippet: 'Sky Shader', description: t('cmd.template.sky') },
            { label: 'fog', snippet: 'Fog Shader', description: t('cmd.template.fog') },
            { label: 'particles', snippet: 'Particles Shader', description: t('cmd.template.particles') }
        ];

        const picked = await vscode.window.showQuickPick(templates, {
            placeHolder: t('cmd.template.placeholder'),
            title: t('cmd.template.title')
        });
        if (!picked) return;

        await vscode.commands.executeCommand('editor.action.insertSnippet', { name: picked.snippet });
    }));

    // 4. 打开输出面板
    push(vscode.commands.registerCommand(COMMANDS.showOutput, () => {
        outputChannel.show(true);
    }));

    // 5. 重建符号缓存（排查 include 解析用）
    push(vscode.commands.registerCommand(COMMANDS.reloadSymbols, () => {
        invalidateIncludeCache();
        GodotShaderWorkspaceSymbolProvider.invalidateCache();
        invalidateWorkspaceIncludes();
        treeProvider?.refresh();
        outputChannel.appendLine(`[reload] ${new Date().toLocaleTimeString()} ${t('output.reloaded')}`);
        void vscode.window.showInformationMessage(t('cmd.reload.done'));
    }));

    // 6. 跳到指定位置（侧栏点击用）
    push(vscode.commands.registerCommand(COMMANDS.revealLocation, async (uri: vscode.Uri, line: number, character: number) => {
        const document = await vscode.workspace.openTextDocument(uri);
        const position = new vscode.Position(Math.max(0, line), Math.max(0, character));
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }));

    // 7. 刷新侧栏
    push(vscode.commands.registerCommand(COMMANDS.refreshTree, () => {
        treeProvider?.refresh();
    }));
}
