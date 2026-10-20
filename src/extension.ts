// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { GodotShaderCompletionProvider } from './features/completion';
import { GodotShaderHoverProvider } from './features/hover';
import { GodotShaderFormatter } from './features/formatting';
import { GodotShaderDiagnosticProvider } from './features/diagnostics';
import { GodotShaderSignatureHelpProvider } from './features/signature-help';
import { GodotShaderCodeActionProvider } from './features/code-actions';
import { GodotShaderFoldingRangeProvider } from './features/folding';
import { GodotShaderSemanticTokensProvider, getSemanticTokensLegend } from './features/semantic-tokens';
import { GodotShaderDefinitionProvider } from './features/definition';
import { GodotShaderReferenceProvider } from './features/references';
import { GodotShaderColorProvider } from './features/color-picker';
import { GodotShaderWorkspaceSymbolProvider } from './features/workspace-symbols';
import { GodotShaderRenameProvider } from './features/rename';
import { GodotShaderHighlightProvider } from './features/highlight';
import { GodotShaderDocumentSymbolProvider } from './features/symbol-provider';
import { GodotShaderInlayHintsProvider } from './features/inlay-hints';
import { GodotShaderCodeLensProvider } from './features/code-lens';
import { GodotShaderDocumentLinkProvider } from './features/document-links';
import { GodotShaderSelectionRangeProvider } from './features/selection-range';
import { GodotShaderOnTypeFormattingProvider } from './features/on-type-formatting';
import { GodotShaderCallHierarchyProvider } from './features/call-hierarchy';
import { t } from './i18n';
import { invalidateIncludeCache, setIncludeLogger } from './include-graph';
import { invalidateWorkspaceIncludes } from './workspace-includes';
import { registerCommands, COMMANDS } from './commands';
import { ExpandedShaderProvider, EXPANDED_SCHEME } from './features/expanded-preview';

