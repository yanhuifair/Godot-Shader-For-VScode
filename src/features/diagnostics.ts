// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GODOT_SHADER_BUILTINS, GODOT_SHADER_RENDER_MODES, GODOT_SHADER_HINTS, getVariableShaderTypes } from '../shader-data';
import { t } from '../i18n';
import { computeCodeOnlyLines, isInCommentOrString, parseDeclaration } from '../utils';

export class GodotShaderDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private debounceTimer: NodeJS.Timeout | undefined;
    /** 抹掉注释与字符串后的逐行文本（与原文等长，index 可直接复用） */
    private codeLines: string[] = [];

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('godot-shader');
    }

    public activate(context: vscode.ExtensionContext) {
        context.subscriptions.push(this.diagnosticCollection);

        // 监听文档变化
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'godot-shader') {
                this.debouncedValidate(event.document);
            }
        }, null, context.subscriptions);

        // 监听文档打开
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'godot-shader') {
                this.validate(document);
            }
        }, null, context.subscriptions);

        // 监听文档保存
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'godot-shader') {
                this.validate(document);
            }
        }, null, context.subscriptions);

        // 初始化时检查所有已打开的文档
        vscode.workspace.textDocuments.forEach((document) => {
            if (document.languageId === 'godot-shader') {
                this.validate(document);
            }
        });
    }

    private debouncedValidate(document: vscode.TextDocument) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.validate(document);
        }, 500); // 500ms 防抖
    }

    private validate(document: vscode.TextDocument): void {
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');
        // 预先算好"纯代码"版本：注释与字符串被替换为等长空格，
        // 后续所有"是否真的是代码"的判断都基于它，避免行内注释/字符串/跨行块注释误报
        this.codeLines = computeCodeOnlyLines(lines);

        // 1. 检查是否有 shader_type 声明
        this.checkShaderType(lines, diagnostics, document);

        // 2. 检查大括号匹配
        this.checkBraceMatching(lines, diagnostics, document);

        // 2b. 检查 #include 目标是否存在
        this.checkIncludes(lines, diagnostics, document);

        // 3. 检查分号
        this.checkSemicolons(lines, diagnostics, document);

        // 4. 检查 render_mode 语法
        this.checkRenderMode(lines, diagnostics, document);

        // 5. 检查变量声明（函数入口兼容性由 checkShaderFuncAvailability 负责）
        this.checkVariableDeclarations(lines, diagnostics, document);

        // 7. 检查保留字使用
        this.checkReservedWords(lines, diagnostics, document);

        // 8. 检查内置变量范围
        this.checkBuiltinVariableScope(lines, diagnostics, document);

        // 9. 检查重复变量声明
        this.checkDuplicateDeclarations(lines, diagnostics, document);

        // 10. 检查 const 初始化
        this.checkConstInit(lines, diagnostics, document);

        // 11. 检查 varying 类型
        this.checkVaryingType(lines, diagnostics, document);

        // 12. 检查 discard / break / continue 上下文
        this.checkControlFlow(lines, diagnostics, document);

        // 13. 检查 stencil_mode read 是否在透明通道
        this.checkStencilReadPass(lines, diagnostics, document);

        // 14. 检查数字写法是否合法
        this.checkNumberFormat(lines, diagnostics);

        // 15. 检查 shader_type 对应函数是否匹配（如 spatial 中写了 sky()）
        this.checkShaderFuncAvailability(lines, diagnostics, document);

        // 16. 检查未使用的 uniform/varying 声明
        this.checkUnusedDeclarations(lines, diagnostics, document);

        // 17. 性能提示诊断（strictMode 下启用）
        this.checkPerformanceHints(lines, diagnostics, document);

        // 18. 检查 uniform hint 是否合法
        this.checkUniformHints(lines, diagnostics, document);

        // 19. 检查变量赋值类型是否匹配内置变量类型
        this.checkTypeMismatch(lines, diagnostics, document);

        // 20. 检查无效构造函数（高维截断如 vec2(vec3)）
        this.checkInvalidConstructor(lines, diagnostics, document);

        // 21. 检查不存在的函数调用（如 atan2 → 应使用 atan(y, x)）
        this.checkDeprecatedFunctions(lines, diagnostics, document);

        // 22. 检查只读内置变量被赋值（如 LIGHT = xxx）
        this.checkReadonlyBuiltins(lines, diagnostics, document);

        // 23. 检查声明但未使用的局部变量
        this.checkUnusedLocals(lines, diagnostics, document);

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private checkShaderType(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // .gdshaderinc 包含文件不需要 shader_type 声明
        if (document.fileName.endsWith('.gdshaderinc')) {
            return;
        }

        let found = false;
        let shaderTypeLine = -1;
        const validTypes = ['canvas_item', 'fog', 'particles', 'sky', 'spatial'];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('shader_type')) {
                found = true;
                shaderTypeLine = i;
                const match = line.match(/^shader_type\s+(\w+)\s*;/);
                if (!match) {
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, 0, i, lines[i].length),
                        message: t('diag.invalid_syntax_shader_type'),
                        source: 'godot-shader'
                    });
                } else {
                    const type = match[1];
                    if (!validTypes.includes(type)) {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(i, 0, i, lines[i].length),
                            message: t('diag.invalid_shader_type', type, validTypes.join(', ')),
                            source: 'godot-shader'
                        });
                    }
                }
                break;
            }
        }

        if (!found) {
            diagnostics.push({
                severity: vscode.DiagnosticSeverity.Warning,
                range: new vscode.Range(0, 0, 0, 0),
                message: t('diag.missing_shader_type'),
                source: 'godot-shader'
            });
            return;
        }

        // shader_type 必须是第一条语句（注释与预处理指令允许出现在前面）
        for (let k = 0; k < shaderTypeLine; k++) {
            const text = lines[k].trim();
            if (!text || text.startsWith('//') || text.startsWith('/*') ||
                text.startsWith('*') || text.startsWith('#') || text.startsWith('*/')) {
                continue;
            }
            diagnostics.push({
                severity: vscode.DiagnosticSeverity.Warning,
                range: new vscode.Range(k, 0, k, lines[k].length),
                message: t('diag.shader_type_not_first'),
                source: 'godot-shader'
            });
            break;
        }
    }

    // 检查 #include 目标文件是否存在（仅本地文件系统，virtual/remote FS 跳过）
    private checkIncludes(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        if (document.uri.scheme !== 'file') return;

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^\s*#include\s+"([^"]+)"/);
            if (!m) continue;

            const includePath = m[1];
            let target = '';

            if (includePath.startsWith('res://')) {
                const folders = vscode.workspace.workspaceFolders;
                if (!folders || folders.length === 0) continue;
                target = path.join(folders[0].uri.fsPath, includePath.substring('res://'.length));
            } else {
                target = path.join(path.dirname(document.uri.fsPath), includePath);
            }

            try {
                if (!fs.existsSync(target)) {
                    const idx = lines[i].indexOf(includePath);
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Warning,
                        range: new vscode.Range(i, idx, i, idx + includePath.length),
                        message: t('diag.include_missing', includePath),
                        source: 'godot-shader'
                    });
                }
            } catch {
                // 无法访问文件系统时忽略
            }
        }
    }

    private checkBraceMatching(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        let braceCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                // 跳过注释和字符串内的大括号
                if ((char === '{' || char === '}') && isInCommentOrString(line, j)) {
                    continue;
                }
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount < 0) {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(i, j, i, j + 1),
                            message: t('diag.extra_closing_brace'),
                            source: 'godot-shader'
                        });
                        braceCount = 0;
                    }
                }
            }
        }

        if (braceCount > 0) {
            diagnostics.push({
                severity: vscode.DiagnosticSeverity.Error,
                range: new vscode.Range(lines.length - 1, 0, lines.length - 1, 0),
                message: t('diag.missing_braces', braceCount),
                source: 'godot-shader'
            });
        }
    }

    private checkSemicolons(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // 跳过空行、纯注释行、预处理指令
            if (!line || line.startsWith('//') || line.startsWith('/*') || 
                line.startsWith('*') || line.startsWith('#')) {
                continue;
            }

            // 剥离行尾 // 注释，得到纯代码部分
            const commentIdx = this.indexOfLineComment(line);
            const codeOnly = commentIdx >= 0 ? line.substring(0, commentIdx).trimEnd() : line;

            // ── 跳过不需要分号的结构 ──

            // 1) 声明行：shader_type / render_mode / stencil_mode
            if (line.startsWith('shader_type') || line.startsWith('render_mode') ||
                line.startsWith('stencil_mode')) {
                continue;
            }

            // 2) switch 标签
            if (line.startsWith('case ') || line.startsWith('default:')) {
                continue;
            }

            // 3) 块边界：{ } 以及标签冒号
            if (codeOnly === '{' || codeOnly === '}' ||
                codeOnly.endsWith('{') || codeOnly.endsWith('}') || codeOnly.endsWith(':')) {
                continue;
            }

            // 4) 多行表达式续行特征 — 行尾以下符号表示语句未结束
            //    算术运算符: + - * / %
            //    赋值: =
            //    比较: == != <= >= < >
            //    逻辑: && ||
            //    三元: ?
            //    参数/构造续行: ( , )
            const continuationRegex = /[+\-*\/%=(,?)]$/;
            if (continuationRegex.test(codeOnly)) {
                continue;
            }
            //    二元运算符需要特殊处理（避免误匹配单字符行）
            if (/[<>!]=$/.test(codeOnly) || /&&$/.test(codeOnly) || /\|\|$/.test(codeOnly)) {
                continue;
            }

            // 5) 单独的 ) 闭合括号（可能跟分号，也可能只是多行表达式结尾）
            if (codeOnly === ')' || codeOnly === ');') {
                continue;
            }

            // ── 分号检查 ──
            // 语句可以跨行书写（运算符写在下一行行首），此时不应报缺少分号
            if (this.statementContinuesOnNextLine(i)) continue;
            if (this.shouldHaveSemicolon(codeOnly) && !codeOnly.endsWith(';')) {
                diagnostics.push({
                    severity: vscode.DiagnosticSeverity.Error,
                    range: new vscode.Range(i, lines[i].length, i, lines[i].length),
                    message: t('diag.missing_semicolon'),
                    source: 'godot-shader'
                });
            }
        }
    }

    /**
     * 判断语句是否延续到下一行：下一行以运算符 / 逗号 / 右括号开头即视为续行，
     * 例如
     *     float x = 1.0
     *         + 2.0;
     * 这类写法不应报「缺少分号」。
     */
    private statementContinuesOnNextLine(line: number): boolean {
        for (let k = line + 1; k < this.codeLines.length; k++) {
            const next = this.codeLines[k].trim();
            if (!next) continue;
            if (/^[\)\],]/.test(next)) return true;
            return /^(\+|-|\*|\/|%|\?|:|\.|&|\||\^|&&|\|\||==|!=|<=|>=|<<|>>)/.test(next);
        }
        return false;
    }

    // 返回行中第一个 // 注释的位置（排除字符串内的 //），无注释返回 -1
    private indexOfLineComment(line: string): number {
        let inString = false;
        for (let i = 0; i < line.length - 1; i++) {
            if (line[i] === '"' && (i === 0 || line[i - 1] !== '\\')) {
                inString = !inString;
            }
            if (!inString && line[i] === '/' && line[i + 1] === '/') {
                return i;
            }
        }
        return -1;
    }

    private shouldHaveSemicolon(line: string): boolean {
        // 变量声明
        if (/^(uniform|varying|in|out|const)\s+/.test(line)) {
            return true;
        }

        // Inspector 分组指令
        if (/^group_uniforms\b/.test(line)) {
            return true;
        }

        // 局部变量声明: "float v = 1.0" / "vec3 c" / "mat4 m = ..."（函数定义会以 { 或 ) 结尾，已在调用方跳过）
        if (/^(bool|int|uint|float|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234]|sampler\w+)\s+\w+/.test(line) &&
            !/\(\s*$/.test(line)) {
            return true;
        }
        
        // 赋值语句 (不包含 if/while/for 条件)
        if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*=/.test(line) && 
            !/^(if|while|for)\s*\(/.test(line)) {
            return true;
        }

        // 函数调用
        if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(line) && !/^(if|while|for|switch)\s*\(/.test(line)) {
            return true;
        }

        // return 语句
        if (/^return\s/.test(line)) {
            return true;
        }

        return false;
    }

    private checkRenderMode(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        let currentShaderType = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 获取 shader_type
            const shaderMatch = line.match(/^shader_type\s+(\w+)/);
            if (shaderMatch) {
                currentShaderType = shaderMatch[1];
            }

            // 检查 render_mode
            const renderMatch = line.match(/^render_mode\s+(.+);/);
            if (renderMatch && currentShaderType) {
                const modes = renderMatch[1].split(',').map(m => m.trim());
                const validList = GODOT_SHADER_RENDER_MODES[currentShaderType] || [];
                // 该 shader_type 暂无有效清单（如 fog）→ 无法判定，跳过以免全部误报
                if (validList.length === 0) continue;
                
                for (const mode of modes) {
                    if (!validList.includes(mode)) {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Warning,
                            range: new vscode.Range(i, 0, i, lines[i].length),
                            message: t('diag.invalid_render_mode', mode, currentShaderType, validList.length > 0 ? validList.join(', ') : '—'),
                            source: 'godot-shader'
                        });
                    }
                }
            }
        }
    }

    private checkVariableDeclarations(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 检查 uniform 声明（含 global uniform / instance uniform）
            const decl = parseDeclaration(line);
            if (decl && decl.keyword === 'uniform') {
                const type = decl.type;
                const validTypes = ['bool', 'bvec2', 'bvec3', 'bvec4', 'float', 'int', 'ivec2', 'ivec3', 'ivec4',
                                   'mat2', 'mat3', 'mat4',
                                   'sampler2D', 'sampler2DArray', 'samplerCube', 'samplerExternalOES',
                                   'uint', 'uvec2', 'uvec3', 'uvec4',
                                   'vec2', 'vec3', 'vec4'];
                
                if (!validTypes.includes(type)) {
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, 0, i, lines[i].length),
                        message: t('diag.invalid_type', type, validTypes.join(', ')),
                        source: 'godot-shader'
                    });
                } else {
                    // 类型合法但后面还多一个标识符：uniform vec3 broken_type my_var;
                    const extra = line.match(/^(?:(?:global|instance)\s+)?uniform\s+\w+\s+(\w+)\s+(\w+)/);
                    if (extra) {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(i, 0, i, lines[i].length),
                            message: t('diag.invalid_uniform_syntax', extra[2]),
                            source: 'godot-shader'
                        });
                    }
                }
            }
        }
    }

    private checkReservedWords(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // Godot Shader 保留字：GLSL 中有效但在 Godot Shader 中不允许的关键字
        const reservedWords = [
            'main', 'input', 'output', 'half', 'fixed', 'double',
            'hvec2', 'hvec3', 'hvec4', 'dvec2', 'dvec3', 'dvec4',
            'fvec2', 'fvec3', 'fvec4',
            'sampler1D', 'sampler3D', 'sampler1DShadow', 'sampler2DShadow',
            'samplerCubeShadow', 'sampler1DArray', 'sampler2DArrayShadow',
            'isampler1D', 'isampler2D', 'isampler3D', 'isamplerCube',
            'usampler1D', 'usampler2D', 'usampler3D', 'usamplerCube',
            'atomic_uint', 'patch', 'sample', 'subroutine',
            'common', 'partition', 'active', 'asm',
            'class', 'union', 'enum', 'typedef', 'template',
            'this', 'packed', 'goto', 'inline', 'noinline',
            'volatile', 'public', 'static', 'extern', 'interface',
            'long', 'short', 'precision', 'invariant'
        ];

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            // 跳过注释、预处理和声明行
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') ||
                trimmed.startsWith('*') || trimmed.startsWith('#')) {
                continue;
            }

            // 用 mask 后的代码行匹配，行内注释 / 字符串 / 跨行块注释都不会误报
            const code = this.codeLines[i] ?? lines[i];

            // 使用词边界匹配，避免误报（如 "domain" 中的 "main"）
            for (const word of reservedWords) {
                const regex = new RegExp('\\b' + word + '\\b');
                const match = regex.exec(code);
                if (match) {
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Warning,
                        range: new vscode.Range(i, match.index, i, match.index + word.length),
                        message: t('diag.reserved_word', word),
                        source: 'godot-shader'
                    });
                }
            }
        }
    }

    // 根据 shader_type 检测内置变量范围
    private checkBuiltinVariableScope(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // 获取当前着色器类型
        let shaderType = '';
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].trim().match(/^shader_type\s+(\w+)/);
            if (match) {
                shaderType = match[1];
                break;
            }
        }
        if (!shaderType) return;

        // 扫描每一行，查找内置变量名
        const varRegex = /\b[A-Z][A-Z0-9_]*(?:_[A-Z0-9]+)*\b/g;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // 跳过注释行、预处理指令、声明行
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || 
                trimmed.startsWith('*') || trimmed.startsWith('#') ||
                trimmed.startsWith('shader_type') || trimmed.startsWith('render_mode') ||
                trimmed.startsWith('uniform') || trimmed.startsWith('varying') ||
                trimmed.startsWith('in ') || trimmed.startsWith('out ') || trimmed.startsWith('const ')) {
                continue;
            }

            // 提取行中的大写变量名（用 mask 后的代码行，跳过注释/字符串内容）
            let match;
            const code = this.codeLines[i] ?? line;
            const regex = new RegExp(varRegex.source, 'g');
            while ((match = regex.exec(code)) !== null) {
                const name = match[0];
                
                // 忽略短名称
                if (name.length <= 2) continue;
                
                // 跳过常见 GLSL 关键字和函数名
                if (['IF', 'FOR', 'WHILE', 'INT', 'FLOAT', 'BOOL', 'TRUE', 'FALSE',
                     'RETURN', 'BREAK', 'CONTINUE', 'DISCARD', 'VOID', 'STRUCT',
                     'MAT2', 'MAT3', 'MAT4', 'VEC2', 'VEC3', 'VEC4',
                     'IVEC2', 'IVEC3', 'IVEC4', 'UVEC2', 'UVEC3', 'UVEC4',
                     'BVEC2', 'BVEC3', 'BVEC4',
                     'SIN', 'COS', 'TAN', 'ABS', 'MIN', 'MAX', 'POW', 'EXP', 'LOG',
                     'MOD', 'SIGN', 'FLOOR', 'CEIL', 'FRACT', 'SQRT', 'DOT', 'CROSS',
                     'NORMALIZE', 'LENGTH', 'DISTANCE', 'CLAMP', 'MIX', 'STEP',
                     'SMOOTHSTEP', 'RADIANS', 'DEGREES'].includes(name)) {
                    continue;
                }

                // 使用缓存的 getVariableShaderTypes 代替每次重建 lookup map
                const validTypes = getVariableShaderTypes(name);
                if (validTypes && !validTypes.includes(shaderType)) {
                    const validList = validTypes.join(t('separator'));
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, match.index, i, match.index + name.length),
                        message: t('diag.not_available_in', name, validList, shaderType),
                        source: 'godot-shader'
                    });
                }
            }
        }
    }

    // 9. 检查重复变量声明
    private checkDuplicateDeclarations(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        const declaredNames = new Map<string, number>(); // name → first line index

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('//') || line.startsWith('/*')) continue;

            // 匹配 uniform/varying/in/out/const type name（含 global/instance 前缀、flat/smooth 限定符）
            const declMatch = parseDeclaration(line);
            if (declMatch) {
                const name = declMatch.name;
                if (declaredNames.has(name)) {
                    const firstLine = declaredNames.get(name)!;
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, lines[i].indexOf(name), i, lines[i].indexOf(name) + name.length),
                        message: t('diag.duplicate_declaration', name, String(firstLine + 1)),
                        source: 'godot-shader'
                    });
                } else {
                    declaredNames.set(name, i);
                }
            }
        }
    }

    // 10. 检查 const 必须初始化 + 全局变量无初始化（Godot 4 要求全局非 uniform/varying 变量必须初始化）
    private checkConstInit(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        let braceDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const rawLine = lines[i];

            // 追踪大括号深度（字符串/注释里的 { } 不计入）
            for (const ch of (this.codeLines[i] ?? rawLine)) {
                if (ch === '{') braceDepth++;
                else if (ch === '}') braceDepth--;
            }

            // 1) const 必须初始化
            const constMatch = line.match(/^const\s+(\w+)\s+(\w+)\s*;/);
            if (constMatch) {
                diagnostics.push({
                    severity: vscode.DiagnosticSeverity.Error,
                    range: new vscode.Range(i, 0, i, lines[i].length),
                    message: t('diag.const_must_init', constMatch[2]),
                    source: 'godot-shader'
                });
                continue;
            }

            // 2) 全局作用域 (braceDepth === 0) 中，非 uniform/varying/const 的类型声明需初始化
            if (braceDepth > 0) continue;
            if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('#')) continue;
            if (/^(uniform|varying|const|void|struct|shader_type|render_mode|stencil_mode|group_uniforms?)/.test(line)) continue;

            // 匹配: type name; （无初始化的全局变量声明）
            const globalMatch = line.match(/^(\w+)\s+(\w+)\s*;$/);
            if (globalMatch) {
                const typeName = globalMatch[1];
                // 仅当 type 是有效着色器类型时才报错（排除函数声明等）
                if (['bool','bvec2','bvec3','bvec4','float','int','ivec2','ivec3','ivec4',
                     'mat2','mat3','mat4','sampler2D','sampler2DArray','samplerCube',
                     'samplerExternalOES','uint','uvec2','uvec3','uvec4','vec2','vec3','vec4'].includes(typeName)) {
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, 0, i, lines[i].length),
                        message: t('diag.global_var_must_init', globalMatch[2]),
                        source: 'godot-shader'
                    });
                }
            }
        }
    }

    // 11. 检查 varying 类型
    private checkVaryingType(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        const validTypes = ['bvec2', 'bvec3', 'bvec4', 'bool', 'float', 'int', 'ivec2', 'ivec3', 'ivec4',
                            'mat2', 'mat3', 'mat4', 'sampler2D', 'sampler2DArray', 'samplerCube',
                            'uvec2', 'uvec3', 'uvec4',
                            'vec2', 'vec3', 'vec4'];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // 支持 `varying flat vec3 x` / `varying smooth vec3 x`（flat/smooth 是插值限定符，不是类型）
            const match = line.match(/^varying\s+(?:(?:flat|smooth)\s+)?(\w+)\s+(\w+)/);
            if (match && !validTypes.includes(match[1])) {
                diagnostics.push({
                    severity: vscode.DiagnosticSeverity.Error,
                    range: new vscode.Range(i, 0, i, lines[i].length),
                    message: t('diag.invalid_varying_type', match[1], validTypes.join(', ')),
                    source: 'godot-shader'
                });
            }
        }
    }

    // 12. 检查 discard / break / continue 上下文
    private checkControlFlow(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // 当前所在的最外层函数（vertex/fragment/light/sky/fog，或 null = 自定义函数/全局）
        let currentFunc: string | null = null;
        let depth = 0;
        // 栈：记录每个大括号层级中的上下文标记
        const contextStack: Array<{ loop: boolean; switch: boolean }> = [];

        for (let i = 0; i < lines.length; i++) {
            // 用 mask 后的代码行：注释/字符串里的 discard、break 不再误报
            const code = this.codeLines[i] ?? lines[i];

            // 顶层函数入口识别（`{` 单独成行时保持上一次的识别结果）
            if (depth === 0) {
                const header = code.trim();
                if (header && header !== '{') {
                    const fm = header.match(/^(?:\w+\s+)?(vertex|fragment|light|sky|fog)\s*\(/);
                    if (fm) {
                        currentFunc = fm[1];
                    } else if (/^\w[\w\s]*\(/.test(header)) {
                        currentFunc = null; // 其他函数声明（自定义函数）
                    }
                }
            }

            const tokenRegex = /[A-Za-z_]\w*|[{}]/g;
            let match: RegExpExecArray | null;

            while ((match = tokenRegex.exec(code)) !== null) {
                const token = match[0];

                if (token === '{') {
                    const before = code.substring(0, match.index);
                    let isLoop = /\b(for|while|do)\b/.test(before);
                    let isSwitch = /\bswitch\b/.test(before);

                    // { 单独成行时，回溯上一行非空非注释内容判断是否循环/switch
                    if (!isLoop && !isSwitch && before.trim() === '') {
                        for (let k = i - 1; k >= 0; k--) {
                            const prev = (this.codeLines[k] ?? lines[k]).trim();
                            if (!prev) continue;
                            isLoop = /\b(for|while|do)\b/.test(prev);
                            isSwitch = /\bswitch\b/.test(prev);
                            break;
                        }
                    }

                    const parent = contextStack[contextStack.length - 1];
                    contextStack.push({
                        loop: (parent?.loop ?? false) || isLoop,
                        switch: (parent?.switch ?? false) || isSwitch
                    });
                    depth++;
                    continue;
                }

                if (token === '}') {
                    if (contextStack.length > 0) contextStack.pop();
                    depth = Math.max(0, depth - 1);
                    if (depth === 0) currentFunc = null;
                    continue;
                }

                if (token === 'discard') {
                    // 只对内置入口函数判定；自定义函数无法确定调用位置（可能被 fragment 调用），不报
                    if (currentFunc === 'vertex' || currentFunc === 'sky' || currentFunc === 'fog') {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(i, match.index, i, match.index + token.length),
                            message: t('diag.discard_outside_fragment'),
                            source: 'godot-shader'
                        });
                    }
                    continue;
                }

                if (token === 'break' || token === 'continue') {
                    const ctx = contextStack[contextStack.length - 1];
                    if (token === 'break' && ctx?.switch) continue;
                    if (!ctx?.loop && !ctx?.switch) {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(i, match.index, i, match.index + token.length),
                            message: t('diag.keyword_outside_loop', token),
                            source: 'godot-shader'
                        });
                    }
                }
            }
        }
    }

    // 13. 检查 stencil_mode 读取时必须在透明通道
    private checkStencilReadPass(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        let stencilReads = false;
        let stencilLine = -1;
        let renderModeLine = -1;
        let renderModes: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 检测 stencil_mode 声明
            const stencilMatch = line.match(/^stencil_mode\s+(.+);/);
            if (stencilMatch) {
                const values = stencilMatch[1].split(',').map(v => v.trim());
                if (values.includes('read')) {
                    stencilReads = true;
                    stencilLine = i;
                }
            }

            // 检测 render_mode 声明
            const renderMatch = line.match(/^render_mode\s+(.+);/);
            if (renderMatch) {
                renderModeLine = i;
                renderModes = renderMatch[1].split(',').map(m => m.trim());
            }
        }

        if (!stencilReads) return;

        // 透明通道条件：blend 模式、depth_draw_never、depth_test_disabled
        const blendModes = ['blend_mix', 'blend_add', 'blend_sub', 'blend_mul', 'blend_premul_alpha'];
        const transparentModes = ['depth_draw_never', 'depth_draw_always', 'depth_test_disabled'];

        const hasBlend = renderModes.some(m => blendModes.includes(m));
        const hasTransparentMode = renderModes.some(m => transparentModes.includes(m));

        if (!hasBlend && !hasTransparentMode) {
            const line = stencilLine;
            diagnostics.push({
                severity: vscode.DiagnosticSeverity.Warning,
                range: new vscode.Range(line, 0, line, lines[line].length),
                message: t('diag.stencil_read_no_alpha'),
                source: 'godot-shader'
            });
        }
    }

    // 14. 检查数字写法是否合法（Godot/GLSL 数值格式校验）
    private checkNumberFormat(lines: string[], diagnostics: vscode.Diagnostic[]) {
        for (let i = 0; i < lines.length; i++) {
            // 用 mask 后的代码行匹配：注释（含行尾注释、块注释）与字符串里的
            // "1.0.5" / "v1.2.3" 之类文本不再被当成数字字面量误报
            const text = this.codeLines[i] ?? lines[i];

            // 跳过注释行
            const trimmed = text.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                continue;
            }

            // 查找所有疑似数字的 token。
            //
            // 关键约束：
            // 1) 字符类内绝不能包含 + / -，否则会把"无空格的运算符表达式"
            //    （如 1.0-0.5、5+2、2.0*0.5+1.0）误并入一个数字 token 而误报。
            //    符号仅允许出现在指数部分（e/E/p/P 之后）。
            // 2) GLSL 十六进制浮点（0x...pN）与十进制浮点（...eN）使用的指数字母不同、
            //    可用数字集也不同，若用同一个贪婪字符类会把十进制指数字母 e 当成十六进制
            //    数字吞掉（1.5e-2 误拆成 1.5e / 2）。因此拆成三条独立正则分别匹配。
            const decimalRegex = /\b\d+\.?\d*(?:[eE][+-]?\d+)?[fFuU]?\b/g;          // 十进制浮点/整数
            const hexRegex = /\b0[xX][0-9a-fA-F]*(?:\.[0-9a-fA-F]*)?(?:[pP][+-]?[0-9]+)?[fFuU]?\b/g; // 十六进制浮点/整数
            const dotRegex = /\B\.\d[\d]*(?:[eE][+-]?\d+)?[fFuU]?\b/g;              // .5 / .5e3 / .5f 等
            let match: RegExpExecArray | null;

            const testToken = (re: RegExp) => {
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    const token = m[0];
                    // 跳过明显合法的简单数字（纯整数）
                    if (/^\d+[uU]?$/.test(token)) continue;
                    if (!this.isValidNumber(token)) {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(i, m.index, i, m.index + token.length),
                            message: t('diag.invalid_number', token),
                            source: 'godot-shader'
                        });
                    }
                }
            };

            testToken(decimalRegex);
            testToken(hexRegex);
            testToken(dotRegex);

            // 补充：捕获"精确拆分后仍漏掉"的非法数字写法。
            // 这些正则是"仅匹配非法形态"的，对合法代码零误报风险。
            const invalidDoubleDot = /\b\d+\.\d*\.\d*/g;     // 1.0.5 / 1..5
            // 指数字母后没有"可选符号 + 数字"：1.5e / 1e- / 1.5e+（不完整指数）
            // 注意用否定前瞻 (?![+-]?\d) 整体判定，避免把 1.5e-2 误拆成 1.5e。
            const invalidTrailingExp = /\b\d+\.?\d*[eEpP](?![+-]?\d)/g;

            const testInvalid = (re: RegExp) => {
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    const token = m[0];
                    // 避免与上面已正确判定的合法数字（如 0x1.0p4）冲突：仅当不是合法数字时才报错
                    if (this.isValidNumber(token)) continue;
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, m.index, i, m.index + token.length),
                        message: t('diag.invalid_number', token),
                        source: 'godot-shader'
                    });
                }
            };

            testInvalid(invalidDoubleDot);
            testInvalid(invalidTrailingExp);
        }
    }

    // 校验单个数字 token 是否为合法 Godot 4 / GLSL ES 3.0 数值
    private isValidNumber(token: string): boolean {
        // 1. 十六进制整数: 0xFF, 0xFFu（GLSL ES 3.0 不支持 0b 二进制）
        if (/^0[xX][0-9a-fA-F]+[uU]?$/.test(token)) return true;
        // 1b. 十六进制浮点: 0x1.0p4, 0x1p4, 0x.5p-2f（GLSL ES 3.0 支持）
        if (/^0[xX][0-9a-fA-F]+(\.[0-9a-fA-F]+)?[pP][+-]?\d+[fF]?$/.test(token)) return true;
        if (/^0[xX][0-9a-fA-F]*\.[0-9a-fA-F]+[pP][+-]?\d+[fF]?$/.test(token)) return true;

        // 2. 科学计数法浮点数: 1.5e3, 1e3, 1.5e-2, 1e+2f
        if (/^\d+\.\d*[eE][+-]?\d+[fF]?$/.test(token)) return true;
        if (/^\d+[eE][+-]?\d+[fF]?$/.test(token)) return true;

        // 3. 常规浮点数: 1.0, 1., .5, 1f, .5f, 1.5f, 2.f
        if (/^\d+\.\d+[fF]?$/.test(token)) return true;
        if (/^\d+\.[fF]$/.test(token)) return true;     // 2.f
        if (/^\d+\.$/.test(token)) return true;
        if (/^\d+[fF]$/.test(token)) return true;
        if (/^\.\d+[eE][+-]?\d+[fF]?$/.test(token)) return true;
        if (/^\.\d+[fF]?$/.test(token)) return true;

        return false;
    }

    // 15. 检查 shader_type 与着色器入口函数是否匹配
    private checkShaderFuncAvailability(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        let shaderType = '';
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].trim().match(/^shader_type\s+(\w+)/);
            if (match) { shaderType = match[1]; break; }
        }
        if (!shaderType) return;

        const funcMap: Record<string, string[]> = {
            'canvas_item': ['fragment', 'vertex'],
            'fog': ['fog'],
            'particles': ['fragment', 'vertex'],
            'sky': ['sky'],
            'spatial': ['fragment', 'light', 'vertex']
        };

        const available = funcMap[shaderType] || [];
        // 仅对 Godot 内置着色器入口函数名做校验，自定义 void 函数不在此列
        const allShaderFuncs = ['fog', 'fragment', 'light', 'sky', 'vertex'];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const match = line.match(/^void\s+(\w+)\s*\(/);
            if (match) {
                const funcName = match[1];
                // 只有内置入口函数名才需要校验 shader_type 兼容性
                if (allShaderFuncs.includes(funcName) && !available.includes(funcName)) {
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, 0, i, lines[i].length),
                        message: t('diag.shader_func_not_available', funcName, shaderType, available.join(', ')),
                        source: 'godot-shader'
                    });
                }
            }
        }
    }

    // 16. 检查未使用的 uniform/varying 声明
    private checkUnusedDeclarations(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // .gdshaderinc 里的 uniform 通常由包含它的 .gdshader 使用，单独打开时无法判断 → 跳过
        if (document.fileName.endsWith('.gdshaderinc')) return;

        // 收集所有声明
        const decls: Array<{ name: string; keyword: string; line: number; col: number }> = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const decl = parseDeclaration(trimmed);
            if (decl && (decl.keyword === 'uniform' || decl.keyword === 'varying')) {
                const name = decl.name;
                // 跳过太短的名称（如 a, b 等测试变量）
                if (name.length <= 1) continue;
                const col = line.indexOf(name);
                decls.push({ keyword: decl.keyword, name, line: i, col });
            }
        }

        if (decls.length === 0) return;

        // 对每个声明，在声明行之外搜索引用（排除注释和字符串内的引用）
        for (const decl of decls) {
            let refCount = 0;

            for (let i = 0; i < lines.length; i++) {
                if (i === decl.line) continue; // 跳过声明行自身

                // 用 mask 后的代码行搜索，跨行块注释与字符串都不会被算作引用
                const text = this.codeLines[i] ?? lines[i];
                // 使用词边界匹配
                const escaped = decl.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp('\\b' + escaped + '\\b', 'g');
                let match: RegExpExecArray | null;

                while ((match = regex.exec(text)) !== null) {
                    refCount++;
                }
            }

            if (refCount === 0) {
                const key = decl.keyword === 'uniform' ? 'diag.unused_uniform' : 'diag.unused_varying';
                diagnostics.push({
                    severity: vscode.DiagnosticSeverity.Hint,
                    range: new vscode.Range(decl.line, decl.col, decl.line, decl.col + decl.name.length),
                    message: t(key, decl.name),
                    source: 'godot-shader'
                });
            }
        }
    }

    // 17. 性能提示诊断（strictMode 下启用额外性能警告）
    private checkPerformanceHints(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        const config = vscode.workspace.getConfiguration('godot-shader');
        if (!config.get<boolean>('diagnostics.strictMode', false)) return;

        // 逐字符维护大括号栈：每个元素表示该层是否为循环块。
        // 必须按字符出现顺序处理，否则 `if (x) { y(); }` 这类单行块会把
        // 「先闭合再开启」的顺序颠倒，导致后续循环上下文错位（漏报循环内采样）。
        const braceLoopStack: boolean[] = [];
        const loopDepth = () => braceLoopStack.reduce((n, v) => n + (v ? 1 : 0), 0);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 注释/字符串内容已被抹成空格，discard、texture 只在真代码里匹配
            const code = this.codeLines[i] ?? line;
            const trimmed = code.trim();
            if (!trimmed) continue;

            // 预先收集本行 texture( 出现的位置
            const texPositions: number[] = [];
            const texRe = /\btexture\s*\(/g;
            let tm: RegExpExecArray | null;
            while ((tm = texRe.exec(code)) !== null) {
                texPositions.push(tm.index);
                texRe.lastIndex = tm.index + tm[0].length;
            }
            const discardPos = /\bdiscard\b/.exec(code);

            let texIdx = 0;
            let openSeen = false;

            for (let j = 0; j < code.length; j++) {
                if (texIdx < texPositions.length && j === texPositions[texIdx]) {
                    if (loopDepth() > 0) {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Warning,
                            range: new vscode.Range(i, j, i, j + 'texture'.length),
                            message: t('diag.perf_texture_in_loop'),
                            source: 'godot-shader'
                        });
                    }
                    texIdx++;
                }

                const ch = code[j];
                if (ch === '{') {
                    const before = code.substring(0, j);
                    let isLoop = /\b(for|while|do)\b/.test(before);
                    // { 单独成行时回溯上一行
                    if (!isLoop && !openSeen && before.trim() === '') {
                        for (let k = i - 1; k >= 0; k--) {
                            const prev = (this.codeLines[k] ?? lines[k]).trim();
                            if (!prev) continue;
                            isLoop = /\b(for|while|do)\b/.test(prev);
                            break;
                        }
                    }
                    braceLoopStack.push(isLoop && !openSeen);
                    openSeen = true;
                } else if (ch === '}') {
                    braceLoopStack.pop();
                }
            }

            // discard 性能提示
            if (discardPos) {
                diagnostics.push({
                    severity: vscode.DiagnosticSeverity.Information,
                    range: new vscode.Range(i, discardPos.index, i, discardPos.index + 'discard'.length),
                    message: t('diag.perf_discard_mobile'),
                    source: 'godot-shader'
                });
            }
        }
    }

    // 18. 检查 uniform 声明中 : 后面的 hint/flag 是否合法
    private checkUniformHints(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        const validHints: Set<string> = new Set(GODOT_SHADER_HINTS);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 用 mask 后的代码行解析，行尾注释（// xxx）不会被当成 hint
            const trimmed = (this.codeLines[i] ?? line).trim();

            // 匹配 uniform type name : hint1, hint2, hint3 ...
            // 支持 : 后跟一个或多个逗号分隔的 hint
            const match = trimmed.match(/^(?:(?:global|instance)\s+)?uniform\s+\w+\s+\w+\s*:\s*(.+)/);
            if (!match) continue;

            const hintsPart = match[1];

            // 按 = 分割（hint 部分在 = 之前），取出 hint 列表
            const eqIdx = hintsPart.indexOf('=');
            let rawHints = eqIdx >= 0 ? hintsPart.substring(0, eqIdx) : hintsPart;

            // 去掉末尾分号
            rawHints = rawHints.replace(/;$/, '').trimEnd();

            // 用正则提取各个 hint 名（支持带括号参数如 hint_range(0, 1)）
            const hintRegex = /(\w+)(?:\([^)]*\))?/g;
            let hintMatch: RegExpExecArray | null;
            while ((hintMatch = hintRegex.exec(rawHints)) !== null) {
                const hint = hintMatch[1];
                if (!validHints.has(hint)) {
                    const col = line.indexOf(hint);
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, col >= 0 ? col : 0, i, (col >= 0 ? col : 0) + hint.length),
                        message: t('diag.invalid_hint', hint),
                        source: 'godot-shader'
                    });
                }
            }
        }
    }

    // 19. 检查变量赋值时类型是否与内置变量类型匹配（如 uint x = VERTEX_ID; VERTEX_ID 是 int）
    private checkTypeMismatch(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // 构建 内置变量名 → 类型 的映射
        const builtinTypeMap = new Map<string, string>();
        for (const cat of Object.values(GODOT_SHADER_BUILTINS)) {
            if (!Array.isArray(cat)) continue;
            for (const v of cat) {
                builtinTypeMap.set(v.name, v.type);
            }
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;

            // 匹配: type name = IDENTIFIER; 或 type name = IDENTIFIER.xxx;
            const match = trimmed.match(/^(\w+)\s+(\w+)\s*=\s*([A-Za-z_]\w*)\s*;/);
            if (!match) continue;

            const declaredType = match[1];  // LHS: uint
            const rhsIdentifier = match[3]; // RHS: VERTEX_ID

            // 跳过非内置变量的赋值
            const builtinType = builtinTypeMap.get(rhsIdentifier);
            if (!builtinType) continue;

            // 类型完全一致 → 放行
            if (declaredType === builtinType) continue;

            // 标量类型兼容性：同族放行（vec2=vec2, mat3=mat3）
            // 明确的类型不匹配才报错
            const isScalar = ['float','int','uint','bool'].includes(declaredType)
                          && ['float','int','uint','bool'].includes(builtinType);

            // 标量不匹配 → 报错
            if (isScalar && declaredType !== builtinType) {
                const col = line.indexOf(rhsIdentifier);
                diagnostics.push({
                    severity: vscode.DiagnosticSeverity.Error,
                    range: new vscode.Range(i, col >= 0 ? col : 0, i, (col >= 0 ? col : 0) + rhsIdentifier.length),
                    message: t('diag.type_mismatch_assignment', declaredType, builtinType, rhsIdentifier),
                    source: 'godot-shader'
                });
            }
        }
    }

    // 20. 检查无效构造函数（Godot 4 不允许高维截断：vec2(vec3), mat2(mat3) 等）
    private checkInvalidConstructor(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // 不允许的截断构造: type(highDimType)
        const invalidPatterns: Array<{from: string, to: string, regex: RegExp}> = [
            { from: 'vec3', to: 'vec2', regex: /\bvec2\s*\(\s*vec3\s*\(/ },
            { from: 'vec4', to: 'vec2', regex: /\bvec2\s*\(\s*vec4\s*\(/ },
            { from: 'vec4', to: 'vec3', regex: /\bvec3\s*\(\s*vec4\s*\(/ },
            { from: 'ivec3', to: 'ivec2', regex: /\bivec2\s*\(\s*ivec3\s*\(/ },
            { from: 'ivec4', to: 'ivec2', regex: /\bivec2\s*\(\s*ivec4\s*\(/ },
            { from: 'ivec4', to: 'ivec3', regex: /\bivec3\s*\(\s*ivec4\s*\(/ },
            { from: 'uvec3', to: 'uvec2', regex: /\buvec2\s*\(\s*uvec3\s*\(/ },
            { from: 'uvec4', to: 'uvec2', regex: /\buvec2\s*\(\s*uvec4\s*\(/ },
            { from: 'uvec4', to: 'uvec3', regex: /\buvec3\s*\(\s*uvec4\s*\(/ },
            { from: 'bvec3', to: 'bvec2', regex: /\bbvec2\s*\(\s*bvec3\s*\(/ },
            { from: 'bvec4', to: 'bvec2', regex: /\bbvec2\s*\(\s*bvec4\s*\(/ },
            { from: 'bvec4', to: 'bvec3', regex: /\bbvec3\s*\(\s*bvec4\s*\(/ },
            { from: 'mat3', to: 'mat2', regex: /\bmat2\s*\(\s*mat3\s*\(/ },
            { from: 'mat4', to: 'mat2', regex: /\bmat2\s*\(\s*mat4\s*\(/ },
            { from: 'mat4', to: 'mat3', regex: /\bmat3\s*\(\s*mat4\s*\(/ },
        ];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

            for (const p of invalidPatterns) {
                const match = p.regex.exec(line);
                if (match) {
                    const col = match.index;
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Error,
                        range: new vscode.Range(i, col, i, col + match[0].length),
                        message: t('diag.invalid_constructor_trunc', p.to, p.from),
                        source: 'godot-shader'
                    });
                    break; // 每行只报一个构造错误
                }
            }
        }
    }

    // 21. 检查不存在的函数（如 atan2 → 应使用 atan(y, x)）
    private checkDeprecatedFunctions(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // 常见错误函数名 → 正确替代
        const deprecated: Array<{name: string, replace: string}> = [
            { name: 'atan2', replace: 'atan(y, x)' },
            { name: 'dfdx', replace: 'dFdx' },
            { name: 'dfdy', replace: 'dFdy' },
        ];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

            for (const d of deprecated) {
                const regex = new RegExp('\\b' + d.name + '\\s*\\(', 'g');
                let match;
                while ((match = regex.exec(line)) !== null) {
                    if (!isInCommentOrString(line, match.index)) {
                        diagnostics.push({
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(i, match.index, i, match.index + d.name.length),
                            message: t('diag.deprecated_function', d.name, d.replace),
                            source: 'godot-shader'
                        });
                    }
                }
            }
        }
    }

    // 22. 检查只读内置变量被赋值（如 LIGHT = xxx 在 spatial light() 中 LIGHT 是只读输入）
    private checkReadonlyBuiltins(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        // 构建"某个 shader 函数内只读"的内置变量集合
        // vertex_input + vertex_matrices(VIEW/INV_VIEW) + vertex_bones 在 vertex() 中只读
        // fragment_input 在 fragment() 中只读
        // light_input 在 light() 中只读
        const readonlyInVertex = new Set<string>();
        const readonlyInFragment = new Set<string>();
        const readonlyInLight = new Set<string>();

        for (const v of GODOT_SHADER_BUILTINS.vertex_input || []) readonlyInVertex.add(v.name);
        for (const v of GODOT_SHADER_BUILTINS.vertex_bones || []) readonlyInVertex.add(v.name);
        readonlyInVertex.add('VIEW_MATRIX');
        readonlyInVertex.add('INV_VIEW_MATRIX');
        readonlyInVertex.add('INV_PROJECTION_MATRIX');
        readonlyInVertex.add('MAIN_CAM_INV_VIEW_MATRIX');
        readonlyInVertex.add('OUTPUT_IS_SRGB');
        readonlyInVertex.add('VIEWPORT_SIZE');

        // 当前 shader_type（决定 fragment() 里哪些内置变量其实是"可写输出"）
        let shaderType = '';
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].trim().match(/^shader_type\s+(\w+)/);
            if (m) { shaderType = m[1]; break; }
        }

        // fragment() 中可写、但出现在 fragment_input 里的变量，必须从只读集合中剔除，否则误报：
        //  - DEPTH：空间着色器可在 fragment 中写入以覆盖深度
        //  - canvas_item：COLOR / VERTEX / UV / UV2 / TEXTURE 都是可写输出
        const writableInFragment = new Set<string>(['DEPTH']);
        if (shaderType === 'canvas_item') {
            for (const name of ['COLOR', 'VERTEX', 'UV', 'UV2', 'TEXTURE', 'NORMAL_TEXTURE']) {
                writableInFragment.add(name);
            }
        }

        for (const v of GODOT_SHADER_BUILTINS.fragment_input || []) {
            if (!writableInFragment.has(v.name)) readonlyInFragment.add(v.name);
        }

        for (const v of GODOT_SHADER_BUILTINS.light_input || []) readonlyInLight.add(v.name);

        // 追踪当前所在着色器函数
        let inVertex = false, inFragment = false, inLight = false;
        let braceDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
                // 仍需要追踪大括号（不含注释/字符串里的括号）
                for (const ch of (this.codeLines[i] ?? line)) {
                    if (ch === '{') braceDepth++;
                    else if (ch === '}') braceDepth--;
                }
                continue;
            }

            // 追踪函数边界
            if (/^(void\s+)?vertex\s*\(/.test(trimmed)) inVertex = true;
            if (/^(void\s+)?fragment\s*\(/.test(trimmed)) inFragment = true;
            if (/^(void\s+)?light\s*\(/.test(trimmed)) inLight = true;

            for (const ch of (this.codeLines[i] ?? line)) {
                if (ch === '{') braceDepth++;
                else if (ch === '}') {
                    braceDepth--;
                    if (braceDepth <= 0) {
                        inVertex = inFragment = inLight = false;
                    }
                }
            }

            if (braceDepth <= 0) continue;

            // 检查赋值: BUILTIN = ... 或 BUILTIN += ... 等形式
            const assignMatch = trimmed.match(/^(\w+)\s*(\+|\-|\*|\/)?=\s*/);
            if (!assignMatch) continue;

            const name = assignMatch[1];
            let readonlySet: Set<string> | null = null;
            let context = '';
            if (inVertex && readonlyInVertex.has(name)) { readonlySet = readonlyInVertex; context = 'vertex()'; }
            if (inFragment && readonlyInFragment.has(name)) { readonlySet = readonlyInFragment; context = 'fragment()'; }
            if (inLight && readonlyInLight.has(name)) { readonlySet = readonlyInLight; context = 'light()'; }

            if (readonlySet) {
                const col = line.indexOf(name);
                diagnostics.push({
                    severity: vscode.DiagnosticSeverity.Error,
                    range: new vscode.Range(i, col, i, col + name.length),
                    message: t('diag.readonly_builtin', name, context),
                    source: 'godot-shader'
                });
            }
        }
    }

    // 23. 检查声明但未使用的局部变量
    private checkUnusedLocals(lines: string[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        let braceDepth = 0;
        let inFunction = false;
        let structDepth = 0;
        // 当前函数内: 变量名 → {声明行, 列, 已使用}
        const localVars = new Map<string, {line: number, col: number, used: boolean}>();

        const flushLocals = () => {
            for (const [name, info] of localVars) {
                if (!info.used && name.length > 1) {
                    diagnostics.push({
                        severity: vscode.DiagnosticSeverity.Warning,
                        range: new vscode.Range(info.line, info.col, info.line, info.col + name.length),
                        message: t('diag.unused_local', name),
                        source: 'godot-shader'
                    });
                }
            }
            localVars.clear();
            inFunction = false;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // 跳过注释行与预处理指令（#define 的宏参数不能被当成局部变量）
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') ||
                trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

            // 检测函数声明进入（排除 struct 声明，避免误将结构体字段当作局部变量）
            const funcMatch = trimmed.match(/^(void\s+)?\w+\s+(\w+)\s*\(([^)]*)\)\s*\{?/);
            if (funcMatch && !inFunction && !/^\s*struct\b/.test(trimmed)) {
                const paramStr = funcMatch[3] || '';
                inFunction = true;
                localVars.clear();

                // 收集参数名（跳过类型和修饰符）
                const paramRegex = /(?:in\s+|out\s+|inout\s+)?\w+\s+(\w+)(?:\s*[\[\(][^)\]]*[\]\)])?\s*(?:,|$)/g;
                let pm;
                while ((pm = paramRegex.exec(paramStr)) !== null) {
                    localVars.set(pm[1], {line: i, col: line.indexOf(pm[1]), used: false});
                }
            }

            // 追踪大括号深度（同时追踪 struct 深度，struct 内部不视为局部变量作用域）
            const maskedLine = this.codeLines[i] ?? line;
            for (const ch of maskedLine) {
                if (ch === '{') {
                    const before = line.substring(0, line.indexOf('{'));
                    if (/\bstruct\b/.test(before)) structDepth++;
                    braceDepth++;
                } else if (ch === '}') {
                    // struct 的 } 也要正常回收 braceDepth，否则深度会永久偏移，
                    // 导致函数作用域判断与 flushLocals 时机错乱
                    const leavingStruct = structDepth > 0;
                    if (leavingStruct) structDepth--;
                    braceDepth--;
                    if (!leavingStruct && braceDepth <= 0 && inFunction) {
                        flushLocals();
                    }
                }
            }

            if (!inFunction || braceDepth <= 0 || structDepth > 0) continue;

            // 检测局部变量声明: type name = ...; 或 type name;
            // 跳过 uniform/varying/const/void/return 等
            // 用 mask 后的代码行做匹配，行尾注释里的同名文字不会把变量"标成已使用"
            const code = this.codeLines[i] ?? line;
            const declMatch = trimmed.match(/^(\w+)\s+(\w+)\s*[=;]/);
            if (declMatch) {
                const typeName = declMatch[1];
                const varName = declMatch[2];
                // 排除关键字、类型名（避免误匹配）
                if (!['if','else','for','while','do','return','switch','case','default','discard','void','struct'].includes(typeName)) {
                    if (!localVars.has(varName)) {
                        const col = line.indexOf(varName);
                        localVars.set(varName, {line: i, col, used: false});
                    }
                    // RHS 中引用的变量标记为已使用（包括自身，如 a = a + 1）
                    const restAfter = code.trim().substring(declMatch[0].length);
                    for (const [name, info] of localVars) {
                        if (new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(restAfter)) {
                            info.used = true;
                        }
                    }
                }
            }

            // 检测变量使用：在非声明行中出现的变量名
            for (const [name, info] of localVars) {
                if (info.used) continue;
                // 声明行本身不算使用（该行 RHS 已在上面处理）
                if (declMatch && declMatch[2] === name) continue;
                const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (new RegExp('\\b' + escaped + '\\b').test(code)) {
                    info.used = true;
                }
            }
        }

        // 文件末尾可能还有未刷新的函数
        if (inFunction) flushLocals();
    }

    public dispose() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        this.diagnosticCollection.dispose();
    }
}
