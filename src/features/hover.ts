// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import {
    GODOT_SHADER_BUILTINS,
    GODOT_SHADER_FUNCTIONS,
    GODOT_SHADER_FUNCTION_RETURNS,
    GODOT_SHADER_TYPE_DESCRIPTIONS,
    GODOT_SHADER_RENDER_MODE_DESCRIPTIONS,
    GODOT_SHADER_RENDER_MODES,
    GODOT_SHADER_STENCIL_MODE_DESCRIPTIONS,
    GODOT_SHADER_STENCIL_MODES,
    GODOT_SHADER_HINT_INFO,
    GODOT_SHADER_TYPE_INFO,
    GODOT_SHADER_KEYWORD_INFO,
    getVariableShaderTypes
} from '../shader-data';
import { t, td, getLang } from '../i18n';
import { getShaderType, computeCodeOnlyLines, escapeRegExp } from '../utils';
import { getDocIndex, buildDocIndex, dropDocIndex, DocIndex, VarSymbol, FuncSymbol, StructSymbol } from '../symbol-index';
import { getProjectSymbols, readSourceLines, resolveIncludeUri, IncludeFile } from '../include-graph';

// 预构建内置变量 name→entry 映射（O(1) 查找）
const BUILTIN_MAP: Map<string, { name: string; type: string; description: string }> = new Map();
for (const category of Object.values(GODOT_SHADER_BUILTINS)) {
    if (Array.isArray(category)) {
        for (const entry of category) {
            if (!BUILTIN_MAP.has(entry.name)) {
                BUILTIN_MAP.set(entry.name, entry);
            }
        }
    }
}

/** 内置变量所在的类别（同一名字可能既是 fragment 输出又是 light 输入） */
const BUILTIN_CATEGORIES: Map<string, Set<string>> = new Map();
for (const [category, list] of Object.entries(GODOT_SHADER_BUILTINS)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
        if (!BUILTIN_CATEGORIES.has(entry.name)) BUILTIN_CATEGORIES.set(entry.name, new Set());
        BUILTIN_CATEGORIES.get(entry.name)!.add(category);
    }
}

/** 类别 → 角色描述（只表达数据里的事实，不做只读判定，避免和诊断规则打架） */
const ROLE_LABELS: Array<{ category: string; label: () => string }> = [
    { category: 'vertex_output', label: () => t('hover.role.vertex_out') },
    { category: 'vertex_input', label: () => t('hover.role.vertex_in') },
    { category: 'fragment_output', label: () => t('hover.role.fragment_out') },
    { category: 'fragment_input', label: () => t('hover.role.fragment_in') },
    { category: 'light_output', label: () => t('hover.role.light_out') },
    { category: 'light_input', label: () => t('hover.role.light_in') },
    { category: 'particles_output', label: () => t('hover.role.particles_out') },
    { category: 'particles_input', label: () => t('hover.role.particles_in') }
];

// 预构建内置函数 name→entry 映射（O(1) 查找，替代 Array.find）
const FUNCTION_MAP: Map<string, { name: string; signature: string; description: string }> = new Map();
for (const func of GODOT_SHADER_FUNCTIONS) {
    FUNCTION_MAP.set(func.name, func);
}

// 函数示例代码（hover 时展示用法）
const FUNCTION_EXAMPLES: Record<string, string> = {
    'mix': 'mix(color1, color2, 0.5)',
    'clamp': 'clamp(value, 0.0, 1.0)',
    'smoothstep': 'smoothstep(0.0, 1.0, value)',
    'step': 'step(0.5, value)',
    'dot': 'dot(normal, light_dir)',
    'cross': 'cross(up, forward)',
    'normalize': 'normalize(vector)',
    'length': 'length(vector)',
    'distance': 'distance(a, b)',
    'reflect': 'reflect(incident, normal)',
    'refract': 'refract(I, N, 0.5)',
    'pow': 'pow(base, exponent)',
    'sqrt': 'sqrt(value)',
    'abs': 'abs(value)',
    'floor': 'floor(value)',
    'ceil': 'ceil(value)',
    'fract': 'fract(value)',
    'mod': 'mod(a, b)',
    'min': 'min(a, b)',
    'max': 'max(a, b)',
    'sin': 'sin(TIME)',
    'cos': 'cos(TIME)',
    'tan': 'tan(angle)',
    'atan': 'atan(y, x)',
    'exp': 'exp(value)',
    'log': 'log(value)',
    'texture': 'texture(tex, UV)',
    'textureLod': 'textureLod(tex, UV, 2.0)',
    'dFdx': 'dFdx(UV)',
    'dFdy': 'dFdy(UV)',
    'fwidth': 'fwidth(value)',
    'determinant': 'determinant(mat)',
    'inverse': 'inverse(mat)',
    'transpose': 'transpose(mat)',
};