export function activate(context: vscode.ExtensionContext) {
    console.log('Godot Shader extension is now active!');

    // 输出面板（排查 include 解析、查看命令结果）
    const outputChannel = vscode.window.createOutputChannel('Godot Shader');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(`Godot Shader activated — ${new Date().toLocaleString()}`);

    // include 解析日志（默认关闭，见 godot-shader.trace.includeResolution）
    setIncludeLogger((message) => {
        if (vscode.workspace.getConfiguration('godot-shader').get<boolean>('trace.includeResolution', false)) {
            outputChannel.appendLine(message);
        }
    });

    // 状态栏（点击可打开输出面板）
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 100
    );
    statusBarItem.command = COMMANDS.showOutput;
    statusBarItem.tooltip = t('statusbar.tooltip');
    context.subscriptions.push(statusBarItem);

    const updateStatusBar = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'godot-shader') {
            statusBarItem.hide();
            return;
        }
        const match = editor.document.getText().match(/^shader_type\s+(\w+)/m);
        statusBarItem.text = `$(symbol-namespace) ${match ? match[1] : t('statusbar.unknown')}`;
        statusBarItem.show();
    };

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'godot-shader') updateStatusBar();
        })
    );
    updateStatusBar();

    // Provider 注册辅助
    const LANG = { language: 'godot-shader', scheme: 'file' } as const;
    const push = (d: vscode.Disposable) => context.subscriptions.push(d);

    // 监听 .gdshader / .gdshaderinc 文件变化以失效缓存（工作区符号 + 跨文件符号）
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{gdshader,gdshaderinc}');
    const invalidateCaches = () => {
        GodotShaderWorkspaceSymbolProvider.invalidateCache();
        invalidateIncludeCache();
        invalidateWorkspaceIncludes();
    };
    watcher.onDidChange(invalidateCaches);
    watcher.onDidCreate(invalidateCaches);
    watcher.onDidDelete(invalidateCaches);
    push(watcher);

    // 代码补全
    push(vscode.languages.registerCompletionItemProvider(LANG,
        new GodotShaderCompletionProvider(),
        ...GodotShaderCompletionProvider.triggerCharacters));

    // 悬停提示
    push(vscode.languages.registerHoverProvider(LANG, new GodotShaderHoverProvider()));

    // 格式化
    const formatter = new GodotShaderFormatter();
    push(vscode.languages.registerDocumentFormattingEditProvider(LANG, formatter));
    push(vscode.languages.registerDocumentRangeFormattingEditProvider(LANG, formatter));
    // 输入 } / ; 时即时整理（需开启 editor.formatOnType）
    push(vscode.languages.registerOnTypeFormattingEditProvider(LANG,
        new GodotShaderOnTypeFormattingProvider(formatter), '}', ';'));

    // 诊断
    const diagnosticProvider = new GodotShaderDiagnosticProvider();
    diagnosticProvider.activate(context);
    push(diagnosticProvider); // 注册到 subscriptions，扩展停用时自动 dispose（清理防抖定时器与诊断集合）

    // 函数签名
    push(vscode.languages.registerSignatureHelpProvider(LANG,
        new GodotShaderSignatureHelpProvider(), '(', ','));

    // 快速修复
    push(vscode.languages.registerCodeActionsProvider(LANG,
        new GodotShaderCodeActionProvider(),
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.SourceFixAll, vscode.CodeActionKind.SourceOrganizeImports] }));

    // 代码折叠
    push(vscode.languages.registerFoldingRangeProvider(LANG, new GodotShaderFoldingRangeProvider()));

    // 语义着色
    push(vscode.languages.registerDocumentSemanticTokensProvider(LANG,
        new GodotShaderSemanticTokensProvider(), getSemanticTokensLegend()));

    // 跳转定义
    push(vscode.languages.registerDefinitionProvider(LANG, new GodotShaderDefinitionProvider()));

    // 查找引用
    push(vscode.languages.registerReferenceProvider(LANG, new GodotShaderReferenceProvider()));

    // 颜色选择器 — 配置变更时重新注册以即时刷新
    let colorProviderDisposable = vscode.languages.registerColorProvider(LANG, new GodotShaderColorProvider());
    push(colorProviderDisposable);
    push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('godot-shader.colorPicker.enabled')) {
            colorProviderDisposable.dispose();
            colorProviderDisposable = vscode.languages.registerColorProvider(LANG, new GodotShaderColorProvider());
            push(colorProviderDisposable);
        }
    }));

    // 工作区符号
    push(vscode.languages.registerWorkspaceSymbolProvider(new GodotShaderWorkspaceSymbolProvider()));

    // 重命名
    push(vscode.languages.registerRenameProvider(LANG, new GodotShaderRenameProvider()));

    // 文档高亮
    push(vscode.languages.registerDocumentHighlightProvider(LANG, new GodotShaderHighlightProvider()));

    // 大纲符号
    push(vscode.languages.registerDocumentSymbolProvider(LANG, new GodotShaderDocumentSymbolProvider()));

    // Inlay Hints — 函数调用时显示参数名提示
    push(vscode.languages.registerInlayHintsProvider(LANG, new GodotShaderInlayHintsProvider()));

    // CodeLens — 显示 uniform/varying/const 引用计数
    const codeLensProvider = new GodotShaderCodeLensProvider();
    push(vscode.languages.registerCodeLensProvider(LANG, codeLensProvider));
    // 当文档变化时刷新 CodeLens
    push(vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.languageId === 'godot-shader') {
            codeLensProvider.refresh();
        }
    }));

    // Document Links — #include "path" 可点击跳转
    push(vscode.languages.registerDocumentLinkProvider(LANG, new GodotShaderDocumentLinkProvider()));

    // Selection Range — 智能选区逐级扩展（Alt+Shift+→）
    push(vscode.languages.registerSelectionRangeProvider(LANG, new GodotShaderSelectionRangeProvider()));

    // 调用层次（谁调用了我 / 我调用了谁）
    push(vscode.languages.registerCallHierarchyProvider(LANG, new GodotShaderCallHierarchyProvider()));

    // 只读预览：展开 #include 后的完整着色器（虚拟文档，不落盘）
    const expandedProvider = new ExpandedShaderProvider();
    push(vscode.workspace.registerTextDocumentContentProvider(EXPANDED_SCHEME, expandedProvider));

    // 命令（命令面板 / 右键菜单 / 快捷键）
    registerCommands(context, outputChannel, expandedProvider);
}

export function deactivate() {
    console.log('Godot Shader extension is now deactivated!');
}
