// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import {
    GODOT_SHADER_BUILTINS, GODOT_SHADER_TYPES, GODOT_SHADER_KEYWORDS, GODOT_SHADER_HINTS,
    GODOT_SHADER_STENCIL_MODES, GODOT_SHADER_RENDER_MODES
} from '../shader-data';
import { computeCodeOnlyLines } from '../utils';
import { getDocIndex } from '../symbol-index';

// 语义令牌类型定义
const tokenTypes = [
    'variable',     // 用户变量
    'property',     // 内置变量 / 结构体字段 / swizzle 分量
    'function',     // 函数
    'keyword',      // 关键字
    'type',         // 类型（float, vec3, struct 名, shader_type 值）
    'parameter',    // 函数参数
    'modifier'      // uniform hint / render_mode / stencil_mode 值
];

const tokenModifiers = [
    'declaration',  // 声明
    'readonly',     // 只读
    'static'        // 静态
];

const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

/** shader_type 的合法取值（与诊断保持一致） */
const shaderTypeValues = new Set(['canvas_item', 'spatial', 'sky', 'fog', 'particles']);
/** 所有 render_mode 取值 */
const renderModeSet = new Set<string>();
for (const modes of Object.values(GODOT_SHADER_RENDER_MODES)) {
    for (const m of modes) renderModeSet.add(m);
}
/** GLSL swizzle 分量（小写四组） */
const SWIZZLE_RE = /^[xyzwrgba]{1,4}$/;

// 编译时构建内置变量集合
const builtinSet = new Set<string>();
for (const category of Object.keys(GODOT_SHADER_BUILTINS)) {
    const vars = GODOT_SHADER_BUILTINS[category];
    if (Array.isArray(vars)) {
        vars.forEach((v: {name: string}) => builtinSet.add(v.name));
    }
}

const typeSet = new Set(GODOT_SHADER_TYPES);
const keywordSet = new Set(GODOT_SHADER_KEYWORDS);
// true/false 是 Godot Shader 布尔字面量，按关键字着色
keywordSet.add('true').add('false');
const hintsSet = new Set(GODOT_SHADER_HINTS);

// stencil_mode 值集合（含简写版）
const stencilSet = new Set<string>();
for (const modes of Object.values(GODOT_SHADER_STENCIL_MODES)) {
    for (const m of modes) stencilSet.add(m);
}

// 修饰符位掩码
const MOD_DECLARATION = 1 << tokenModifiers.indexOf('declaration');
const MOD_READONLY = 1 << tokenModifiers.indexOf('readonly');

export class GodotShaderSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {

    // 每次请求前重建的上下文（文档级）
    private structNames = new Set<string>();
    private structFields = new Set<string>();
    /** 结构体字段声明位置：`行:名字` */
    private fieldDeclKeys = new Set<string>();
    /** 变量声明位置：`行:名字` → 关键字（uniform / varying / const / global / local / param） */
    private declAt = new Map<string, string>();
    /** 函数参数：行号 → 参数名集合 */
    private paramsAtLine = new Map<number, Set<string>>();
    /** 函数签名所在行（用于区分"参数声明"与"参数使用"） */
    private headerLines = new Set<number>();
    /** 本文件里声明过的符号名：全大写的用户常量不该按"内置变量"着色 */
    private declaredNames = new Set<string>();

    public provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SemanticTokens> {
        const tokensBuilder = new vscode.SemanticTokensBuilder(legend);

        // 预扫描：找出 #if 0 禁用的块范围
        const disabledRanges = this.findDisabledRanges(document);

        // 注释与字符串被替换成等长空格：注释里的单词不会再被当成变量着色
        // （语义令牌优先级高于 TextMate 语法，否则行尾注释 / 字符串内容会被改成变量色）
        const rawLines: string[] = [];
        for (let line = 0; line < document.lineCount; line++) {
            rawLines.push(document.lineAt(line).text);
        }
        const codeLines = computeCodeOnlyLines(rawLines);

        this.buildContext(document);

        for (let line = 0; line < document.lineCount; line++) {
            const code = codeLines[line];
            const trimmed = code.trim();

            // 空行 / 纯注释行 / 预处理指令
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // #if 0 禁用的块：直接跳过，保留默认着色（不让语义令牌覆盖）
            if (this.isInDisabledRange(line, disabledRanges)) {
                continue;
            }

            // 查找所有单词
            const wordRegex = /\b([a-zA-Z_]\w*)\b/g;
            let match: RegExpExecArray | null;

            while ((match = wordRegex.exec(code)) !== null) {
                const word = match[1];
                const start = match.index;
                const length = word.length;

                // 只跳过数字开头（单字母变量名也要着色，否则 `x` 和 `col` 颜色不一致）
                if (/^\d/.test(word)) continue;

                const classified = this.classifyToken(word, code, start, line);
                if (classified) {
                    tokensBuilder.push(line, start, length, classified.tokenType, classified.tokenModifiers);
                }
            }
        }

        return tokensBuilder.build();
    }

