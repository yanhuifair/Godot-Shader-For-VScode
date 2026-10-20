// Copyright (c) 2026 Fair
// SPDX-License-Identifier: AGPL-3.0

import * as vscode from 'vscode';
import { EN_DESCRIPTIONS } from './en-descriptions';

type Lang = 'zh' | 'en';

// 缓存的 lang 值，避免每次 t()/td() 都调用 getConfiguration
let cachedLang: Lang = 'en';

// 订阅配置变更，lang 变化时刷新缓存
vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('godot-shader.general.language')) {
        const config = vscode.workspace.getConfiguration('godot-shader');
        cachedLang = config.get<Lang>('general.language', 'en');
    }
});

function getLang(): Lang {
    return cachedLang;
}

// 初始化：读取用户配置中的语言设置
function initLang(): void {
    try {
        const config = vscode.workspace.getConfiguration('godot-shader');
        cachedLang = config.get<Lang>('general.language', 'en');
    } catch {
        // VS Code API 尚未就绪时使用默认值
    }
}
initLang();

// ============================================================================
// 翻译表
// ============================================================================

const zh: Record<string, string> = {};
const en: Record<string, string> = {};

// uniform/varying
zh['uniform.declaration'] = '声明外部可调参数。可以在检查器中编辑。';
en['uniform.declaration'] = 'Declare an externally adjustable parameter. Editable in the inspector.';
zh['varying.declaration'] = '在 vertex() 和 fragment() 函数之间传递数据。';
en['varying.declaration'] = 'Pass data between vertex() and fragment() functions.';

// 诊断（被旧代码引用，保留）
zh['diag.missing_semicolon'] = '缺少分号 ;';
en['diag.missing_semicolon'] = 'Missing semicolon ;';
zh['diag.missing_shader_type'] = '缺少 shader_type 声明';
en['diag.missing_shader_type'] = 'Missing shader_type declaration';

// 快速修复
zh['fix.add_semicolon'] = '添加分号 ;';
en['fix.add_semicolon'] = 'Add semicolon ;';
zh['fix.add_shader_type'] = '添加 shader_type canvas_item;';
en['fix.add_shader_type'] = 'Add shader_type canvas_item;';
zh['fix.add_brace'] = '补全缺少的反大括号 }';
en['fix.add_brace'] = 'Add missing closing brace }';
zh['fix.remove_brace'] = '删除多余的反大括号 }';
en['fix.remove_brace'] = 'Remove unexpected closing brace }';

// 可用 shader_type
zh['available_in'] = '适用的着色器类型';
en['available_in'] = 'Available in';

// 状态栏
zh['statusbar.tooltip'] = '当前着色器类型';
en['statusbar.tooltip'] = 'Current shader type';
zh['statusbar.unknown'] = '未知';
en['statusbar.unknown'] = 'Unknown';

// 分隔符
zh['separator'] = '、';
en['separator'] = ', ';

// completion 提示
zh['uniform_only'] = '只用于 uniform 声明';
en['uniform_only'] = 'uniform declarations only';

// hover 标签
zh['description'] = '描述';
en['description'] = 'Description';
zh['valid_values'] = '有效值';
en['valid_values'] = 'Valid Values';
zh['valid_in_prefix'] = '适用于';
en['valid_in_prefix'] = 'Valid in';
zh['group'] = '分组';
en['group'] = 'Group';
zh['items'] = '项';
en['items'] = 'items';
zh['hint_declare_shader_type'] = '提示: 建议在文件开头添加 shader_type 声明以查看当前类型的可行选项。';
en['hint_declare_shader_type'] = 'Tip: Add a shader_type declaration at the top of the file to see valid options for your shader type.';
zh['all_render_modes'] = '所有渲染模式';
en['all_render_modes'] = 'All render modes';
zh['available_functions'] = '可用函数';
en['available_functions'] = 'Available Functions';
zh['type_label'] = '类型';
en['type_label'] = 'Type';
zh['not_available_in_current'] = '当前着色器类型中不可用';
en['not_available_in_current'] = 'Not available in current shader type';
zh['signature'] = '签名';
en['signature'] = 'Signature';
zh['experimental'] = '实验性功能';
en['experimental'] = 'Experimental';
zh['only_available_in_spatial'] = '仅适用于 spatial 着色器';
en['only_available_in_spatial'] = 'Only available in spatial shaders';

// ============================================================================
// 诊断消息
// ============================================================================

