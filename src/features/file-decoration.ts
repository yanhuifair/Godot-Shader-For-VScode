// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { getProjectSymbols } from '../include-graph';
import { t } from '../i18n';

const SHADER_FILE = /\.(gdshader|gdshaderinc)$/i;

/**
 * 资源管理器装饰：
 * - 有错误的着色器 → 红色数字角标
 * - 被当前文件 include 的文件 → `↳` 角标
 */
export class GodotShaderFileDecorationProvider implements vscode.FileDecorationProvider {

    private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this.emitter.event;

    /** uri → 引入它的文件名 */
    private includedBy = new Map<string, string>();

    public dispose(): void {
        this.emitter.dispose();
    }

    /** 活动编辑器变化时重算"被谁 include" */
    public setActiveDocument(document: vscode.TextDocument | undefined): void {
        this.includedBy.clear();
        if (document && document.languageId === 'godot-shader') {
            const label = vscode.workspace.asRelativePath(document.uri, false) || document.fileName;
            try {
                for (const inc of getProjectSymbols(document).includes) {
                    this.includedBy.set(inc.uri.toString(), label);
                }
            } catch {
                // 解析失败就不装饰
            }
        }
        this.emitter.fire(undefined);
    }

    public refresh(): void {
        this.emitter.fire(undefined);
    }

    public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (!SHADER_FILE.test(uri.path)) return undefined;

        const diags = vscode.languages.getDiagnostics(uri);
        if (diags.length > 0) {
            const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
            const warns = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
            if (errors > 0) {
                return {
                    badge: errors > 99 ? '99' : String(errors),
                    color: new vscode.ThemeColor('errorForeground'),
                    tooltip: t('deco.errors', errors)
                };
            }
            if (warns > 0) {
                return {
                    badge: warns > 99 ? '99' : String(warns),
                    color: new vscode.ThemeColor('editorWarning.foreground'),
                    tooltip: t('deco.warnings', warns)
                };
            }
        }

        const includer = this.includedBy.get(uri.toString());
        if (includer) {
            return {
                badge: '↳',
                color: new vscode.ThemeColor('editorInfo.foreground'),
                tooltip: t('deco.included_by', includer)
            };
        }
        return undefined;
    }
}
