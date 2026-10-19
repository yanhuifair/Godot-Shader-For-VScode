// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { GODOT_SHADER_FUNCTIONS, GODOT_SHADER_TYPES } from '../shader-data';
import { computeCodeOnlyLines } from '../utils';

/** 类型名集合：构造函数 vec3(...) / float(...) 不是函数调用，不能显示参数名提示 */
const TYPE_SET = new Set<string>(GODOT_SHADER_TYPES);
/** 函数定义行的返回类型判定（`vec4 helper(` 这种是定义，不是调用） */
const RETURN_TYPE_RE = /(?:^|\b)(void|bool|int|uint|float|vec2|vec3|vec4|ivec2|ivec3|ivec4|uvec2|uvec3|uvec4|bvec2|bvec3|bvec4|mat2|mat3|mat4|sampler\w+)\s+$/;

/**
 * InlayHintsProvider — 在函数调用实参前显示参数名提示
 * 例如: mix(|x, y, a) → mix(x: , y: , a: )
 * 支持跨行调用（按整份文档分析，而不是逐行）。
 */
export class GodotShaderInlayHintsProvider implements vscode.InlayHintsProvider {

    // 配置变更时通知 VS Code 刷新 hints
    private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
    public readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

    constructor() {
        // 监听配置变更，立即刷新 inlay hints
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('godot-shader.inlayHints.showParameterNames')) {
                this._onDidChangeInlayHints.fire();
            }
        });
    }

    // 构建函数名 → 参数名列表的快速查找表
    private static readonly funcParamMap: Map<string, string[]> = (() => {
        const map = new Map<string, string[]>();
        for (const func of GODOT_SHADER_FUNCTIONS) {
            // 跳过类型构造函数（vec3 / mat4 / float ...），否则 `vec3(1.0)` 会显示 `float: `
            if (TYPE_SET.has(func.name)) continue;
            const params = GodotShaderInlayHintsProvider.extractParamNames(func.signature);
            if (params.length > 0) {
                map.set(func.name, params);
            }
        }
        return map;
    })();

    /**
     * 从函数签名中提取参数名（排除类型标注）
     * 例如: "mix(vecX a, vecX b, float|vecX t)" → ["a", "b", "t"]
     */
    private static extractParamNames(signature: string): string[] {
        const match = signature.match(/\(([^)]*)\)/);
        if (!match || !match[1].trim()) return [];
        return match[1].split(',').map(part => {
            // 取最后一个词（忽略类型前缀）
            const words = part.trim().split(/\s+/);
            return words[words.length - 1];
        });
    }

    public provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlayHint[]> {
        // 检查设置：是否显示参数名提示
        const showHints = vscode.workspace.getConfiguration('godot-shader')
            .get<boolean>('inlayHints.showParameterNames', true);
        if (!showHints) return [];

        const rawLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) rawLines.push(document.lineAt(i).text);
        // 注释/字符串替换为等长空格：注释里提到的函数调用不会冒出提示
        const codeLines = computeCodeOnlyLines(rawLines);

        // 拼接为整份文本，并记录每行起始偏移（偏移与原文一一对应）
        const lineStarts: number[] = [];
        let text = '';
        for (const line of codeLines) {
            lineStarts.push(text.length);
            text += line + '\n';
        }

        // 合并内置函数 + 文档中用户自定义函数的参数名
        const mergedParams = new Map(GodotShaderInlayHintsProvider.funcParamMap);
        for (const [name, params] of this.extractUserFuncParams(document)) {
            mergedParams.set(name, params);
        }

        /** 偏移 → 行列 */
        const toPosition = (offset: number): vscode.Position => {
            let low = 0;
            let high = lineStarts.length - 1;
            while (low < high) {
                const mid = (low + high + 1) >> 1;
                if (lineStarts[mid] <= offset) low = mid;
                else high = mid - 1;
            }
            return new vscode.Position(low, offset - lineStarts[low]);
        };

        const hints: vscode.InlayHint[] = [];
        const callRegex = /\b([A-Za-z_]\w*)\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = callRegex.exec(text)) !== null) {
            if (token.isCancellationRequested) break;

            const funcName = match[1];
            const openParen = match.index + match[0].length - 1;

            // 只看请求范围内的调用起始行
            const startPos = toPosition(match.index);
            if (startPos.line < range.start.line || startPos.line > range.end.line) continue;

            if (TYPE_SET.has(funcName)) continue;
            if (RETURN_TYPE_RE.test(text.substring(0, match.index))) continue;

            const paramNames = mergedParams.get(funcName);
            if (!paramNames || paramNames.length === 0) continue;

            const argOffsets = this.extractArgOffsets(text, openParen);
            if (argOffsets.length === 0) continue;

            for (let i = 0; i < Math.min(argOffsets.length, paramNames.length); i++) {
                const hint = new vscode.InlayHint(
                    toPosition(argOffsets[i]),
                    `${paramNames[i]}: `,
                    vscode.InlayHintKind.Parameter
                );
                hint.paddingLeft = false;
                hint.paddingRight = false;
                hints.push(hint);
            }
        }

        return hints;
    }

    /**
     * 从开括号位置提取各实参的起始偏移（支持跨行，忽略括号内嵌套与字符串）
     */
    private extractArgOffsets(text: string, openParenPos: number): number[] {
        const args: number[] = [];
        let depth = 0;
        let argStart = -1;

        for (let i = openParenPos; i < text.length; i++) {
            const ch = text[i];

            if (ch === '(') {
                depth++;
                if (depth === 1) argStart = i + 1;
                continue;
            }
            if (ch === ')') {
                depth--;
                if (depth === 0) {
                    this.pushArg(args, text, argStart, i);
                    break;
                }
                continue;
            }
            if (ch === ',' && depth === 1) {
                this.pushArg(args, text, argStart, i);
                argStart = i + 1;
            }
        }

        return args;
    }

    /** 记录实参起始位置（跳过空白），空实参忽略 */
    private pushArg(args: number[], text: string, from: number, to: number): void {
        let i = from;
        while (i < to && /\s/.test(text[i])) i++;
        if (i < to) args.push(i);
    }

    /**
     * 扫描文档中的用户自定义函数定义，提取参数名
     * 匹配: void myFunc(float x, vec3 y) { 或 float calc(int n) {
     */
    private extractUserFuncParams(document: vscode.TextDocument): Map<string, string[]> {
        const result = new Map<string, string[]>();
        const rawLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) rawLines.push(document.lineAt(i).text);
        const text = computeCodeOnlyLines(rawLines).join('\n');

        const funcDefRegex = /^(?!(shader_type|render_mode|uniform|varying|in\b|out\b|const\b|if\b|for\b|while\b|switch\b))\s*(\w+(?:\s+\w+)?)\s+(\w+)\s*\(([^)]*)\)/gm;

        let match: RegExpExecArray | null;
        while ((match = funcDefRegex.exec(text)) !== null) {
            const funcName = match[3];
            const paramsStr = match[4];

            // 跳过着色器入口函数（已有内置签名）
            if (['vertex', 'fragment', 'light', 'sky', 'fog'].includes(funcName)) continue;
            if (GodotShaderInlayHintsProvider.funcParamMap.has(funcName)) continue;
            if (!paramsStr.trim()) continue;

            const paramNames = paramsStr.split(',').map(p => {
                const parts = p.split('=')[0].trim().split(/\s+/);
                for (const part of parts) {
                    if (/^(float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234]|sampler\w+|void|in|out|inout)$/.test(part)) {
                        continue;
                    }
                    return part;
                }
                return parts[0];
            }).filter(Boolean);

            if (paramNames.length > 0) {
                result.set(funcName, paramNames);
            }
        }

        return result;
    }
}
