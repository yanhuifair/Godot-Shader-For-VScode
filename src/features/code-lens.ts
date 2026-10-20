// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { computeCodeOnlyLines } from '../utils';
import { GODOT_SHADER_KEYWORD_SET, GODOT_SHADER_ENTRY_POINTS } from '../shader-data';
import { getDocIndex } from '../symbol-index';
import { getLang } from '../i18n';

/**
 * CodeLensProvider — 显示 uniform/varying/const 的引用计数等上下文信息
 */
export class GodotShaderCodeLensProvider implements vscode.CodeLensProvider {

    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        const lang = getLang();
        const refLabel = lang === 'zh' ? '处引用' : 'reference';
        const refLabels = lang === 'zh' ? '处引用' : 'references';
        const findRefs = lang === 'zh' ? '查找所有引用' : 'Find all references';

        const lenses: vscode.CodeLens[] = [];

        // 预先计算整个文档中每个标识符的出现次数
        const refCounts = this.computeReferenceCounts(document);

        // 文件级声明（uniform / varying / const / 全局对象）由符号索引给出
        const varAtLine = new Map<number, string>();
        const funcAtLine = new Map<number, string>();
        const index = getDocIndex(document);
        for (const v of index.vars) {
            if (v.funcName || v.keyword === 'local' || v.keyword === 'param') continue;
            varAtLine.set(v.line, v.name);
        }
        for (const f of index.funcs) {
            // 入口函数由引擎调用，没有"引用"可言，不显示计数
            if (GODOT_SHADER_ENTRY_POINTS.has(f.name)) continue;
            funcAtLine.set(f.line, f.name);
        }

        for (let i = 0; i < document.lineCount; i++) {
            if (token.isCancellationRequested) break;

            const line = document.lineAt(i);

            const varName = varAtLine.get(i);
            if (varName) {
                const name = varName;
                // 减去声明行自身的一次出现，得到真实引用数
                const count = Math.max(0, (refCounts.get(name) || 0) - 1);
                const nameIndex = line.text.indexOf(name);
                const range = new vscode.Range(i, nameIndex, i, nameIndex + name.length);

                const lens = new vscode.CodeLens(range);
                lens.command = {
                    title: `${count} ${count === 1 ? refLabel : refLabels}`,
                    command: 'editor.action.findReferences',
                    arguments: [
                        document.uri,
                        new vscode.Position(i, nameIndex)
                    ],
                    tooltip: `${findRefs} '${name}'`
                };
                lenses.push(lens);
                continue;
            }

            // 用户自定义函数（含 float / vec4 等返回类型）
            const funcName = funcAtLine.get(i);
            if (funcName) {
                const count = Math.max(0, (refCounts.get(funcName) || 0) - 1);
                const nameIndex = line.text.indexOf(funcName);
                if (nameIndex < 0) continue;
                const range = new vscode.Range(i, nameIndex, i, nameIndex + funcName.length);

                const lens = new vscode.CodeLens(range);
                lens.command = {
                    title: `${count} ${count === 1 ? refLabel : refLabels}`,
                    command: 'editor.action.findReferences',
                    arguments: [
                        document.uri,
                        new vscode.Position(i, nameIndex)
                    ],
                    tooltip: `${findRefs} '${funcName}'`
                };
                lenses.push(lens);
            }
        }

        return lenses;
    }

    /**
     * 计算文档中每个标识符的出现次数
     * 与「查找引用」保持一致：忽略注释和字符串里的同名文字，否则 CodeLens 的数字会比引用列表多
     */
    private computeReferenceCounts(document: vscode.TextDocument): Map<string, number> {
        const counts = new Map<string, number>();
        const rawLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) rawLines.push(document.lineAt(i).text);
        const text = computeCodeOnlyLines(rawLines).join('\n');

        // 匹配所有标识符
        const wordRegex = /\b([a-zA-Z_]\w*)\b/g;
        let match: RegExpExecArray | null;

        while ((match = wordRegex.exec(text)) !== null) {
            const word = match[1];
            // 跳过关键字、类型名、单字符
            if (word.length <= 1 || GODOT_SHADER_KEYWORD_SET.has(word)) continue;

            counts.set(word, (counts.get(word) || 0) + 1);
        }

        return counts;
    }
}
