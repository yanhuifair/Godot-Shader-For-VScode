// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';

/**
 * 转义正则表达式中的特殊字符
 */
export function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从文档中检测当前 shader_type（公共函数，供 completion/hover 等复用）
 * @returns shader_type 名称，未声明时返回 null
 */
export function getShaderType(document: vscode.TextDocument): string | null {
    const match = document.getText().match(/^shader_type\s+(\w+)/m);
    return match ? match[1] : null;
}

/**
 * 把整份文档里的「注释」和「字符串字面量」替换为等长空格，返回逐行结果。
 * 位置索引与原文完全一致，因此匹配得到的 index 可直接用于构造 Range。
 *
 * 用途：需要判断"这真的是代码吗"的检查（数字格式、保留字、内置变量作用域等），
 * 直接用 mask 后的文本做匹配即可，避免行内注释、字符串、跨行块注释造成的误报。
 */
export function computeCodeOnlyLines(lines: string[]): string[] {
    const result: string[] = [];
    let inBlockComment = false;

    for (const line of lines) {
        let out = '';
        let i = 0;

        while (i < line.length) {
            const ch = line[i];
            const next = i + 1 < line.length ? line[i + 1] : '';

            if (inBlockComment) {
                if (ch === '*' && next === '/') {
                    inBlockComment = false;
                    out += '  ';
                    i += 2;
                } else {
                    out += ' ';
                    i++;
                }
                continue;
            }

            // 行注释：本行剩余部分全部抹掉
            if (ch === '/' && next === '/') {
                out += ' '.repeat(line.length - i);
                i = line.length;
                continue;
            }

            // 块注释开始（doc 注释 /** 同样适用）
            if (ch === '/' && next === '*') {
                inBlockComment = true;
                out += '  ';
                i += 2;
                continue;
            }

            // 字符串字面量
            if (ch === '"' || ch === "'") {
                const quote = ch;
                let j = i + 1;
                let closed = false;
                while (j < line.length) {
                    if (line[j] === '\\') { j += 2; continue; }
                    if (line[j] === quote) { closed = true; j++; break; }
                    j++;
                }
                const end = closed ? j : line.length;
                out += ' '.repeat(end - i);
                i = end;
                continue;
            }

            out += ch;
            i++;
        }

        result.push(out);
    }

    return result;
}

/**
 * 解析变量声明行，统一处理各种写法：
 *   uniform vec3 a;        varying flat vec3 b;      global uniform vec4 c;
 *   instance uniform vec4 d;   in vec2 e;   out vec2 f;   const float g = 1.0;
 * 返回 { keyword, type, name }，不是声明行返回 null。
 * （注意：`varying flat`/`varying smooth` 的插值限定符会被跳过，不能当成类型）
 */
export function parseDeclaration(line: string): { keyword: string; type: string; name: string } | null {
    const match = line.match(
        /^(?:(?:global|instance)\s+)?(uniform|varying|in|out|const)\s+(?:(?:flat|smooth)\s+)?(\w+)\s+(\w+)/
    );
    return match ? { keyword: match[1], type: match[2], name: match[3] } : null;
}

/**
 * 判断某个位置是否在注释或字符串内
 * 扫描从行首到 pos 列的所有字符，跟踪注释和字符串状态
 * @param lineText 当前行文本
 * @param pos 待检查的列位置
 * @returns true 表示在注释或字符串内，应跳过
 */
export function isInCommentOrString(lineText: string, pos: number): boolean {
    let inLineComment = false;
    let inBlockComment = false;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < pos && i < lineText.length; i++) {
        const ch = lineText[i];
        const next = i + 1 < lineText.length ? lineText[i + 1] : '';

        // 行注释
        if (!inString && !inBlockComment && ch === '/' && next === '/') {
            inLineComment = true;
            i++; // 跳过下一个 /
            continue;
        }

        // 块注释开始
        if (!inString && !inLineComment && ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }

        // 块注释结束
        if (!inString && inBlockComment && ch === '*' && next === '/') {
            inBlockComment = false;
            i++;
            continue;
        }

        // 字符串
        if (!inLineComment && !inBlockComment && (ch === '"' || ch === "'")) {
            if (!inString) {
                inString = true;
                stringChar = ch;
            } else if (ch === stringChar) {
                // 检查是否被反斜杠转义（如 "hello \"world"）
                let escaped = false;
                for (let k = i - 1; k >= 0; k--) {
                    if (lineText[k] === '\\') {
                        escaped = !escaped;
                    } else {
                        break;
                    }
                }
                if (!escaped) {
                    inString = false;
                }
            }
        }
    }

    return inLineComment || inBlockComment || inString;
}

// ============================================================================
// 作用域分析（重命名 / 查找引用 / 高亮 / 跳转 共用的最小符号解析）
// ============================================================================

