// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { GODOT_SHADER_FUNCTIONS } from '../shader-data';
import { collectFuncBlocks, computeCodeOnlyLines } from '../utils';

// 预构建函数名 → 数据映射（O(1) 查找）
const FUNC_MAP: Map<string, { name: string; signature: string; description: string }> = new Map();
for (const f of GODOT_SHADER_FUNCTIONS) {
    FUNC_MAP.set(f.name, f);
}

interface UserFunc {
    name: string;
    returnType: string;
    params: string[];
    /** 定义行上方的连续注释 */
    doc: string;
}

export class GodotShaderSignatureHelpProvider implements vscode.SignatureHelpProvider {

    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        // 取光标所在的调用表达式（支持跨行调用）
        const call = this.extractCall(document, position);
        if (!call) return null;

        const { funcName, activeParameter } = call;

        const help = new vscode.SignatureHelp();
        help.activeParameter = activeParameter;

        // 1) 文档内的用户自定义函数（优先，允许覆盖内置同名）
        const userFunc = this.findUserFunc(document, funcName);
        if (userFunc) {
            const label = `${userFunc.returnType} ${userFunc.name}(${userFunc.params.join(', ')})`;
            const info = new vscode.SignatureInformation(label, userFunc.doc || undefined);
            info.parameters = userFunc.params.map(p => {
                const parts = p.trim().split(/\s+/);
                return new vscode.ParameterInformation(p.trim(), parts.length > 1 ? parts[0] : undefined);
            });
            help.signatures = [info];
            help.activeSignature = 0;
            return help;
        }

        // 2) 内置函数（支持 "vec3(float) | vec3(float, float, float)" 这类重载）
        const funcData = FUNC_MAP.get(funcName);
        if (!funcData) return null;

        // 重载分隔符是独立的 `|`：`mix(vecX a, vecX b, float|vecX t)` 里的 `|` 是参数联合类型，
        // 只有 `)` 之后的 `|` 才是重载分隔
        const overloads = funcData.signature
            .split(/\)\s*\|\s*/)
            .map((s, i, arr) => (i < arr.length - 1 ? s + ')' : s))
            .map(s => s.trim())
            .filter(Boolean);
        const signatures = overloads.map(sig => {
            const info = new vscode.SignatureInformation(sig, funcData.description);
            const params = this.parseParameters(sig);
            info.parameters = params.map(p => {
                const parts = p.trim().split(/\s+/);
                return new vscode.ParameterInformation(p.trim(), parts.length > 1 ? parts[0] : undefined);
            });
            return { info, count: params.length };
        });

        if (signatures.length === 0) return null;

        // 选中与当前实参个数匹配的重载；都匹配不上就取参数更多的那个
        const wantedArgs = activeParameter + 1;
        let best = signatures.findIndex(s => s.count >= wantedArgs);
        if (best < 0) {
            best = 0;
            for (let i = 1; i < signatures.length; i++) {
                if (signatures[i].count > signatures[best].count) best = i;
            }
        }

        help.signatures = signatures.map(s => s.info);
        help.activeSignature = best;

        return help;
    }

    /**
     * 从光标位置回溯找到正在调用的函数名与当前参数序号。
     * 支持跨行调用：向前最多看 20 行，找最近的未闭合 `(`。
     */
    private extractCall(document: vscode.TextDocument, position: vscode.Position): { funcName: string; activeParameter: number } | null {
        const startLine = Math.max(0, position.line - 20);
        let text = '';
        for (let i = startLine; i <= position.line; i++) {
            const lineText = document.lineAt(i).text;
            text += i === position.line ? lineText.substring(0, position.character) : lineText + '\n';
        }

        // 从后往前找未闭合的 (
        let depth = 0;
        let openIndex = -1;
        for (let i = text.length - 1; i >= 0; i--) {
            const ch = text[i];
            if (ch === ')') depth++;
            else if (ch === '(') {
                if (depth === 0) { openIndex = i; break; }
                depth--;
            }
        }
        if (openIndex < 0) return null;

        // 函数名：`(` 之前的标识符
        const beforeParen = text.substring(0, openIndex).trimEnd();
        const nameMatch = beforeParen.match(/([A-Za-z_]\w*)$/);
        if (!nameMatch) return null;

        // 当前参数序号：统计该 `(` 之后第 1 层内的逗号
        let nest = 0;
        let commaCount = 0;
        for (let i = openIndex; i < text.length; i++) {
            const ch = text[i];
            if (ch === '(') nest++;
            else if (ch === ')') nest--;
            else if (ch === ',' && nest === 1) commaCount++;
        }

        return { funcName: nameMatch[1], activeParameter: commaCount };
    }

    /** 在文档中查找用户自定义函数定义 */
    private findUserFunc(document: vscode.TextDocument, name: string): UserFunc | null {
        const lines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);
        const codeLines = computeCodeOnlyLines(lines);
        const blocks = collectFuncBlocks(codeLines);
        const block = blocks.find(b => b.name === name);
        if (!block) return null;

        const headerLine = codeLines[block.headerLine];
        const m = headerLine.match(/^\s*((?:\w+\s+)*?)(\w+)\s*\(([^)]*)\)/);
        const returnType = m ? (m[1].trim() || 'void') : 'void';
        const paramStr = m ? m[3] : '';
        const params = paramStr.trim() ? paramStr.split(',').map(p => p.trim()) : [];

        // 收集定义上方的连续注释作为文档
        const docLines: string[] = [];
        for (let i = block.headerLine - 1; i >= 0; i--) {
            const t = lines[i].trim();
            if (t.startsWith('//')) {
                docLines.unshift(t.replace(/^\/\/\s?/, ''));
            } else if (t === '' && docLines.length === 0) {
                continue;
            } else {
                break;
            }
        }

        return { name, returnType, params, doc: docLines.join('\n') };
    }

    // 从函数签名中提取参数列表
    private parseParameters(signature: string): string[] {
        const match = signature.match(/\(([^)]*)\)/);
        if (!match || !match[1].trim()) return [];
        return match[1].split(',').map(p => p.trim());
    }
}