zh['diag.invalid_syntax_shader_type'] = 'shader_type 语法错误。正确格式: shader_type type;';
en['diag.invalid_syntax_shader_type'] = 'Invalid shader_type syntax. Correct format: shader_type type;';
zh['diag.invalid_shader_type'] = '无效的 shader_type: {0}。有效值: {1}';
en['diag.invalid_shader_type'] = 'Invalid shader_type: {0}. Valid: {1}';
zh['diag.extra_closing_brace'] = '多余的反大括号 }';
en['diag.extra_closing_brace'] = 'Unexpected closing brace }';
zh['diag.missing_braces'] = '缺少 {0} 个反大括号 }';
en['diag.missing_braces'] = 'Missing {0} closing brace(s) }';
zh['diag.invalid_render_mode'] = "render_mode '{0}' 对 {1} 无效。有效选项: {2}";
en['diag.invalid_render_mode'] = "render_mode '{0}' is invalid for {1}. Valid: {2}";
zh['diag.unknown_function'] = "未知的函数 '{0}'。Godot Shader 有效函数: {1}";
en['diag.unknown_function'] = "Unknown function '{0}'. Valid Godot Shader functions: {1}";
zh['diag.invalid_type'] = "无效的类型 '{0}'。有效类型: {1}";
en['diag.invalid_type'] = "Invalid type '{0}'. Valid types: {1}";
zh['diag.invalid_hint'] = "无效的 hint/flags: '{0}'";
en['diag.invalid_hint'] = "Invalid hint/flag: '{0}'";
zh['diag.reserved_word'] = "'{0}' 是保留字，在 Godot Shader 中不允许使用";
en['diag.reserved_word'] = "'{0}' is a reserved word and cannot be used in Godot Shader";
zh['diag.not_available_in'] = "'{0}' 仅用于 {1} 着色器，在 {2} 中不可用";
en['diag.not_available_in'] = "'{0}' is only available in {1} shader(s), not in {2}";
zh['diag.duplicate_declaration'] = "重复声明 '{0}'（首次声明在第 {1} 行）";
en['diag.duplicate_declaration'] = "Duplicate declaration of '{0}' (first declared at line {1})";
zh['diag.first_declared_here'] = '首次声明于第 {0} 行';
en['diag.first_declared_here'] = 'First declared at line {0}';
zh['diag.const_must_init'] = "常量 '{0}' 必须初始化";
en['diag.const_must_init'] = "'const' variable '{0}' must be initialized";
zh['diag.global_var_must_init'] = "全局变量 '{0}' 必须初始化（或声明为 uniform/varying/const）";
en['diag.global_var_must_init'] = "Global variable '{0}' must be initialized (or declared as uniform/varying/const)";
zh['diag.type_mismatch_assignment'] = "无法将 '{1}' 类型赋值给 '{0}' 变量（{2} 是 {1} 类型）";
en['diag.type_mismatch_assignment'] = "Cannot assign '{1}' value to '{0}' variable ('{2}' is of type '{1}')";
zh['diag.invalid_constructor_trunc'] = "无效的构造函数：不能在 {0}() 中从 {1} 截断";
en['diag.invalid_constructor_trunc'] = "Invalid constructor: cannot truncate from {1} in {0}()";
zh['diag.deprecated_function'] = "'{0}' 不是有效的函数，请使用 '{1}'";
en['diag.deprecated_function'] = "'{0}' is not a valid function, use '{1}' instead";
zh['diag.readonly_builtin'] = "'{0}' 在 {1} 中是只读变量，不能赋值";
en['diag.readonly_builtin'] = "'{0}' is read-only in {1}, cannot be assigned to";
zh['diag.unused_local'] = "'{0}' 已声明但从未使用";
en['diag.unused_local'] = "'{0}' is declared but never used";
zh['diag.invalid_varying_type'] = "无效的 varying 类型 '{0}'。有效类型: {1}";
en['diag.invalid_varying_type'] = "Invalid varying type '{0}'. Valid types: {1}";
zh['diag.discard_outside_fragment'] = "'discard' 只能在 fragment() 或 light() 着色器函数中使用";
en['diag.discard_outside_fragment'] = "'discard' can only be used in fragment() or light() shader function";
zh['diag.keyword_outside_loop'] = "'{0}' 只能在循环 (for/while/do) 中使用";
en['diag.keyword_outside_loop'] = "'{0}' can only be used inside a loop (for/while/do)";
zh['diag.stencil_read_no_alpha'] = 'stencil_mode 含 read 读取但不在透明通道。请在 render_mode 中添加 alpha 混合（blend_*）或 depth_draw_never / depth_draw_always / depth_test_disabled。';
en['diag.stencil_read_no_alpha'] = 'Attempting to use a shader that reads stencil but is not in the alpha queue. Ensure the material uses alpha blending (blend_*) or has depth_draw_never / depth_draw_always / depth_test_disabled.';
zh['diag.invalid_number'] = "无效的数字格式 '{0}'";
en['diag.invalid_number'] = "Invalid number format '{0}'";
zh['diag.invalid_uniform_syntax'] = 'uniform 声明语法错误：类型与变量名之间多了一个标识符（{0}）。正确格式: uniform type name;';
en['diag.invalid_uniform_syntax'] = 'Invalid uniform declaration: extra identifier ({0}) between type and name. Expected: uniform type name;';
zh['diag.shader_type_not_first'] = 'shader_type 必须是文件中的第一条语句（注释与预处理指令除外）';
en['diag.shader_type_not_first'] = 'shader_type must be the first statement in the file (comments and preprocessor directives excepted)';
zh['diag.include_missing'] = "找不到被包含的文件：'{0}'";
en['diag.include_missing'] = "Included file not found: '{0}'";