/** 预处理指令说明（悬停在 #ifdef 等指令上） */
const PREPROCESSOR_DIRECTIVES: Record<string, { zh: string; en: string }> = {
    'include': { zh: '包含另一个 .gdshaderinc 文件（相对路径或以 res:// 开头）', en: 'Include another .gdshaderinc file (relative path or res://)' },
    'define': { zh: '定义宏（预处理阶段做文本替换）', en: 'Define a macro (textual substitution in the preprocessor)' },
    'undef': { zh: '取消宏定义', en: 'Undefine a macro' },
    'if': { zh: '条件编译：表达式为真时编译该分支', en: 'Conditional compilation: branch is compiled when the expression is true' },
    'ifdef': { zh: '条件编译：宏已定义时编译该分支', en: 'Conditional compilation: branch is compiled when the macro is defined' },
    'ifndef': { zh: '条件编译：宏未定义时编译该分支', en: 'Conditional compilation: branch is compiled when the macro is not defined' },
    'elif': { zh: '条件编译：前一个分支不成立时再判断', en: 'Conditional compilation: alternative branch test' },
    'else': { zh: '条件编译：前面条件都不成立时编译该分支', en: 'Conditional compilation: branch taken when previous conditions failed' },
    'endif': { zh: '结束条件编译块', en: 'End of a conditional compilation block' },
    'pragma': { zh: '编译器指令（如 #pragma skip_vertex_transform）', en: 'Compiler directive (e.g. #pragma skip_vertex_transform)' },
    'error': { zh: '编译时主动报错（条件编译调试用）', en: 'Emit a compile error (useful when debugging conditional code)' },
    'warning': { zh: '编译时输出警告（条件编译调试用）', en: 'Emit a compile warning (useful when debugging conditional code)' }
};

/** 变量种类的可读说明 */
function varKindLabel(keyword: string): string {
    switch (keyword) {
        case 'uniform': return t('hover.kind.uniform');
        case 'varying': return t('hover.kind.varying');
        case 'const': return t('hover.kind.const');
        case 'local': return t('hover.kind.local');
        case 'param': return t('hover.kind.param');
        case 'global': return t('hover.kind.global');
        default: return t('hover.kind.variable');
    }
}

/** 着色器入口函数 → 支持的类型 */
const ENTRY_POINT_TYPES: Record<string, string[]> = {
    'fragment': ['canvas_item', 'particles', 'spatial'],
    'light': ['spatial'],
    'sky': ['sky'],
    'fog': ['fog'],
    'vertex': ['canvas_item', 'particles', 'spatial']
};

/** 悬停内容组装：统一版式，避免每个分支各写一套 markdown */
class HoverDoc {
    private parts: string[] = [];

    title(text: string): this {
        this.parts.push('## ' + text);
        return this;
    }

    /** glsl 代码块（声明 / 签名） */
    code(code: string): this {
        this.parts.push('```glsl\n' + code + '\n```');
        return this;
    }

    text(body: string): this {
        if (body) this.parts.push(body);
        return this;
    }

    /** `**Label:** value` 一行 */
    label(name: string, value: string): this {
        this.parts.push(`**${name}:** ${value}`);
        return this;
    }

    /** 多个键值压成一行：`**Type:** x · **Group:** y` */
    meta(pairs: Array<[string, string]>): this {
        const line = pairs
            .filter(([, v]) => !!v)
            .map(([k, v]) => `**${k}:** ${v}`)
            .join(' · ');
        if (line) this.parts.push(line);
        return this;
    }

    quote(body: string): this {
        this.parts.push('> ' + body);
        return this;
    }

    warn(body: string): this {
        this.parts.push('> ⚠️ ' + body);
        return this;
    }

    build(range: vscode.Range): vscode.Hover {
        return new vscode.Hover(new vscode.MarkdownString(this.parts.join('\n\n')), range);
    }
}

/** 把某个着色器类型标成"当前"（粗体代码，不依赖 HTML） */
function emphasizeCurrent(types: string[], current: string | null): string {
    return types
        .map(st => (current && st === current) ? `**\`${st}\`**` : `\`${st}\``)
        .join(', ');
}

// 文档关闭时清理符号索引缓存
vscode.workspace.onDidCloseTextDocument((doc) => {
    if (doc.languageId === 'godot-shader') {
        dropDocIndex(doc.uri);
    }
});

export class GodotShaderHoverProvider implements vscode.HoverProvider {

    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const lineText = document.lineAt(position.line).text;

        // ── 1. #include "…" 里的路径 ──
        const includeHover = this.includePathHover(document, position, lineText);
        if (includeHover) return includeHover;

        // 注释 / 字符串里不弹符号说明（#include 路径已在上面处理）
        if (this.isInCommentOrString(document, position)) return null;

        // ── 2. 预处理行（#define 宏 / #ifdef 等指令） ──
        const preprocHover = this.preprocessorHover(document, position, lineText);
        if (preprocHover) return preprocHover;

        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const word = document.getText(range);
        const textBeforeWord = lineText.substring(0, range.start.character).trim();

