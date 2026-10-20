// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { getDocIndex } from '../symbol-index';
import { getProjectSymbols } from '../include-graph';
import { t } from '../i18n';

export type OutlineNode =
    | { kind: 'section'; section: 'uniforms' | 'includes' | 'shaders'; label: string; description: string }
    | { kind: 'group'; label: string; children: OutlineNode[] }
    | { kind: 'uniform'; name: string; type: string; keyword: string; hint: string; line: number; col: number }
    | { kind: 'include'; label: string; uri: vscode.Uri; missing: boolean }
    | { kind: 'shader'; label: string; uri: vscode.Uri; shaderType: string };

/** 工作区 shader 文件清单（供侧栏使用，带 30s 缓存） */
let shaderFiles: { value: vscode.Uri[]; at: number } | null = null;
const SHADER_FILE_TTL = 30_000;

export async function getWorkspaceShaderFiles(): Promise<vscode.Uri[]> {
    if (shaderFiles && Date.now() - shaderFiles.at < SHADER_FILE_TTL) return shaderFiles.value;
    let files: vscode.Uri[] = [];
    try {
        files = await vscode.workspace.findFiles('**/*.gdshader', '**/node_modules/**', 300);
    } catch {
        files = [];
    }
    shaderFiles = { value: files, at: Date.now() };
    return files;
}

export function invalidateShaderFiles(): void {
    shaderFiles = null;
}

/**
 * 侧边栏「Godot Shader」视图：
 * - Uniforms：按 `group_uniforms` 分组，点击跳到声明
 * - Includes：当前文件的 include 文件，缺失的标红
 * - Shaders：工作区里的所有 .gdshader
 */
export class GodotShaderTreeProvider implements vscode.TreeDataProvider<OutlineNode> {

    private readonly emitter = new vscode.EventEmitter<OutlineNode | undefined | void>();
    readonly onDidChangeTreeData = this.emitter.event;

    private document: vscode.TextDocument | undefined;
    private includeCache: { key: string; value: OutlineNode[] } | null = null;

    /** 由扩展在活动编辑器变化时调用 */
    public setDocument(document: vscode.TextDocument | undefined): void {
        this.document = document && document.languageId === 'godot-shader' ? document : undefined;
        this.includeCache = null;
        this.refresh();
    }

    public refresh(): void {
        this.emitter.fire();
    }

    public getTreeItem(node: OutlineNode): vscode.TreeItem {
        switch (node.kind) {
            case 'section': {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
                item.description = node.description;
                item.contextValue = `godotShader.${node.section}`;
                item.iconPath = new vscode.ThemeIcon(
                    node.section === 'uniforms' ? 'symbol-parameter'
                        : node.section === 'includes' ? 'references'
                            : 'symbol-namespace'
                );
                return item;
            }
            case 'group': {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
                item.iconPath = new vscode.ThemeIcon('symbol-structure');
                item.description = t('view.group_count', node.children.length);
                return item;
            }
            case 'uniform': {
                const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
                item.description = node.hint ? `${node.type} · ${node.hint}` : node.type;
                item.tooltip = new vscode.MarkdownString(`\`${node.keyword} ${node.type} ${node.name}\``);
                item.iconPath = new vscode.ThemeIcon(node.keyword === 'uniform' ? 'symbol-variable' : 'symbol-field');
                // 切换文件时可能出现"陈旧节点"，此时不给 command，避免拿不到 uri
                if (this.document) item.command = revealCommand(this.document.uri, node.line, node.col);
                return item;
            }
            case 'include': {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon(node.missing ? 'warning' : 'file-code');
                item.description = node.missing ? t('view.missing') : undefined;
                item.tooltip = node.missing ? t('view.missing_tooltip', node.label) : node.uri.fsPath;
                item.command = node.missing
                    ? undefined
                    : { command: 'vscode.open', title: t('view.open'), arguments: [node.uri] };
                return item;
            }
            case 'shader': {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
                item.description = node.shaderType;
                item.iconPath = new vscode.ThemeIcon('file-code');
                item.command = { command: 'vscode.open', title: t('view.open'), arguments: [node.uri] };
                return item;
            }
        }
    }