// 新增诊断（v1.0.65+）
zh['diag.unused_uniform'] = "uniform '{0}' 已声明但从未使用";
en['diag.unused_uniform'] = "uniform '{0}' is declared but never used";
zh['diag.unused_varying'] = "varying '{0}' 已声明但从未使用";
en['diag.unused_varying'] = "varying '{0}' is declared but never used";
zh['diag.shader_func_not_available'] = "'{0}()' 在 shader_type {1} 中不可用。{1} 的可用函数: {2}";
en['diag.shader_func_not_available'] = "'{0}()' is not available in shader_type {1}. Available functions for {1}: {2}";
zh['diag.perf_discard_mobile'] = "'discard' 在移动端渲染器中可能影响性能，建议用 ALPHA 替代";
en['diag.perf_discard_mobile'] = "'discard' may hurt performance on mobile renderers, consider using ALPHA instead";
zh['diag.perf_texture_in_loop'] = "循环内采样纹理可能严重影响性能";
en['diag.perf_texture_in_loop'] = "Texture sampling inside a loop may severely impact performance";

// hover 标签和示例
zh['hover.example'] = '示例';
en['hover.example'] = 'Example';
zh['hover.returns'] = '返回值';
en['hover.returns'] = 'Returns';
zh['hover.params'] = '参数';
en['hover.params'] = 'Parameters';
zh['hover.hint'] = '提示';
en['hover.hint'] = 'Hint';
zh['hover.inspector_hint'] = '可在检查器（Inspector）中编辑该参数';
zh['hover.used_by'] = '用于';
zh['hover.from_file'] = '来自 {0}';
zh['link.open_include'] = '打开 {0}';
en['hover.used_by'] = 'Used by';
en['hover.from_file'] = 'from {0}';
en['link.open_include'] = 'Open {0}';
en['hover.inspector_hint'] = 'Editable in the Inspector';

// 自动导入
zh['completion.auto_import'] = '自动导入';
en['completion.auto_import'] = 'auto import';

// include 展开预览
zh['expand.header'] = '只读预览：所有 #include 已就地展开（原文件未被修改）';
en['expand.header'] = 'Read-only preview: all #include files expanded inline (source untouched)';
zh['expand.source'] = '源文件：{0}';
en['expand.source'] = 'Source: {0}';
zh['expand.expired'] = '预览已过期，请重新运行命令 Godot Shader: 展开 #include 预览';
en['expand.expired'] = 'Preview expired — run "Godot Shader: Expand #include" again';
zh['expand.too_deep'] = 'include 层级过深，已停止展开';
en['expand.too_deep'] = 'Include depth limit reached, stopped expanding';
zh['expand.unresolved'] = '无法解析 include 路径 "{0}"';
en['expand.unresolved'] = 'Cannot resolve include path "{0}"';
zh['expand.duplicate'] = '重复的 include "{0}"（已在上方展开，此处跳过）';
en['expand.duplicate'] = 'Duplicate include "{0}" (already expanded above, skipped)';
zh['expand.missing'] = '找不到文件 "{0}"';
en['expand.missing'] = 'File not found "{0}"';
zh['expand.need_shader_file'] = '请先打开一个 .gdshader 或 .gdshaderinc 文件';
en['expand.need_shader_file'] = 'Open a .gdshader or .gdshaderinc file first';