        // ── 3. shader_type / 其取值 ──
        if (word === 'shader_type' || textBeforeWord.endsWith('shader_type')) {
            if (word === 'shader_type') return this.shaderTypeKeywordHover(range);
            const desc = this.getShaderTypeDescription(word);
            if (desc) {
                return new HoverDoc()
                    .title(`shader_type \`${word}\``)
                    .meta([[t('group'), desc.category]])
                    .text(td(word, desc.desc))
                    .build(range);
            }
        }

        // ── 4. render_mode / 其取值 ──
        if (word === 'render_mode' || textBeforeWord.includes('render_mode')) {
            if (word === 'render_mode') return this.renderModeKeywordHover(document, range);
            const desc = this.getRenderModeDescription(word);
            if (desc) return this.renderModeValueHover(document, range, word, desc);
        }

        // ── 5. stencil_mode / 其取值 ──
        if (word === 'stencil_mode' || textBeforeWord.includes('stencil_mode')) {
            if (word === 'stencil_mode') return this.stencilModeKeywordHover(document, range);
            const desc = GODOT_SHADER_STENCIL_MODE_DESCRIPTIONS[word];
            if (desc) {
                return new HoverDoc()
                    .title(`stencil_mode \`${word}\``)
                    .meta([[t('group'), desc.detail]])
                    .text(td(word, desc.desc))
                    .build(range);
            }
        }

        // ── 6. uniform hint（仅冒号后的上下文） ──
        const hintDesc = this.getHintDescription(word);
        if (hintDesc && this.isAfterColon(lineText, range.start.character)) {
            return new HoverDoc()
                .title(word)
                .meta([[t('group'), hintDesc.category]])
                .text(td(word, hintDesc.desc))
                .build(range);
        }

        // ── 7. 着色器入口函数 ──
        if (ENTRY_POINT_TYPES[word]) {
            const keywordDesc = this.getKeywordDescription(word);
            if (keywordDesc) {
                const shaderType = getShaderType(document);
                const validFor = ENTRY_POINT_TYPES[word];
                const doc = new HoverDoc()
                    .title(`void ${word}()`)
                    .text(td(word, keywordDesc.desc))
                    .label(t('valid_in_prefix'), emphasizeCurrent(validFor, shaderType));
                if (shaderType && !validFor.includes(shaderType)) {
                    doc.warn(`${t('not_available_in_current')}: \`${shaderType}\``);
                }
                return doc.build(range);
            }
        }

        // ── 8. 关键字 / 类型 ──
        const keywordDesc = this.getKeywordDescription(word);
        if (keywordDesc) {
            return new HoverDoc()
                .title(word)
                .meta([[t('group'), keywordDesc.category]])
                .text(td(word, keywordDesc.desc))
                .build(range);
        }

        const typeDesc = this.getTypeDescription(word);
        if (typeDesc) {
            const doc = new HoverDoc()
                .title(word)
                .meta([[t('group'), typeDesc.category]])
                .text(td(word, typeDesc.desc));
            if (word.startsWith('sampler')) {
                doc.quote(td('sampler_uniform_only', '只能在 uniform 声明中使用'));
            }
            return doc.build(range);
        }

        // ── 9. 内置变量 ──
        const builtin = this.findBuiltin(word);
        if (builtin) return this.builtinHover(document, range, builtin);

        // ── 10. 用户声明的符号（本文件 → include） ──
        const docIndex = getDocIndex(document);
        const project = getProjectSymbols(document);
        const userHover = this.userSymbolHover(document, range, word, lineText, docIndex, project);
        if (userHover) return userHover;

        // ── 10b. 宏（#define，可来自 include） ──
        const macro = this.findMacro(document, word, project);
        if (macro) return this.macroDoc(range, word, macro);

        // ── 11. 内置函数 ──
        const func = this.findFunction(word);
        if (func) {
            const lang = getLang();
            const doc = new HoverDoc()
                .title(`${func.name}()`)
                .code(func.signature)
                .text(td(func.name, func.description));
            const returns = GODOT_SHADER_FUNCTION_RETURNS[func.name];
            if (returns) doc.label(t('hover.returns'), lang === 'zh' ? returns.zh : returns.en);
            const example = FUNCTION_EXAMPLES[func.name];
            if (example) doc.label(t('hover.example'), '`' + example + '`');
            return doc.build(range);
        }