    /** 把文档符号索引整理成按行查询的表 */
    private buildContext(document: vscode.TextDocument): void {
        const index = getDocIndex(document);

        this.structNames = new Set(index.structs.map(s => s.name));
        this.structFields = new Set<string>();
        this.fieldDeclKeys = new Set<string>();
        for (const s of index.structs) {
            for (const f of s.fields) {
                this.structFields.add(f.name);
                this.fieldDeclKeys.add(`${f.line}:${f.name}`);
            }
        }

        this.declAt = new Map<string, string>();
        this.declaredNames = new Set<string>();
        for (const v of index.vars) {
            this.declAt.set(`${v.line}:${v.name}`, v.keyword);
            this.declaredNames.add(v.name);
        }
        for (const f of index.funcs) this.declaredNames.add(f.name);

        // 参数：函数头到右大括号之间的所有行都认识这些名字
        this.paramsAtLine = new Map<number, Set<string>>();
        this.headerLines = new Set<number>();
        for (const f of index.funcs) {
            this.headerLines.add(f.line);
            if (f.params.length === 0) continue;
            const names = new Set(f.params.map(p => p.name));
            const block = index.blocks.find(b => b.headerLine === f.line);
            const end = block ? block.closeLine : f.line;
            for (let l = f.line; l <= end; l++) this.paramsAtLine.set(l, names);
        }
    }