export interface FuncBlock {
    /** 函数名（自定义函数；着色器入口函数也统一收录） */
    name: string;
    /** 函数头所在行（含 return 类型那一行） */
    headerLine: number;
    /** 函数体起始行（`{` 所在行） */
    openLine: number;
    /** 函数体结束行（`}` 所在行） */
    closeLine: number;
    /** 参数名列表 */
    params: string[];
}

/**
 * 扫描整份文档，返回所有顶层函数的行范围（基于已 mask 的代码行，注释/字符串不干扰）。
 * 仅处理大括号平衡的函数，未闭合的函数不计入。
 */
export function collectFuncBlocks(codeLines: string[]): FuncBlock[] {
    const blocks: FuncBlock[] = [];
    const stack: Array<{ name: string; headerLine: number; openLine: number; params: string[] }> = [];
    let pendingHeader: { name: string; params: string[]; line: number } | null = null;

    const CONTROL_KEYWORDS = /^(if|else|for|while|do|switch|case|default|return|struct|new|delete)$/;

    for (let i = 0; i < codeLines.length; i++) {
        const code = codeLines[i];

        // 函数头：`返回类型 名称(参数)`，`{` 可以在行尾也可以在下一行
        const header = code.trim();
        const firstToken = (header.match(/^(\w+)/) || [])[1] || '';
        const headerMatch = header.match(/^(?:\w+\s+)*(\w+)\s*\(([^)]*)\)\s*\{?\s*$/);
        if (headerMatch && !CONTROL_KEYWORDS.test(firstToken) && !CONTROL_KEYWORDS.test(headerMatch[1])) {
            pendingHeader = {
                name: headerMatch[1],
                params: splitParams(headerMatch[2]),
                line: i
            };
        }

        for (let j = 0; j < code.length; j++) {
            const ch = code[j];
            if (ch === '{') {
                if (stack.length === 0 && pendingHeader) {
                    stack.push({
                        name: pendingHeader.name,
                        headerLine: pendingHeader.line,
                        openLine: i,
                        params: pendingHeader.params
                    });
                    pendingHeader = null;
                } else {
                    // 非函数大括号（if/for/struct 等）只占位，用空名标记
                    stack.push({ name: '', headerLine: i, openLine: i, params: [] });
                }
            } else if (ch === '}') {
                const top = stack.pop();
                if (top && top.name) {
                    blocks.push({
                        name: top.name,
                        headerLine: top.headerLine,
                        openLine: top.openLine,
                        closeLine: i,
                        params: top.params
                    });
                }
            }
        }
    }

    return blocks;
}

/** 拆分参数串为参数名列表（去掉类型、修饰符、默认值） */
export function splitParams(paramStr: string): string[] {
    if (!paramStr.trim()) return [];
    return paramStr.split(',').map(part => {
        const cleaned = part.split('=')[0].trim();
        const words = cleaned.split(/\s+/).filter(Boolean);
        return words.length ? words[words.length - 1] : '';
    }).filter(Boolean);
}

/**
 * 返回包含指定行的最内层函数块（没有则 null）
 */
export function findEnclosingFunc(blocks: FuncBlock[], line: number): FuncBlock | null {
    let best: FuncBlock | null = null;
    for (const b of blocks) {
        if (line >= b.headerLine && line <= b.closeLine) {
            if (!best || b.closeLine - b.headerLine < best.closeLine - best.headerLine) {
                best = b;
            }
        }
    }
    return best;
}

/**
 * 判断某个标识符是否属于"局部符号"（函数参数或函数体内的局部变量）。
 * 局部符号的重命名 / 引用查找应当限制在所属函数范围内，
 * 否则同名变量在不同函数里会被一起改掉。
 */
export function isLocalSymbol(codeLines: string[], line: number, word: string): boolean {
    const blocks = collectFuncBlocks(codeLines);
    const func = findEnclosingFunc(blocks, line);
    if (!func) return false;

    // 参数
    if (func.params.includes(word)) return true;

    // 函数体内的局部声明：type word / type word[ / type word = / type word;
    const escaped = escapeRegExp(word);
    const localDecl = new RegExp(
        '^\\s*(?:const\\s+)?(?:' +
        'bool|int|uint|float|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234]|sampler\\w*|\\w+' +
        ')\\s+' + escaped + '\\b'
    );
    for (let i = func.openLine; i <= func.closeLine; i++) {
        if (localDecl.test(codeLines[i])) return true;
    }
    return false;
}

/**
 * 取某个位置所属的（行号）渲染/引用扫描范围：局部符号限定在函数体内，全局符号用全文。
 */
export function getSymbolScope(codeLines: string[], line: number, word: string): { start: number; end: number } {
    if (isLocalSymbol(codeLines, line, word)) {
        const func = findEnclosingFunc(collectFuncBlocks(codeLines), line);
        if (func) return { start: func.headerLine, end: func.closeLine };
    }
    return { start: 0, end: codeLines.length - 1 };
}
