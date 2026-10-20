// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { collectFuncBlocks, computeCodeOnlyLines, parseDeclaration, FuncBlock } from './utils';
import { GODOT_SHADER_TYPES } from './shader-data';

/** 变量符号（uniform / varying / const / 局部变量 / 参数） */
export interface VarSymbol {
    name: string;
    type: string;
    /** 声明关键字：uniform / varying / const / local / param */
    keyword: string;
    line: number;
    /** `: hint` 内容（uniform/varying 才有） */
    hint: string;
    /** 所属函数名，全局变量为 undefined */
    funcName?: string;
}

/** 函数符号 */
export interface FuncSymbol {
    name: string;
    returnType: string;
    params: Array<{ name: string; type: string }>;
    line: number;
    /** 定义上方的连续 // 注释 */
    doc: string;
}

/** 结构体符号 */
export interface StructSymbol {
    name: string;
    line: number;
    endLine: number;
    fields: Array<{ name: string; type: string; line: number }>;
}

export interface DocIndex {
    vars: VarSymbol[];
    funcs: FuncSymbol[];
    structs: StructSymbol[];
    /** 函数块（含行范围），用于作用域判断 */
    blocks: FuncBlock[];
}

// ── 文档级缓存：按 TextDocument.version 自动失效 ──
const cache = new Map<string, { version: number; index: DocIndex }>();

/**
 * 构建（或命中缓存）文档符号索引。
 * 索引基于"抹掉注释与字符串"的代码行，因此注释里的同名文字不会被当成声明。
 */
export function getDocIndex(document: vscode.TextDocument): DocIndex {
    const key = document.uri.toString();
    const version = document.version ?? 0;
    const hit = cache.get(key);
    if (hit && hit.version === version) return hit.index;

    const rawLines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) rawLines.push(document.lineAt(i).text);
    const codeLines = computeCodeOnlyLines(rawLines);
    const index = buildDocIndex(codeLines, rawLines);
    cache.set(key, { version, index });
    return index;
}

/** 文档关闭时清理缓存 */
export function dropDocIndex(uri: vscode.Uri): void {
    cache.delete(uri.toString());
}