    public async getChildren(node?: OutlineNode): Promise<OutlineNode[]> {
        if (!node) return this.getSections();

        if (node.kind === 'section') {
            if (node.section === 'uniforms') return this.uniformTree();
            if (node.section === 'includes') return this.includeNodes();
            return this.shaderNodes();
        }
        if (node.kind === 'group') return node.children;
        return [];
    }

    private getSections(): OutlineNode[] {
        const index = this.document ? getDocIndex(this.document) : null;
        const uniformCount = index ? index.vars.filter(v => v.keyword === 'uniform' || v.keyword === 'varying' || v.keyword === 'const').length : 0;
        const includes = this.document ? getProjectSymbols(this.document).includes.length : 0;

        return [
            { kind: 'section', section: 'uniforms', label: t('view.uniforms'), description: String(uniformCount) },
            { kind: 'section', section: 'includes', label: t('view.includes'), description: String(includes) },
            { kind: 'section', section: 'shaders', label: t('view.shaders'), description: '' }
        ];
    }

    /** uniform 按 group_uniforms 分组，未分组的直接挂在根下 */
    private uniformTree(): OutlineNode[] {
        const document = this.document;
        if (!document) return [];

        const index = getDocIndex(document);
        const vars = index.vars.filter(v => !v.funcName && (v.keyword === 'uniform' || v.keyword === 'varying' || v.keyword === 'const'));

        // 行号 → 所属分组
        const groupAt = new Map<number, string>();
        let current: string | null = null;
        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text;
            const open = /^\s*group_uniforms\s+([A-Za-z_]\w*)\s*;/.exec(text);
            if (open) { current = open[1]; continue; }
            if (/^\s*group_uniforms\s*;/.test(text)) { current = null; continue; }
            if (current) groupAt.set(i, current);
        }

        const groups = new Map<string, OutlineNode[]>();
        const loose: OutlineNode[] = [];
        for (const v of vars) {
            const lineText = document.lineAt(v.line).text;
            const col = Math.max(0, lineText.indexOf(v.name));
            const node: OutlineNode = { kind: 'uniform', name: v.name, type: v.type, keyword: v.keyword, hint: v.hint, line: v.line, col };
            const group = groupAt.get(v.line);
            if (group) {
                if (!groups.has(group)) groups.set(group, []);
                groups.get(group)!.push(node);
            } else {
                loose.push(node);
            }
        }

        const out: OutlineNode[] = [];
        for (const [label, children] of groups) out.push({ kind: 'group', label, children });
        return out.concat(loose);
    }

    private includeNodes(): OutlineNode[] {
        const document = this.document;
        if (!document) return [];

        const key = `${document.uri}|${document.version}`;
        if (this.includeCache && this.includeCache.key === key) return this.includeCache.value;

        const project = getProjectSymbols(document);
        const nodes: OutlineNode[] = project.includes.map(inc => ({
            kind: 'include' as const,
            label: inc.label,
            uri: inc.uri,
            missing: false
        }));
        for (const miss of project.missing) {
            nodes.push({ kind: 'include', label: miss.includePath, uri: document.uri, missing: true });
        }

        this.includeCache = { key, value: nodes };
        return nodes;
    }

    private async shaderNodes(): Promise<OutlineNode[]> {
        const files = await getWorkspaceShaderFiles();
        const nodes: OutlineNode[] = [];
        for (const uri of files) {
            const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString() && d.languageId === 'godot-shader');
            let shaderType = '';
            if (open) {
                const m = open.getText().match(/^\s*shader_type\s+(\w+)/m);
                shaderType = m ? m[1] : '';
            }
            nodes.push({
                kind: 'shader',
                label: vscode.workspace.asRelativePath(uri, false) || uri.path,
                uri,
                shaderType
            });
        }
        return nodes;
    }
}

function revealCommand(uri: vscode.Uri, line: number, character: number): vscode.Command {
    return {
        command: 'godotShader.revealLocation',
        title: t('view.open'),
        arguments: [uri, line, character]
    };
}