    private classifyToken(word: string, lineText: string, pos: number, lineNum: number): { tokenType: number; tokenModifiers: number } | null {
        let modifiers = 0;

        const before = lineText.substring(0, pos);
        const prevChar = before.replace(/\s+$/, '').slice(-1);
        const afterWord = lineText.substring(pos + word.length);
        const declKey = `${lineNum}:${word}`;
        const isDeclName = this.declAt.has(declKey);
        const declKeyword = this.declAt.get(declKey) ?? '';
        const isFieldDecl = this.fieldDeclKeys.has(declKey);

        // 参数声明只算签名括号内那次；单行函数体里的同名使用不该带 declaration
        const parenEnd = lineText.indexOf(')');
        const inHeaderParams = parenEnd >= 0 && pos < parenEnd;
        const isParamDecl = isDeclName && declKeyword === 'param';
        const countsAsDecl = (isDeclName || isFieldDecl) && (!isParamDecl || inHeaderParams);

        if (countsAsDecl) {
            modifiers |= MOD_DECLARATION;
        }
        if (isDeclName && declKeyword === 'uniform') {
            modifiers |= MOD_READONLY;
        }

        // 1. 关键字
        if (keywordSet.has(word) || keywordSet.has(word.toLowerCase())) {
            return { tokenType: 3, tokenModifiers: modifiers }; // keyword
        }

        // 2. 类型名
        if (typeSet.has(word)) {
            return { tokenType: 4, tokenModifiers: modifiers }; // type
        }

        // 3. shader_type 的取值（canvas_item / spatial / sky / fog / particles）
        if (shaderTypeValues.has(word) && /^shader_type\b/.test(lineText.trim())) {
            return { tokenType: 4, tokenModifiers: modifiers }; // type
        }

        // 4. 用户 struct 名称
        if (this.structNames.has(word)) {
            return { tokenType: 4, tokenModifiers: modifiers }; // type
        }

        // 5. 函数参数（声明与使用处都算）
        if (this.paramsAtLine.get(lineNum)?.has(word)) {
            return { tokenType: 5, tokenModifiers: modifiers }; // parameter
        }

        // 6. struct 字段：`obj.field` 访问，或 struct 体内的声明
        if (this.structFields.has(word) && (prevChar === '.' || isFieldDecl)) {
            return { tokenType: 1, tokenModifiers: modifiers }; // property
        }

        // 7. swizzle 分量（`COLOR.rgb` / `pos.xy`），仅紧跟在点号后
        if (prevChar === '.' && SWIZZLE_RE.test(word)) {
            return { tokenType: 1, tokenModifiers: modifiers }; // property
        }

        // 8. uniform hint 值: source_color, filter_linear, hint_range 等
        // 仅在 : 后出现时高亮，排除三元运算符 ? : 和 case 标签
        if (hintsSet.has(word)) {
            const colonIdx = before.lastIndexOf(':');
            if (colonIdx >= 0) {
                const beforeColon = before.substring(0, colonIdx).trimEnd();
                if (!beforeColon.endsWith('?') && !/case\s*$/.test(beforeColon)) {
                    return { tokenType: 6, tokenModifiers: modifiers }; // modifier
                }
            }
        }

        // 9. render_mode 取值（仅在 render_mode 声明行内）
        if (renderModeSet.has(word) && /\brender_mode\b/.test(lineText)) {
            return { tokenType: 6, tokenModifiers: modifiers }; // modifier
        }

        // 10. stencil_mode 取值（含简写 always / equal / greater 等）
        if (stencilSet.has(word) && /\bstencil_mode\b/.test(lineText)) {
            return { tokenType: 6, tokenModifiers: modifiers }; // modifier
        }

        // 11. 内置变量（全大写且在表中）
        if (word === word.toUpperCase() && builtinSet.has(word)) {
            return { tokenType: 1, tokenModifiers: modifiers }; // property
        }

        // 12. 函数定义 / 调用
        if (afterWord.trimStart().startsWith('(')) {
            return { tokenType: 2, tokenModifiers: modifiers }; // function
        }

        // 13. 声明语句里的变量名（含 global / instance uniform 的前缀形式）
        if (isDeclName) {
            return { tokenType: 0, tokenModifiers: modifiers }; // variable
        }

        // 14. 其他大写词：自己声明的按变量，未声明的倾向于是内置变量
        if (word === word.toUpperCase() && word.length > 2) {
            return { tokenType: this.declaredNames.has(word) ? 0 : 1, tokenModifiers: modifiers };
        }

        return { tokenType: 0, tokenModifiers: modifiers }; // variable (默认)
    }

    /**
     * 扫描文档中 #if 0 禁用的代码块
     * 返回禁用行范围列表（start = 指令行，end = 最后一个被禁用行）
     */
    private findDisabledRanges(document: vscode.TextDocument): Array<{ start: number; end: number }> {
        const ranges: Array<{ start: number; end: number }> = [];
        const stack: Array<{ start: number; disabled: boolean; hasElse: boolean }> = [];

        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text.trim();

            const ifMatch = text.match(/^#\s*if\s+(.+)/);
            const elseMatch = text.match(/^#\s*(else|elif)\b/);
            const endifMatch = text.match(/^#\s*endif\b/);

            if (ifMatch) {
                // 只有 `#if 0` / `#if false` 是确定禁用的；其余条件无法静态求值
                const condition = ifMatch[1].trim();
                const isDisabled = condition === '0' || condition === 'false';
                stack.push({ start: i, disabled: isDisabled, hasElse: false });
            } else if (elseMatch && stack.length > 0) {
                const top = stack[stack.length - 1];
                if (top.disabled && !top.hasElse) {
                    // #else / #elif 开始，之前禁用的块到此结束，新块激活
                    ranges.push({ start: top.start, end: i - 1 });
                    top.disabled = false;
                } else if (!top.disabled && !top.hasElse) {
                    // 之前激活，#else 开始新禁用块
                    top.disabled = true;
                    top.start = i;
                }
                top.hasElse = true;
            } else if (endifMatch && stack.length > 0) {
                const top = stack.pop()!;
                if (top.disabled) {
                    ranges.push({ start: top.start, end: i - 1 });
                }
            }
        }

        return ranges;
    }

    private isInDisabledRange(line: number, ranges: Array<{ start: number; end: number }>): boolean {
        // start 是 #if 行，end 是最后一个被禁用行（闭区间）
        return ranges.some(r => line > r.start && line <= r.end);
    }
}

export function getSemanticTokensLegend(): vscode.SemanticTokensLegend {
    return legend;
}