export function buildDocIndex(codeLines: string[], rawLines: string[]): DocIndex {
    const vars: VarSymbol[] = [];
    const funcs: FuncSymbol[] = [];
    const structs: StructSymbol[] = [];
    const blocks = collectFuncBlocks(codeLines);

    // ── struct ──
    for (let i = 0; i < codeLines.length; i++) {
        const m = codeLines[i].match(/^\s*struct\s+(\w+)\s*\{/);
        if (!m) continue;

        let depth = 0;
        let endLine = i;
        for (let k = i; k < codeLines.length; k++) {
            for (const ch of codeLines[k]) {
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
            }
            if (depth === 0) { endLine = k; break; }
        }

        const fields: Array<{ name: string; type: string; line: number }> = [];
        for (let k = i + 1; k < endLine; k++) {
            const f = codeLines[k].trim().match(/^(\w+)\s+(\w+)\s*(\[[^\]]*\])?\s*;/);
            if (f) fields.push({ name: f[2], type: f[1], line: k });
        }
        structs.push({ name: m[1], line: i, endLine, fields });
    }

    // ── 全局/成员变量声明 ──
    for (let i = 0; i < codeLines.length; i++) {
        const decl = parseDeclaration(codeLines[i].trim());
        if (!decl) continue;
        const hintMatch = rawLines[i].match(/:\s*([^=;]+)/);
        vars.push({
            name: decl.name,
            type: decl.type,
            keyword: decl.keyword,
            line: i,
            hint: hintMatch ? hintMatch[1].trim() : ''
        });
    }

    // ── 普通全局声明（`LightData main_light;` / `vec3 offset = ...;`） ──
    // 只认"已知类型"（内置类型或本文件声明的 struct）；
    // 未知类型只要不是语句关键字也接受 —— 类型可能来自 #include（如 `Light lamp;`）
    const knownTypes = new Set<string>(GODOT_SHADER_TYPES);
    for (const s of structs) knownTypes.add(s.name);

    // 顶层以这些词开头的都不是"类型 名字"声明
    const STATEMENT_LEADING = new Set([
        'shader_type', 'render_mode', 'stencil_mode', 'group_uniforms',
        'uniform', 'varying', 'const', 'in', 'out', 'inout', 'struct', 'void',
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
        'return', 'discard', 'break', 'continue', 'precision', 'highp', 'mediump', 'lowp'
    ]);

    const insideFuncOrStruct = (line: number): boolean => {
        for (const b of blocks) {
            if (line > b.headerLine && line <= b.closeLine) return true;
        }
        for (const s of structs) {
            if (line >= s.line && line <= s.endLine) return true;
        }
        return false;
    };

    for (let i = 0; i < codeLines.length; i++) {
        if (insideFuncOrStruct(i)) continue;
        const m = codeLines[i].match(/^\s*(\w+)\s+(\w+)\s*(?:\[[^\]]*\])?\s*(?:=|;)/);
        if (!m) continue;
        if (STATEMENT_LEADING.has(m[1])) continue;
        if (!knownTypes.has(m[1]) && !/^[A-Za-z_]\w*$/.test(m[1])) continue;
        if (vars.some(v => v.name === m[2] && v.line === i)) continue;
        vars.push({ name: m[2], type: m[1], keyword: 'global', line: i, hint: '' });
    }

    // ── 函数（含参数、注释、局部变量） ──
    for (const b of blocks) {
        const header = codeLines[b.headerLine];
        const m = header.match(/^\s*((?:\w+\s+)*?)(\w+)\s*\(([^)]*)\)/);
        const returnType = m && m[1].trim() ? m[1].trim() : 'void';
        const paramStr = m ? m[3] : '';

        const params = paramStr.trim()
            ? paramStr.split(',').map(p => {
                const words = p.trim().split(/\s+/).filter(Boolean);
                const name = words.length > 1 ? words[words.length - 1] : (words[0] || '');
                const type = words.length > 1 ? words.slice(0, -1).join(' ') : '';
                return { name, type };
            }).filter(p => p.name)
            : [];

        // 定义上方的连续 // 注释
        const docLines: string[] = [];
        for (let k = b.headerLine - 1; k >= 0; k--) {
            const t = rawLines[k].trim();
            if (t.startsWith('//')) docLines.unshift(t.replace(/^\/\/\s?/, ''));
            else if (t === '' && docLines.length === 0) continue;
            else break;
        }

        funcs.push({ name: b.name, returnType, params, line: b.headerLine, doc: docLines.join('\n') });

        // 函数体内的局部变量
        for (let k = b.openLine + 1; k < b.closeLine; k++) {
            const local = codeLines[k].trim().match(/^(\w+)\s+(\w+)\s*[=;\[]/);
            if (!local) continue;
            if (/^(if|else|for|while|do|switch|case|default|return|discard|struct|const|uniform|varying|in|out)$/.test(local[1])) continue;
            vars.push({
                name: local[2],
                type: local[1],
                keyword: 'local',
                line: k,
                hint: '',
                funcName: b.name
            });
        }

        // 参数也进符号表（便于补全/跳转）
        for (const p of params) {
            vars.push({ name: p.name, type: p.type, keyword: 'param', line: b.headerLine, hint: '', funcName: b.name });
        }
    }

    return { vars, funcs, structs, blocks };
}

/** 取指定行所在函数的局部符号（含参数） */
export function getLocalSymbols(index: DocIndex, line: number): VarSymbol[] {
    const func = (function () {
        let best: FuncBlock | null = null;
        for (const b of index.blocks) {
            if (line >= b.headerLine && line <= b.closeLine) {
                if (!best || b.closeLine - b.headerLine < best.closeLine - best.headerLine) best = b;
            }
        }
        return best;
    })();
    if (!func) return [];
    return index.vars.filter(v => v.funcName === func.name);
}

/** 取全局符号（uniform / varying / const） */
export function getGlobalSymbols(index: DocIndex): VarSymbol[] {
    return index.vars.filter(v => !v.funcName && v.keyword !== 'local' && v.keyword !== 'param');
}