        return null;
    }

    // ────────────────────────────────────────────────────────────────
    // 各类悬停内容
    // ────────────────────────────────────────────────────────────────

    /** `#include "path"`：解析结果 + 是否存在 + 符号数量 */
    private includePathHover(document: vscode.TextDocument, position: vscode.Position, lineText: string): vscode.Hover | null {
        const m = /^\s*#\s*include\s+"([^"]*)"/.exec(lineText);
        if (!m) return null;
        const quoteStart = lineText.indexOf('"');
        const quoteEnd = lineText.lastIndexOf('"');
        if (position.character < quoteStart || position.character > quoteEnd + 1) return null;
        if (quoteStart === quoteEnd) return null;

        const includePath = m[1];
        const range = new vscode.Range(position.line, quoteStart, position.line, quoteEnd + 1);
        const target = resolveIncludeUri(document.uri, includePath);
        const doc = new HoverDoc().title('#include "' + includePath + '"');

        if (!target) {
            doc.warn(t('hover.include_unresolved', includePath));
            return doc.build(range);
        }

        const lines = readSourceLines(target);
        doc.label(t('hover.include_resolved'), '`' + (vscode.workspace.asRelativePath(target, false) || target.path) + '`');
        if (!lines) {
            doc.warn(t('hover.include_missing_file'));
            return doc.build(range);
        }

        const index = buildDocIndex(computeCodeOnlyLines(lines), lines);
        const count = index.vars.filter(v => !v.funcName).length + index.funcs.length + index.structs.length;
        doc.label(t('hover.include_symbols'), String(count));
        doc.quote(t('hover.include_open_hint'));
        return doc.build(range);
    }

    /** 预处理行：`#define` 宏、指令说明 */
    private preprocessorHover(document: vscode.TextDocument, position: vscode.Position, lineText: string): vscode.Hover | null {
        const line = lineText.trim();
        if (!line.startsWith('#')) return null;

        const directiveMatch = line.match(/^#\s*(\w+)/);
        if (!directiveMatch) return null;
        const directive = directiveMatch[1];

        // 指令名字本身
        const directiveStart = lineText.indexOf(directive);
        if (position.character >= directiveStart && position.character <= directiveStart + directive.length) {
            const info = PREPROCESSOR_DIRECTIVES[directive];
            if (!info) return null;
            const range = new vscode.Range(position.line, directiveStart, position.line, directiveStart + directive.length);
            return new HoverDoc()
                .title('#' + directive)
                .text(getLang() === 'zh' ? info.zh : info.en)
                .build(range);
        }

        // #define NAME value
        if (directive === 'define') {
            const defineMatch = lineText.match(/#\s*define\s+([A-Za-z_]\w*)(\([^)]*\))?\s*(.*)$/);
            if (defineMatch) {
                const nameStart = lineText.indexOf(defineMatch[1], directiveStart + directive.length);
                if (position.character >= nameStart && position.character <= nameStart + defineMatch[1].length) {
                    const value = defineMatch[3].trim();
                    const range = new vscode.Range(position.line, nameStart, position.line, nameStart + defineMatch[1].length);
                    const doc = new HoverDoc()
                        .title(defineMatch[1])
                        .code(line)
                        .meta([[t('hover.kind_label'), t('hover.kind.macro')]]);
                    if (value) doc.label(t('hover.macro_value'), '`' + value + '`');
                    doc.label(t('hover.declared_line'), String(position.line + 1));
                    return doc.build(range);
                }
            }
        }

        return null;
    }

    private shaderTypeKeywordHover(range: vscode.Range): vscode.Hover {
        const shaderFuncMap: Record<string, string[]> = {
            'canvas_item': ['fragment', 'vertex'],
            'fog': ['fog'],
            'particles': ['fragment', 'vertex'],
            'sky': ['sky'],
            'spatial': ['fragment', 'light', 'vertex']
        };
        const doc = new HoverDoc()
            .title('shader_type')
            .text(td('shader_type', '声明着色器类型。必须为文件中的第一行。'))
            .label(t('valid_values'), '');
        const entries = Object.entries(GODOT_SHADER_TYPE_DESCRIPTIONS);
        const list = entries.map(([typeName, info]) => {
            const funcs = (shaderFuncMap[typeName] || []).map(f => `\`${f}()\``).join(', ');
            return `- \`${typeName}\` — ${td(typeName, info.desc)}${funcs ? `\n  ${t('available_functions')}: ${funcs}` : ''}`;
        }).join('\n');
        doc.text(list);
        return doc.build(range);
    }

    private renderModeKeywordHover(document: vscode.TextDocument, range: vscode.Range): vscode.Hover {
        const shaderType = getShaderType(document);
        const validModes = shaderType ? GODOT_SHADER_RENDER_MODES[shaderType] : null;
        const doc = new HoverDoc()
            .title('render_mode')
            .text(td('render_mode', '设置渲染模式选项。可控制混合、剔除、光照等。'));

        if (!validModes || validModes.length === 0) {
            if (!shaderType) {
                doc.quote(t('hint_declare_shader_type'));
                const allModes = new Set<string>();
                for (const modes of Object.values(GODOT_SHADER_RENDER_MODES)) {
                    for (const mode of modes) allModes.add(mode);
                }
                doc.label(`${t('all_render_modes')} (${allModes.size})`, '');
                doc.text([...allModes].sort().map(m => `- \`${m}\``).join('\n'));
            } else {
                doc.quote(t('no_render_modes', shaderType));
            }
            return doc.build(range);
        }

        doc.label(t('valid_in_prefix') + ` \`${shaderType}\``, `${validModes.length} ${t('items')}`);
        const CATEGORY_ORDER = [
            'Blend Mode', 'Depth', 'Culling', 'Shading', 'Shadows', 'Lighting',
            'Diffuse Model', 'Specular Model', 'Fog', 'Vertex Transform', 'Particles',
            'Alpha', 'SSS Mode', 'Sky', 'Debug', 'Canvas Item'
        ];
        doc.text(this.groupedModeList(validModes, GODOT_SHADER_RENDER_MODE_DESCRIPTIONS, CATEGORY_ORDER));
        return doc.build(range);
    }

    private renderModeValueHover(document: vscode.TextDocument, range: vscode.Range, word: string, desc: { detail: string; desc: string }): vscode.Hover {
        const shaderType = getShaderType(document);
        const supportedTypes: string[] = [];
        for (const [st, modes] of Object.entries(GODOT_SHADER_RENDER_MODES)) {
            if (modes.includes(word)) supportedTypes.push(st);
        }
        const doc = new HoverDoc()
            .title(`render_mode \`${word}\``)
            .meta([[t('group'), desc.detail]])
            .text(td(word, desc.desc));
        if (supportedTypes.length > 0) {
            doc.label(t('valid_in_prefix'), emphasizeCurrent(supportedTypes, shaderType));
        }
        return doc.build(range);
    }

    private stencilModeKeywordHover(document: vscode.TextDocument, range: vscode.Range): vscode.Hover {
        const shaderType = getShaderType(document);
        const validModes = shaderType ? GODOT_SHADER_STENCIL_MODES[shaderType] : null;
        const doc = new HoverDoc()
            .title('stencil_mode')
            .text(td('stencil_mode', '设置模板缓冲区操作模式（实验性，仅 spatial）。格式: stencil_mode operation, compare, 参考值;'))
            .warn(`${t('experimental')}: ${td('experimental_stencil', 'stencil_mode 是实验性功能，API 可能在未来版本中变化')}`);

        if (!validModes || validModes.length === 0) {
            // 只有"没写 shader_type"才提示去声明；写了但类型不支持要说清楚
            if (!shaderType) doc.quote(t('hint_declare_shader_type'));
            else doc.quote('`stencil_mode` ' + t('not_available_in_current') + ': `' + shaderType + '`');
            doc.text('`stencil_mode` ' + t('only_available_in_spatial'));
            return doc.build(range);
        }

        doc.label(t('valid_in_prefix') + ` \`${shaderType}\``, `${validModes.length} ${t('items')}`);
        doc.text(this.groupedModeList(validModes, GODOT_SHADER_STENCIL_MODE_DESCRIPTIONS, ['Operation', 'Compare']));
        return doc.build(range);
    }

    /** 按分类输出 `- name — desc`，未知分类兜底到末尾 */
    private groupedModeList(
        modes: string[],
        descriptions: Record<string, { detail: string; desc: string }>,
        order: string[]
    ): string {
        const grouped: Record<string, string[]> = {};
        for (const mode of modes) {
            const info = descriptions[mode];
            const cat = info ? info.detail : 'Other';
            (grouped[cat] ||= []).push(mode);
        }
        const sections: string[] = [];
        const emit = (cat: string) => {
            const list = grouped[cat];
            if (!list || list.length === 0) return;
            const title = t('cat.' + cat) === 'cat.' + cat ? cat : t('cat.' + cat);
            const rows = list.map(mode => {
                const info = descriptions[mode];
                const text = info ? td(mode, info.desc) : '';
                return `- \`${mode}\`${text ? ' — ' + text : ''}`;
            });
            sections.push(`**${title}** — ${list.length}\n\n${rows.join('\n')}`);
            delete grouped[cat];
        };
        for (const cat of order) emit(cat);
        for (const cat of Object.keys(grouped)) emit(cat);
        return sections.join('\n\n');
    }

    /** 内置变量：类型 + 说明 + 适用范围（当前类型加粗，不适用时告警） */
    private builtinHover(
        document: vscode.TextDocument,
        range: vscode.Range,
        builtin: { name: string; type: string; description: string }
    ): vscode.Hover {
        const doc = new HoverDoc()
            .title(builtin.name)
            .code(`${builtin.type} ${builtin.name}`)
            .meta([[t('type_label'), '`' + builtin.type + '`']])
            .text(td(builtin.name, builtin.description));

        const categories = BUILTIN_CATEGORIES.get(builtin.name);
        if (categories) {
            const roles = ROLE_LABELS.filter(r => categories.has(r.category)).map(r => r.label());
            if (roles.length > 0) doc.label(t('hover.role_label'), roles.join(' · '));
        }

        const scope = getVariableShaderTypes(builtin.name);
        if (scope) {
            const sorted = [...scope].sort();
            const shaderType = getShaderType(document);
            doc.label(t('available_in'), emphasizeCurrent(sorted, shaderType));
            if (shaderType && !sorted.includes(shaderType)) {
                doc.warn(`${t('not_available_in_current')}: \`${shaderType}\``);
            }
        }
        return doc.build(range);
    }

    /** 用户声明的符号：函数 → struct → 字段 → 变量（本文件优先，其次 include） */
    private userSymbolHover(
        document: vscode.TextDocument,
        range: vscode.Range,
        word: string,
        lineText: string,
        docIndex: DocIndex,
        project: ReturnType<typeof getProjectSymbols>
    ): vscode.Hover | null {
        // 本地 + include 的合并视图（本地优先）
        const structs: Array<{ sym: StructSymbol; origin: IncludeFile | null; lines: string[] | null }> = [
            ...docIndex.structs.map(s => ({ sym: s, origin: null, lines: null })),
            ...project.structs.filter(e => e.origin).map(e => ({ sym: e.sym, origin: e.origin, lines: e.origin!.lines }))
        ];
        const funcs: Array<{ sym: FuncSymbol; origin: IncludeFile | null }> = [
            ...docIndex.funcs.map(f => ({ sym: f, origin: null })),
            ...project.funcs.filter(e => e.origin).map(e => ({ sym: e.sym, origin: e.origin }))
        ];
        const vars: Array<{ sym: VarSymbol; origin: IncludeFile | null }> = [
            ...docIndex.vars.map(v => ({ sym: v, origin: null })),
            ...project.vars.filter(e => e.origin).map(e => ({ sym: e.sym, origin: e.origin }))
        ];

        // ── 函数 ──
        const funcEntry = funcs.find(f => f.sym.name === word);
        if (funcEntry) {
            const f = funcEntry.sym;
            const sig = `${f.returnType} ${f.name}(${f.params.map(p => `${p.type} ${p.name}`.trim()).join(', ')})`;
            const doc = new HoverDoc()
                .title(`${f.name}()`)
                .code(sig);
            if (f.doc) doc.text(f.doc);
            if (f.params.length > 0) {
                doc.label(t('hover.params'), f.params.map(p => p.type ? `\`${p.name}: ${p.type}\`` : `\`${p.name}\``).join(' · '));
            }
            const location = f.line + 1;
            if (funcEntry.origin) {
                doc.label(t('hover.from_file', funcEntry.origin.label), '');
                doc.label(t('hover.declared_line'), String(location));
            } else {
                doc.label(t('hover.declared_line'), String(location));
            }
            return doc.build(range);
        }

        // ── struct ──
        const structEntry = structs.find(s => s.sym.name === word);
        if (structEntry) {
            const s = structEntry.sym;
            const doc = new HoverDoc()
                .title(`struct ${s.name}`)
                .code(`struct ${s.name} {\n${s.fields.map(f => `    ${f.type} ${f.name};`).join('\n')}\n};`);
            if (s.fields.length > 0) {
                doc.label(t('hover.fields'), String(s.fields.length));
            }
            const usedLocally = docIndex.vars.filter(v => v.type === s.name).map(v => v.name);
            const usedInProject = project.vars.filter(v => v.sym.type === s.name).map(v => v.sym.name);
            const used = [...new Set([...usedLocally, ...usedInProject])];
            if (used.length > 0) {
                doc.label(t('hover.used_by'), used.map(u => '`' + u + '`').join(', '));
            }
            if (structEntry.origin) doc.quote(t('hover.from_file', structEntry.origin.label));
            return doc.build(range);
        }

        // ── struct 字段（`obj.field`：按 obj 的实际类型定位，避免同名歧义） ──
        const fieldHover = this.structFieldHover(range, word, lineText, structs, vars);
        if (fieldHover) return fieldHover;

        // ── 变量（uniform / varying / const / 全局对象 / 局部 / 参数） ──
        const varEntry = this.pickVariable(vars, word, docIndex, range.start.line);
        if (varEntry) {
            const v = varEntry.sym;
            const srcLines = varEntry.origin ? varEntry.origin.lines : this.linesOf(document);
            const rawLine = (srcLines[v.line] || '').trim();
            const declaration = v.keyword === 'param'
                ? `${v.type} ${v.name}`.trim()
                : (rawLine || `${v.keyword} ${v.type} ${v.name}`);

            const doc = new HoverDoc()
                .title(v.name)
                .code(declaration)
                .meta([[t('type_label'), '`' + v.type + '`'], [t('hover.kind_label'), varKindLabel(v.keyword)]]);

            if (v.hint) {
                const hintName = v.hint.split('(')[0].trim();
                const hintInfo = GODOT_SHADER_HINT_INFO[hintName];
                const hintDesc = hintInfo ? ` — ${td(hintName, hintInfo.desc)}` : '';
                doc.label(t('hover.hint'), '`' + v.hint + '`' + hintDesc);
            }

            if (v.keyword === 'param' && v.funcName) doc.label(t('hover.param_of'), `\`${v.funcName}()\``);
            else if (v.keyword === 'local' && v.funcName) doc.label(t('hover.local_of'), `\`${v.funcName}()\``);
            else if (v.keyword === 'uniform') doc.quote(t('hover.inspector_hint'));
            else if (v.keyword === 'varying') doc.text(t('hover.varying_desc'));

            if (varEntry.origin) {
                doc.label(t('hover.from_file', varEntry.origin.label), '');
            }
            doc.label(t('hover.declared_line'), String(v.line + 1));
            return doc.build(range);
        }

        // ── include 里声明、但当前文件没直接用的符号 ──
        const incVar = project.vars.find(e => e.origin && e.sym.name === word);
        if (incVar) {
            const v = incVar.sym;
            const doc = new HoverDoc()
                .title(v.name)
                .code(`${v.keyword} ${v.type} ${v.name}`)
                .meta([[t('type_label'), '`' + v.type + '`'], [t('hover.kind_label'), varKindLabel(v.keyword)]]);
            doc.quote(t('hover.from_file', incVar.origin!.label));
            return doc.build(range);
        }

        return null;
    }

    /** struct 字段：优先按 `obj` 的实际类型定位，找不到再退回"同名即匹配" */
    private structFieldHover(
        range: vscode.Range,
        word: string,
        lineText: string,
        structs: Array<{ sym: StructSymbol; origin: IncludeFile | null; lines: string[] | null }>,
        vars: Array<{ sym: VarSymbol; origin: IncludeFile | null }>
    ): vscode.Hover | null {
        const before = lineText.substring(0, range.start.character);

        // 1) 字段声明处（struct 体内）
        for (const e of structs) {
            const decl = e.sym.fields.find(f => f.line === range.start.line && f.name === word);
            if (decl) return this.fieldDoc(e.sym, decl, e.origin, range);
        }

        // 2) `obj.field` 访问处
        const ownerMatch = /([A-Za-z_]\w*)\s*\.\s*$/.exec(before);
        if (!ownerMatch) return null;
        const ownerType = vars.find(v => v.sym.name === ownerMatch[1])?.sym.type;
        const ownerStruct = ownerType ? structs.find(e => e.sym.name === ownerType) : null;
        if (ownerStruct) {
            const field = ownerStruct.sym.fields.find(f => f.name === word);
            if (field) return this.fieldDoc(ownerStruct.sym, field, ownerStruct.origin, range);
            return null;
        }

        // 3) 类型未知 → 同一行里出现过的 struct 字段兜底
        for (const e of structs) {
            const field = e.sym.fields.find(f => f.name === word);
            if (field && new RegExp('\\.\\s*' + word + '\\b').test(lineText)) {
                return this.fieldDoc(e.sym, field, e.origin, range);
            }
        }
        return null;
    }

    private fieldDoc(
        struct: StructSymbol,
        field: { name: string; type: string; line: number },
        origin: IncludeFile | null,
        range: vscode.Range
    ): vscode.Hover {
        const doc = new HoverDoc()
            .title(`${struct.name}.${field.name}`)
            .code(`${field.type} ${field.name};`)
            .meta([[t('type_label'), '`' + field.type + '`'], [t('hover.field_of'), '`' + struct.name + '`']])
            .label(t('hover.declared_line'), String(field.line + 1));
        if (origin) doc.quote(t('hover.from_file', origin.label));
        return doc.build(range);
    }

    /** 同名变量可能有多处（不同函数）——优先光标所在函数里的局部/参数 */
    private pickVariable(
        vars: Array<{ sym: VarSymbol; origin: IncludeFile | null }>,
        word: string,
        index: DocIndex,
        line: number
    ): { sym: VarSymbol; origin: IncludeFile | null } | null {
        const all = vars.filter(v => v.sym.name === word);
        if (all.length === 0) return null;

        const scoped = all.filter(v => (v.sym.keyword === 'local' || v.sym.keyword === 'param') && this.sameFunc(index, v.sym.funcName, line));
        if (scoped.length > 0) return scoped[0];

        const local = all.find(v => v.sym.keyword === 'local' || v.sym.keyword === 'param');
        if (local) return local;
        return all[0];
    }

    private sameFunc(index: DocIndex, funcName: string | undefined, line: number): boolean {
        if (!funcName) return false;
        const block = index.blocks.find(b => b.name === funcName);
        return !!block && line >= block.headerLine && line <= block.closeLine;
    }

    /** 光标是否位于 `:` 之后的 hint 位置（排除三目运算符与 case 标签） */
    private isAfterColon(lineText: string, pos: number): boolean {
        const before = lineText.substring(0, pos);
        const colonIdx = before.lastIndexOf(':');
        if (colonIdx < 0) return false;
        const beforeColon = before.substring(0, colonIdx).trimEnd();
        return !beforeColon.endsWith('?') && !/case\s*$/.test(beforeColon);
    }

    /** 查找 `#define <name>`：本文件优先，其次 include 文件 */
    private findMacro(
        document: vscode.TextDocument,
        name: string,
        project: ReturnType<typeof getProjectSymbols>
    ): { text: string; value: string; line: number; origin: IncludeFile | null } | null {
        const head = new RegExp('^\\s*#\\s*define\\s+' + escapeRegExp(name) + '\\b');
        const parse = (text: string) => {
            const m = text.match(/#\s*define\s+[A-Za-z_]\w*(?:\([^)]*\))?\s*(.*)$/);
            return m ? m[1].trim() : '';
        };

        for (let i = 0; i < document.lineCount; i++) {
            const text = document.lineAt(i).text;
            if (!head.test(text)) continue;
            return { text: text.trim(), value: parse(text), line: i, origin: null };
        }
        for (const inc of project.includes) {
            for (let i = 0; i < inc.lines.length; i++) {
                const text = inc.lines[i];
                if (!head.test(text)) continue;
                return { text: text.trim(), value: parse(text), line: i, origin: inc };
            }
        }
        return null;
    }

    private macroDoc(
        range: vscode.Range,
        name: string,
        macro: { text: string; value: string; line: number; origin: IncludeFile | null }
    ): vscode.Hover {
        const doc = new HoverDoc()
            .title(name)
            .code(macro.text)
            .meta([[t('hover.kind_label'), t('hover.kind.macro')]]);
        if (macro.value) doc.label(t('hover.macro_value'), '`' + macro.value + '`');
        doc.label(t('hover.declared_line'), String(macro.line + 1));
        if (macro.origin) doc.quote(t('hover.from_file', macro.origin.label));
        return doc.build(range);
    }

    /** 光标是否落在注释 / 字符串里（跨行块注释也能识别） */
    private isInCommentOrString(document: vscode.TextDocument, position: vscode.Position): boolean {
        const rawLines: string[] = [];
        for (let i = 0; i < document.lineCount; i++) rawLines.push(document.lineAt(i).text);
        const masked = computeCodeOnlyLines(rawLines);
        const raw = rawLines[position.line] ?? '';
        const code = masked[position.line] ?? '';
        const idx = Math.min(position.character, raw.length - 1);
        if (idx < 0) return false;
        return (code[idx] ?? ' ') === ' ' && raw[idx] !== ' ';
    }

    private linesOf(document: vscode.TextDocument): string[] {
        const out: string[] = [];
        for (let i = 0; i < document.lineCount; i++) out.push(document.lineAt(i).text);
        return out;
    }

    // 通用内置变量查找（O(1) map 查找替代 O(n) 线性扫描）
    private findBuiltin(name: string): { name: string; type: string; description: string } | null {
        return BUILTIN_MAP.get(name) || null;
    }

    private findFunction(name: string): { name: string; signature: string; description: string } | null {
        return FUNCTION_MAP.get(name) || null;
    }

    // 获取 shader_type 描述
    private getShaderTypeDescription(type: string | null): { category: string, desc: string } | null {
        return type && GODOT_SHADER_TYPE_DESCRIPTIONS[type] ? GODOT_SHADER_TYPE_DESCRIPTIONS[type] : null;
    }

    // 获取 render_mode 描述
    private getRenderModeDescription(mode: string | null): { detail: string, desc: string } | null {
        return mode && GODOT_SHADER_RENDER_MODE_DESCRIPTIONS[mode] ? {
            detail: GODOT_SHADER_RENDER_MODE_DESCRIPTIONS[mode].detail,
            desc: GODOT_SHADER_RENDER_MODE_DESCRIPTIONS[mode].desc
        } : null;
    }

    // 获取 uniform hint 描述
    private getHintDescription(hint: string | null): { category: string, desc: string } | null {
        return hint && GODOT_SHADER_HINT_INFO[hint] ? {
            category: GODOT_SHADER_HINT_INFO[hint].category,
            desc: GODOT_SHADER_HINT_INFO[hint].desc
        } : null;
    }

    // 获取 Godot Shader 关键字描述
    private getKeywordDescription(keyword: string | null): { category: string, desc: string } | null {
        return keyword && GODOT_SHADER_KEYWORD_INFO[keyword] ? GODOT_SHADER_KEYWORD_INFO[keyword] : null;
    }

    // 获取 Godot Shader 类型描述
    private getTypeDescription(type: string | null): { category: string, desc: string } | null {
        return type && GODOT_SHADER_TYPE_INFO[type] ? GODOT_SHADER_TYPE_INFO[type] : null;
    }
}
