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
import { GodotShaderTypeDefinitionProvider, GodotShaderDeclarationProvider } from './features/type-navigation';
import { GodotShaderInlineCompletionProvider } from './features/inline-completions';
import { GodotShaderLinkedEditingProvider } from './features/linked-editing';
import { GodotShaderTypeHierarchyProvider } from './features/type-hierarchy';
import { GodotShaderPasteEditProvider, GodotShaderDropEditProvider, INCLUDE_EDIT_KIND } from './features/include-edits';
import { GodotShaderTreeProvider, invalidateShaderFiles } from './features/views';
import { GodotShaderFileDecorationProvider } from './features/file-decoration';
import { registerChatParticipant } from './features/chat-participant';
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
    // 注意：不要加 scheme: 'file' —— 否则未保存文件（untitled）、远程 SSH / WSL / 容器
    // （vscode-remote）、虚拟文件系统里全部语言功能都会静默失效。
    // 需要文件系统的功能（include 解析）在各自内部按 document.uri.scheme 判断。
    const LANG = { language: 'godot-shader' } as const;
    const push = (d: vscode.Disposable) => context.subscriptions.push(d);

    // 侧边栏视图（Uniforms / Includes / Workspace Shaders）
    const treeProvider = new GodotShaderTreeProvider();
    const treeView = vscode.window.createTreeView('godotShaderOutline', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });
    treeView.message = t('view.empty_hint');
    push(treeView);

    // 资源管理器装饰（错误角标 / 被 include 标记）
    const decorationProvider = new GodotShaderFileDecorationProvider();
    push(decorationProvider);
    push(vscode.window.registerFileDecorationProvider(decorationProvider));
    push(vscode.languages.onDidChangeDiagnostics(() => decorationProvider.refresh()));

    // 监听 .gdshader / .gdshaderinc 文件变化以失效缓存（工作区符号 + 跨文件符号）
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{gdshader,gdshaderinc}');
    const invalidateCaches = () => {
        GodotShaderWorkspaceSymbolProvider.invalidateCache();
        invalidateIncludeCache();
        invalidateWorkspaceIncludes();
        invalidateShaderFiles();
        treeProvider.refresh();
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
    const definitionProvider = new GodotShaderDefinitionProvider();
    push(vscode.languages.registerDefinitionProvider(LANG, definitionProvider));

    // 转到声明（include 进来的符号 → 跳到对应的 #include 行）
    push(vscode.languages.registerDeclarationProvider(LANG,
        new GodotShaderDeclarationProvider(definitionProvider)));

    // 类型定义：变量 / 字段 → 它的 struct
    push(vscode.languages.registerTypeDefinitionProvider(LANG, new GodotShaderTypeDefinitionProvider()));

    // 类型层次：struct 的组合关系（谁包含我 / 我包含谁）
    push(vscode.languages.registerTypeHierarchyProvider(LANG, new GodotShaderTypeHierarchyProvider()));

    // 内联补全：include 路径、shader_type、group_uniforms 灰字提示
    push(vscode.languages.registerInlineCompletionItemProvider(LANG, new GodotShaderInlineCompletionProvider()));

    // 联动编辑：改名字时同作用域一起改
    push(vscode.languages.registerLinkedEditingRangeProvider(LANG, new GodotShaderLinkedEditingProvider()));

    // 粘贴 / 拖拽时自动补 #include
    push(vscode.languages.registerDocumentPasteEditProvider(LANG,
        new GodotShaderPasteEditProvider(), { providedPasteEditKinds: [INCLUDE_EDIT_KIND] }));
    push(vscode.languages.registerDocumentDropEditProvider(LANG,
        new GodotShaderDropEditProvider(), { providedDropEditKinds: [INCLUDE_EDIT_KIND], dropMimeTypes: ['text/uri-list'] }));

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

    // 活动编辑器变化 → 刷新侧栏与装饰
    const syncActiveDocument = (document: vscode.TextDocument | undefined) => {
        const shaderDoc = document && document.languageId === 'godot-shader' ? document : undefined;
        treeProvider.setDocument(shaderDoc);
        decorationProvider.setActiveDocument(shaderDoc);
        treeView.message = shaderDoc ? undefined : t('view.empty_hint');
    };
    push(vscode.window.onDidChangeActiveTextEditor(e => syncActiveDocument(e?.document)));
    push(vscode.workspace.onDidCloseTextDocument(doc => {
        if (doc.languageId === 'godot-shader') syncActiveDocument(vscode.window.activeTextEditor?.document);
    }));
    // 保存后重算「被 include」装饰（编辑时重算太贵，保存一次足够）
    push(vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.languageId === 'godot-shader') {
            decorationProvider.setActiveDocument(vscode.window.activeTextEditor?.document);
        }
    }));
    syncActiveDocument(vscode.window.activeTextEditor?.document);

    // 编辑时轻量刷新侧栏（200ms 防抖）
    let treeTimer: NodeJS.Timeout | undefined;
    push(vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.languageId !== 'godot-shader') return;
        if (e.document.uri.toString() !== vscode.window.activeTextEditor?.document.uri.toString()) return;
        if (treeTimer) clearTimeout(treeTimer);
        treeTimer = setTimeout(() => treeProvider.refresh(), 200);
        if (treeTimer && typeof treeTimer.unref === 'function') treeTimer.unref();
    }));

    // @shader 聊天参与者（/expand、/uniforms、/diagnostics、/docs）
    registerChatParticipant(context);

    // 命令（命令面板 / 右键菜单 / 快捷键）
    registerCommands(context, outputChannel, expandedProvider, treeProvider);
}

export function deactivate() {
    console.log('Godot Shader extension is now deactivated!');
}