// 命令
zh['cmd.switch_type.title'] = '切换 shader_type';
en['cmd.switch_type.title'] = 'Switch shader_type';
zh['cmd.switch_type.placeholder'] = '选择着色器类型';
en['cmd.switch_type.placeholder'] = 'Pick a shader type';
zh['cmd.template.title'] = '插入着色器模板';
en['cmd.template.title'] = 'Insert shader template';
zh['cmd.template.placeholder'] = '选择模板';
en['cmd.template.placeholder'] = 'Pick a template';
zh['cmd.template.canvas'] = '2D 画布着色器';
en['cmd.template.canvas'] = '2D canvas shader';
zh['cmd.template.spatial'] = '3D 空间着色器';
en['cmd.template.spatial'] = '3D spatial shader';
zh['cmd.template.sky'] = '程序化天空';
en['cmd.template.sky'] = 'Procedural sky';
zh['cmd.template.fog'] = '体积雾';
en['cmd.template.fog'] = 'Volumetric fog';
zh['cmd.template.particles'] = '粒子';
en['cmd.template.particles'] = 'Particles';
zh['cmd.reload.done'] = '符号缓存已重建';
en['cmd.reload.done'] = 'Symbol caches reloaded';
zh['output.expand_done'] = '已生成展开预览';
en['output.expand_done'] = 'Expanded preview generated';
zh['output.reloaded'] = '已重建 include 与工作区符号缓存';
en['output.reloaded'] = 'Include and workspace symbol caches cleared';

// include 补全标签
zh['include.gdshaderinc'] = 'Godot Shader 包含文件';en['include.gdshaderinc'] = 'Godot Shader Include';
zh['include.gdshader'] = 'Godot Shader 文件';
en['include.gdshader'] = 'Godot Shader File';

// render_mode / stencil_mode 分组标题
zh['cat.Blend Mode'] = '混合模式'; en['cat.Blend Mode'] = 'Blend Mode';
zh['cat.Depth'] = '深度'; en['cat.Depth'] = 'Depth';
zh['cat.Culling'] = '剔除'; en['cat.Culling'] = 'Culling';
zh['cat.Shading'] = '着色'; en['cat.Shading'] = 'Shading';
zh['cat.Shadows'] = '阴影'; en['cat.Shadows'] = 'Shadows';
zh['cat.Lighting'] = '光照'; en['cat.Lighting'] = 'Lighting';
zh['cat.Diffuse Model'] = '漫反射模型'; en['cat.Diffuse Model'] = 'Diffuse Model';
zh['cat.Specular Model'] = '高光模型'; en['cat.Specular Model'] = 'Specular Model';
zh['cat.Fog'] = '雾效'; en['cat.Fog'] = 'Fog';
zh['cat.Vertex Transform'] = '顶点变换'; en['cat.Vertex Transform'] = 'Vertex Transform';
zh['cat.Particles'] = '粒子'; en['cat.Particles'] = 'Particles';
zh['cat.Alpha'] = '透明度'; en['cat.Alpha'] = 'Alpha';
zh['cat.SSS Mode'] = '次表面散射'; en['cat.SSS Mode'] = 'SSS Mode';
zh['cat.Sky'] = '天空'; en['cat.Sky'] = 'Sky';
zh['cat.Debug'] = '调试'; en['cat.Debug'] = 'Debug';
zh['cat.Canvas Item'] = '画布元素'; en['cat.Canvas Item'] = 'Canvas Item';
zh['cat.Operation'] = '操作'; en['cat.Operation'] = 'Operation';
zh['cat.Compare'] = '比较'; en['cat.Compare'] = 'Compare';
zh['cat.Other'] = '其他'; en['cat.Other'] = 'Other';

// 预编译占位符数组，避免 t() 中反复 new RegExp
const PLACEHOLDERS = ['{0}', '{1}', '{2}', '{3}', '{4}', '{5}', '{6}', '{7}'];

/**
 * 获取当前语言的翻译文本
 * @param key 翻译键
 * @param args 可选参数，替换 {0}, {1} 等占位符
 */
export function t(key: string, ...args: (string | number)[]): string {
    const lang = getLang();
    const map = lang === 'en' ? en : zh;
    let text = map[key] || key;
    for (let i = 0; i < args.length; i++) {
        text = text.split(PLACEHOLDERS[i]).join(String(args[i]));
    }
    return text;
}

/**
 * 获取当前语言代码
 */
export function getLanguage(): Lang {
    return getLang();
}

// 直接从内部导出 getLang 供方便使用
export { getLang };

/**
 * 获取内置变量/函数/类型的本地化描述
 * @param name 变量/函数名称
 * @param zhDesc 中文描述（fallback）
 */
export function td(name: string, zhDesc: string): string {
    return getLang() === 'en' ? (EN_DESCRIPTIONS[name] || zhDesc) : zhDesc;
}
