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
