<!-- Copyright (c) 2026 Fair -->
<!-- SPDX-License-Identifier: AGPL-3.0 -->
<!-- markdownlint-disable MD033 MD041 MD013 -->
<div align="center">

![VS Code](https://img.shields.io/badge/VS%20Code-1.100%2B-007ACC?logo=visualstudiocode&logoColor=white)
![Godot](https://img.shields.io/badge/Godot-4.x-478CBF?logo=godotengine&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.120-2ea44f)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Stars](https://img.shields.io/github/stars/yanhuifair/Godot-Shader-For-VScode?style=flat-square)
[![Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-Install-blue?logo=visualstudio)](https://marketplace.visualstudio.com/items?itemName=fairyan.godot-shader-for-vscode)

</div>

<p align="center">
  <img alt="logo" src="images/logo.png" width="128" />
</p>

# Godot Shader for VS Code

> 🌐 [English](./README.md)

Godot 4 着色器的完整语言支持 —— **28 个语言能力（Provider）**、**162 个内置符号**、**121 个内置函数**、
**65 个代码片段**、**23 条诊断规则**，支持 `#include` **跨文件解析**，中英双语。

**仓库地址：** <https://github.com/yanhuifair/Godot-Shader-For-VScode>
**插件市场：** <https://marketplace.visualstudio.com/items?itemName=fairyan.godot-shader-for-vscode>

[功能亮点](#功能亮点) · [安装](#安装) · [补全](#补全) · [跨文件支持](#跨文件支持) · [悬停](#悬停) · [签名帮助](#签名帮助) · [内联提示](#内联提示) · [CodeLens](#codelens) · [诊断](#诊断) · [格式化](#格式化) · [导航](#导航) · [调用层次](#调用层次) · [命令](#命令) · [视觉特性](#视觉特性) · [快速修复](#快速修复) · [代码片段](#代码片段) · [配置项](#配置项) · [环境要求](#环境要求) · [已知限制](#已知限制) · [常见问题](#常见问题) · [开发](#开发)

---

## 功能亮点

- **自己写的符号同样被完整支持** —— 补全、悬停、签名帮助、跳转定义、查找引用、重命名都认识你声明的
  uniform、函数、struct 与局部变量，而不只是内置符号。
- **默认跨文件** —— `.gdshaderinc`（含传递 include）里声明的符号在各处都能解析；重命名会连
  include 文件里的声明一起改。
- **自动导入** —— 工作区其它 `.gdshaderinc` 里声明的符号也会出现在补全中，并自动补上对应的
  `#include`。
- **命令化操作** —— 展开 include 只读预览、切换 `shader_type`、插入模板、重建符号缓存
  （命令面板 / 右键菜单 / `Ctrl+Alt+E`）。
- **编辑体验** —— on-type 格式化（自动对齐 `}`、规范化 `;`）、一键 Fix All，
  以及跨 include 的函数调用层次。
- **注释/字符串感知的诊断** —— 23 条规则，绝不会因为注释、字符串或 `#if 0` 块里的文字而报错。
- **真正的格式化** —— switch/case 缩进、运算符空格、大括号风格、CRLF 保持。
- **粘贴与拖拽自动补 include** —— 粘贴一段引用了别的 `.gdshaderinc` 符号的代码，
  会同时写入对应的 `#include`；把文件拖进编辑器也会自动插入 include 行。
- **类型感知的导航** —— 类型定义（变量 → 它的 struct）、转到声明（跳到引入该符号的 `#include` 行）、
  struct 组合关系层次、联动编辑。
- **真正的侧边栏** —— 按 `group_uniforms` 分组的参数、带缺失标注的 include 图、工作区全部着色器。
- **问 `@shader`** —— 对话里使用 `/expand`、`/uniforms`、`/diagnostics`、`/docs`
  （斜杠命令不需要语言模型）。
- **随处可用** —— 未保存的文件、Remote-SSH、WSL、开发容器与虚拟文件系统里一样能用。
- **其它** —— 语义高亮、折叠、取色器、快速修复、CodeLens、代码片段、中英双语 UI。

全部功能都是静态分析，**不需要启动 Godot**。

---

## 安装

### 从插件市场安装（推荐）

1. 打开 VS Code → **扩展**（`Ctrl+Shift+X`）
2. 搜索 **Godot Shader for VS Code** → **安装**
3. 或直接打开[插件市场页面](https://marketplace.visualstudio.com/items?itemName=fairyan.godot-shader-for-vscode)

### 从源码构建

```bash
git clone https://github.com/yanhuifair/Godot-Shader-For-VScode.git
cd Godot-Shader-For-VScode
npm install
npm run package          # 生成 godot-shader-for-vscode-<version>.vsix
```

然后在 VS Code 中：`Ctrl+Shift+P` → **Extensions: Install from VSIX…** → 选择生成的 `.vsix`。

> `.gdshader` 与 `.gdshaderinc` 会自动激活，无需额外配置。
> 打开任意着色器，状态栏会显示它的 `shader_type`；如果为空，说明文件没有被识别为 `godot-shader`
> （见[常见问题](#常见问题)）。

---

## 功能

### 补全

结合上下文，并按当前 `shader_type` 过滤。

```glsl
shader_type spatial;                    // ← spatial / canvas_item / sky / fog / particles（自动带分号）
render_mode blend_mix, cull_disabled;   // ← 只列出 spatial 可用的模式
uniform float strength : hint_range(    // ← hint（source_color、filter_linear …）
#                                       // ← 预处理器：#ifdef、#include、#define …
#include "                              // ← 工作区 .gdshaderinc 路径
COLOR.                                  // ← 分量（x y z w r g b a s t p q）
main_light.                             // ← struct 字段
group_uniforms Base;                    // ← 已有的检查组名
my_uniform                              // ← 自己的 uniform / 函数 / struct / 局部变量
```

补全列表还包含**文件内声明的所有符号**：uniform、varying、const、struct、函数（插入时带参数占位），
以及当前函数的局部变量与参数 —— 最后是来自 `#include` 文件的符号，并标注来源文件。

**工作区其它 `.gdshaderinc` 文件**里的符号同样会出现在补全中 —— 接受时自动插入对应的
`#include`（开关：`godot-shader.completion.autoImport`）。

**工作区其它 `.gdshaderinc` 文件**里的符号同样会出现在补全中 —— 接受时自动插入对应的
`#include`（开关：`godot-shader.completion.autoImport`）。

### 跨文件支持

`.gdshaderinc`（含传递 include）里声明的符号会在整个 include 图里解析：补全、悬停（标注来源文件）、
签名帮助、跳转定义、查找引用、重命名都能跨文件工作；循环 include 会终止，缺失的 include 会作为警告报出。

```glsl
// common.gdshaderinc
uniform vec4 shared_tint : source_color;

float ripple_at(vec2 p, float freq) {
    return sin(length(p - vec2(0.5)) * freq);
}
```

```glsl
// main.gdshader
#include "common.gdshaderinc"

void fragment() {
    COLOR = shared_tint * ripple_at(UV, 10.0);   // 两个符号都来自 include
}
```

`res://shaders/common.gdshaderinc` 与 `./common.gdshaderinc` 两种写法都支持
（`res://` 按工作区根目录解析）。

运行 **Godot Shader: 展开 #include**（`Ctrl+Alt+E`）可以把所有 include 就地展开成一份完整着色器，
只读虚拟文档，原文件不会被修改。

### 悬停

所有悬停统一版式：**标题** → **GLSL 声明代码块** → 事实行（`类型` / `种类` / `提示` / `角色` /
`适用范围`）→ 描述。

```glsl
sin(                                  // 悬停 → 签名代码块 + 返回值 + 示例
ALBEDO                                // 悬停 → vec3 ALBEDO | 角色：fragment() 输出 · light() 中只读
                                      //         适用：fog、**spatial**（当前类型加粗）
tint                                  // 悬停 → 声明原文、种类：Uniform、提示：source_color（带说明）
tint_sample(uv, amt)                  // 悬停 → 自己的签名、参数与上方注释
LightData                             // 悬停 → struct 结构、字段数与使用位置
main_light.direction                  // 悬停 → 按变量类型定位归属：vec3 dir | 所属结构体：Light
MAX_STEPS                             // 悬停 → #define 原文、展开值
#include "common.gdshaderinc"         // 悬停 → 解析后的路径、导出的符号数，或「文件不存在」
#ifdef                                // 悬停 → 该指令的作用
```

悬停里的代码块会用本扩展**自己的语法**高亮 —— fence 写的是 `godot-shader` 语言 id（不是 `glsl`，
VS Code 没有内置 GLSL 语言，写 `glsl` 会退化成纯文本）。注释与字符串里不会弹出符号说明。

### 签名帮助

内置函数（按实参个数自动切换重载）与自定义函数的参数提示 —— 包括写在 include 里的函数，
以及跨多行的调用。

```glsl
mix(█                                 // mix(vecX a, vecX b, float|vecX t)
vec3(0.5, 0.5, █                      // vec3(float, float, float) —— 自动选中重载
tint_sample(uv, █                     // vec4 tint_sample(vec2 uv, float amt)
```

### 内联提示

在实参前内联显示参数名，覆盖内置函数、自定义函数与跨行调用，可关闭。

```glsl
mix(x: color1, y: color2, t: 0.5)
my_func(n: 10, flag: true)
```

### CodeLens

在每个 `uniform` / `varying` / `const` 上方显示引用次数（不计注释与字符串中的同名文字）。

```glsl
uniform float strength;               // 3 references
```

### 诊断

**23 条规则**，全部跳过注释与字符串。未使用的声明与废弃函数显示删除线，重复声明会关联到首次声明的位置。

```glsl
shader_type spatial;                  // ✅ 有效
shader_type unknown;                  // ❌ 无效的 shader_type: unknown
render_mode invalid_mode;             // ❌ 'invalid_mode' 对 spatial 无效
uniform double value;                 // ❌ 无效类型 'double'（Godot 没有这种 uniform 类型）
// { " }                               // ✅ 注释/字符串中的大括号被忽略
#include "missing.gdshaderinc"        // ⚠️ 找不到被包含的文件
```

| 规则 | 示例 |
|------|------|
| `shader_type` 取值 | `shader_type unknown;` → 错误 |
| `shader_type` 位置 | 前面出现其他语句 → 警告 |
| 大括号匹配 | `void f() {` 缺 `}` → 缺少闭合大括号；多一个 `}` → 警告 |
| 分号 | `COLOR = vec3(1.0)` → 缺少 `;`（支持跨行表达式） |
| `#include` 目标 | 文件不存在 → 警告 |
| `render_mode` | `render_mode bad_mode;` → 对当前类型无效 |
| `stencil_mode` | `stencil_mode read;` 没有 alpha → 警告 |
| 声明类型 | `uniform double value;` → uniform 不支持的类型（struct 类型是合法的） |
| 声明语法 | `uniform vec3 broken_type my_var;` → 多了一个标识符 |
| uniform hint | `: not_a_hint` → 无效的 hint / flag |
| `const` 初始化 | `const float x;` → 必须初始化 |
| `varying` 类型 | `varying sampler2D x;` → 不能作为 varying |
| 重复声明 | 两个 `uniform float x;` → 重复 |
| 保留字 | `void main() {}` → `main` 是保留字 |
| 内置变量作用域 | `EYEDIR` 在 spatial 中 → 不可用 |
| 只读输入 | 在只读位置赋值，如 `light()` 里写 `ALBEDO` → 错误 |
| 内置函数可用性 | spatial 里写 `void sky()` → 错误 |
| 控制流 | `break` 在循环/switch 外 → 错误；`discard` 不在 fragment/light → 错误 |
| 数字格式 | `1.5.5` → 无效数字 |
| 类型不匹配 | `uint u = VERTEX_ID;`（int → uint）→ 错误 |
| 无效构造 | `vec2(vec3(1.0))` → 不能截断 |
| 废弃函数 | `atan2(x, y)` → 应使用 `atan(y, x)` |
| 未使用的声明 | `uniform float x;` 从未使用 → 提示（也会检查 include 文件） |
| 未使用的局部变量 | `float tmp = 1.0;` 从未使用 → 警告 |
| 性能（严格模式） | fragment 里的 `discard` → 提示；循环里 `texture()` → 警告 |

### 格式化

整篇与选区格式化，支持 switch/case、运算符空格、块注释保护，并保持文件行尾风格（CRLF 不会变成 LF）。

```glsl
// 格式化前
void fragment(){COLOR=vec3(1.0,0.5,0.2);}

// 格式化后（Shift+Alt+F）
void fragment() {
    COLOR = vec3(1.0, 0.5, 0.2);
}
```

大括号风格可配置 —— `"godot-shader.formatting.braceNewLine": false` 保持同行（默认），
`true` 则另起一行：

```glsl
// false（默认）                // true
void fragment() {               void fragment()
    COLOR = vec4(1.0);          {
}                                   COLOR = vec4(1.0);
                                }
```

预处理指令始终顶格；`case`/`default` 标签与三元运算符 `? :` 的空格也会被规范化。

**On-type 格式化** —— 开启 `editor.formatOnType` 后边输入边整理：
`}` 会对齐到匹配的 `{` 的缩进，`;` 会规范化所在行。

### 导航

| 动作 | 快捷键 | 说明 |
|------|--------|------|
| 转到定义 | `F12` | 变量/函数/struct 的声明，也能跳进 `.gdshaderinc`；参数跳回参数列表 |
| 查找引用 | `Shift+F12` | 所有使用位置；局部变量只在本函数，`#include` 符号跨文件搜索 |
| 重命名 | `F2` | 同时改所有出现位置，包括 include 文件里的声明 |
| 工作区符号 | `Ctrl+T` | 跨所有 `.gdshader` **与** `.gdshaderinc` 搜索 |
| 文档链接 | `Ctrl+点击` | `#include "common.gdshaderinc"` → 打开文件 |
| 选择范围 | `Alt+Shift+→` | `单词` → `行` → `{ 块 }` → `void f() {…}` → 全文 |
| 调用层次 | `Shift+Alt+H` | 谁调用了当前函数、它又调用了谁（搜索当前 include 图） |
| 类型定义 | — | 变量或字段 → 它所属的 `struct`（跨 include 也可） |
| 转到声明 | — | 来自 include 的符号 → 引入它的那条 `#include` |
| 联动编辑 | — | 改一处，同作用域内所有同名位置一起改 |
| 内联补全 | — | `#include` 路径、`shader_type` 取值、`group_uniforms` 名称的灰字提示 |
| 大纲 | 侧栏 | struct（含字段）、uniform、varying、函数 |

其它快捷键：`Ctrl+Space` 触发补全 · `Shift+Alt+F` 格式化文档 · `Ctrl+.` 快速修复 ·
`Alt+Shift+→` 扩展选区。

### 调用层次

把光标放在函数上按 `Shift+Alt+H`（或右键 → *Show Call Hierarchy*）。
「被谁调用」会在当前文件**以及它 include 的所有文件**里搜索，
因此声明在 `.gdshaderinc` 里的辅助函数两侧都能看到。

```glsl
float ripple(vec2 p) { … }            // ← 被调用 2 次
float wave(vec2 uv) { return ripple(uv) * 2.0; }   // 调用 ripple
void fragment() { COLOR = vec4(wave(UV)); }        // 调用 wave
```

### 命令

| 命令 | 快捷键 | 作用 |
|------|--------|------|
| `Godot Shader: 展开 #include` | `Ctrl+Alt+E` | 生成所有 include 已展开的只读预览 |
| `Godot Shader: 切换 shader_type` | — | 快速选择并替换（或插入）`shader_type` |
| `Godot Shader: 插入着色器模板` | — | 按所选类型插入最简模板 |
| `Godot Shader: 显示输出面板` | — | include / 命令日志（点状态栏也会打开） |
| `Godot Shader: 重建符号缓存` | — | 清空 include 与工作区符号缓存 |
| `Godot Shader: 刷新着色器视图` | — | 刷新侧栏（视图标题栏也有按钮） |

前三个命令同时出现在编辑器右键菜单里。

### 粘贴与拖拽

粘贴的代码用到了 `common.gdshaderinc` 里的 `ripple_at()` 时，会出现
**「粘贴并添加 1 个 #include」** —— 接受后文本与 include 行一次性写入（一次撤销即可回退）。
把 `.gdshaderinc` 拖进编辑器，`#include` 会插在落点处。已经能访问到的文件不会重复提示。
开关：`godot-shader.paste.autoInclude`。

### 侧边栏

活动栏里的 **Godot Shader** 视图分三段：

| 分区 | 内容 |
|---|---|
| 参数与变量 | 按 `group_uniforms` 分组，点击跳到声明 |
| 包含文件 | 当前文件的 include 图，缺失的文件标 ⚠ |
| 工作区着色器 | 所有 `.gdshader`，附 `shader_type` |

资源管理器里也有装饰：错误/警告数量角标，被当前着色器 include 的文件显示 `↳`。

### 对话：`@shader`

```
@shader /expand        展开所有 include 的完整源码
@shader /uniforms      带类型与 hint 的参数表
@shader /diagnostics   当前诊断
@shader /docs TIME     内置变量 / 函数 / 关键字 / hint 的说明
```

斜杠命令是确定性的、不需要模型；自由提问会转给对话里选中的语言模型（如果有）。

### 视觉特性

**语义高亮** —— 在 TextMate 语法之上细分为 7 类
（关键字 · 类型 · 变量 · 属性 · 函数 · 参数 · 修饰符）：

```glsl
shader_type spatial;                      // 关键字 | 类型
render_mode blend_mix, disable_force;     // 关键字 | 修饰符 | 修饰符
uniform sampler3D volume : filter_linear; // 关键字 | 类型 | 变量 | 修饰符
struct Light { vec3 dir; };               // 关键字 | 类型 | 类型 | 属性
float f(float gain) { return gain; }      // 类型 | 函数 | 参数 | 关键字
ALBEDO = COLOR.rgb * f(1.0);              // 属性 | 属性.分量 | 函数 | 数字
```

**`#if 0` 变灰** —— 只淡化被禁用的那一支，`#else` / `#elif` 分支保持正常着色：

```glsl
#if 0
vec3 disabled = vec3(1.0, 0.0, 0.0);   // 变灰
#else
ALBEDO = vec3(1.0);                    // 正常着色
#endif
```

**代码折叠** —— 函数/struct 块、连续 `//` 注释块、跨行 `/* */`、`#if… #endif`。

**取色器** —— 点击颜色字面量：

```glsl
vec3 sky = vec3(0.3, 0.5, 1.0);      // 点 vec3 → 取色器
vec4 col = vec4(1.0, 0.5, 0.2, 1.0); // 点 vec4 → 取色器
#define BG_COLOR #478cbf             // 点十六进制 → 取色器
```

**状态栏** —— 显示当前文件的 `shader_type`。

### 快速修复

在诊断上按 `Ctrl+.`：

```glsl
vec3 col = vec3(1.0)          // 快速修复：补 ;
render_mode unshaded;         // 快速修复：补 shader_type canvas_item;
void fragment() { …          // 快速修复：补上缺少的 }
}                             // 快速修复：删除多余的 }
uniform float unused;         // 快速修复：删除未使用的声明
atan2(1.0, 2.0)               // 快速修复：改为 atan
#include "missing.gdshaderinc" // 快速修复：创建缺失的 include 文件
```

所有可自动修复的诊断也可以一次修完：**Source Action… → Fix All**，或设置
`"editor.codeActionsOnSave": { "source.fixAll": "explicit" }`。

**Source Action… → Organize Includes** 会对连续的 `#include` 块排序并去重。

### 代码片段

共 65 个，按前缀分组（输入前缀后按 `Tab`）：

| 前缀 | 插入内容 |
|------|----------|
| `shader-{canvas,spatial,sky,fog,particles}` | 最简着色器模板 |
| `shader-{canvas,spatial}-full` | 含全部段落的模板 |
| `func-{vertex,fragment,light}`、`sky-func`、`fog-func` | 入口函数骨架 |
| `uniform`、`uniform-{range,color,texture,filter}` | uniform 声明 |
| `varying`、`struct` | varying / struct 块 |
| `if`、`ifelse`、`for`、`while` | 控制流 |
| `ctor-{vec2,vec3,vec4,mat4}` | 构造函数 |
| `sample-texture`、`sample-texturelod` | 纹理采样 |
| `builtin-{time,vertex,tangent,binormal,uv,uv2,screen-uv}` | 内置变量引用 |
| `set-{color,albedo,alpha,metallic,roughness,emission,normal-map,normal-depth}` | 输出赋值 |
| `set-normal`、`builtin-*` | 内置值引用 |
| `alpha-scissor` | `ALPHA_SCISSOR_THRESHOLD` |
| `anim-{vertex,uv}` | 顶点/UV 动画 |
| `math-{lerp,clamp,smoothstep,normalize,dot,cross,length,distance}` | 数学函数 |
| `fresnel`、`hemi-light`、`phong` | 光照片段 |
| `comment`、`todo`、`fixme` | 注释块 |
| `ifdef`、`ifndef`、`define` | 预处理器（会一并插入 `#endif`） |

---

## 配置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `godot-shader.general.language` | `en` | 界面语言：`en` / `zh` |
| `godot-shader.diagnostics.checkBuiltinScope` | `true` | 校验内置变量在各着色器类型中的可用性 |
| `godot-shader.diagnostics.strictMode` | `false` | 额外的性能警告（`discard`、循环内 `texture()`） |
| `godot-shader.formatting.braceNewLine` | `false` | `{` 是否另起一行 |
| `godot-shader.completion.autoImport` | `true` | 补全其它 `.gdshaderinc` 里的符号并自动插入 `#include` |
| `godot-shader.paste.autoInclude` | `true` | 粘贴引用外部符号的代码时提示补 `#include` |
| `godot-shader.inlineCompletions.enabled` | `true` | include 路径、`shader_type`、分组的灰字补全 |
| `godot-shader.inlayHints.showParameterNames` | `true` | 是否显示参数名内联提示 |
| `godot-shader.colorPicker.enabled` | `true` | 是否为颜色字面量显示取色器 |
| `godot-shader.trace.includeResolution` | `false` | 在输出面板打印 `#include` 解析过程 |

---

## 环境要求

- **VS Code 1.100** 及以上（用到了稳定的粘贴/拖拽编辑、内联补全与对话 API）
- Godot **4.x** 的着色器语法（`shader_type` 风格，`.gdshader` / `.gdshaderinc`）
- 不需要安装 Godot、不需要构建、不常驻后台 —— 纯静态分析

---

## 已知限制

- **诊断是启发式的**：采用针对性解析而非完整 GLSL 编译器，速度快、不受注释干扰，但可能漏掉非常规写法
  （不会阻塞保存）。
- **`#include` 按文本解析**：所有 `#include` 行都会被跟进，构建符号表时不求值条件编译（`#if`）。
- **重命名共享 include 里的符号会改写该文件**，因此其它 include 它的着色器同样受影响 —— 这是
  `#include` 的语义，插件无法只改一处。
- **`#if 0` 变灰只认字面量**：仅识别 `#if 0` / `#if false`，`#ifdef 未定义宏` 不变灰；
  禁用块内若还有嵌套 `#endif`，变灰会提前结束。
- **调用层次只搜当前 include 图**：不会扫描工作区所有 `.gdshader`，
  无关文件里的调用不会列出。
- **取色器**只识别 `vec3(r, g, b)`、`vec4(r, g, b, a)` 与 `#RRGGBB` / `#RRGGBBAA` 字面量，
  不识别 `vec4(vec3, a)` 或单值 `vec3(x)`。
- **联动编辑与重命名的范围不同**：声明在 include 里的符号，F2 重命名仍会改到 include 文件，
  但联动编辑只跟随当前文件。
- **类型层次表达的是组合关系，不是继承** —— 着色器没有继承，"父类型"指把当前 struct 当字段使用的结构体。
- **不做着色器预览/编译**，渲染以 Godot 为准。

---

## 常见问题

**没有任何高亮 / 插件好像没生效。**
插件只对 `.gdshader` 与 `.gdshaderinc` 生效。看状态栏的语言标识，必要时用
*Change Language Mode → Godot Shader* 手动切换。

**`#include` 报「找不到被包含的文件」。**
把 Godot 项目根目录（含 `project.godot` 的那一层）作为工作区根打开，`res://` 才能解析；
或改用相对当前文件的路径。

**重命名把 `.gdshaderinc` 也改了。**
这是预期行为：符号就声明在那里。见[已知限制](#已知限制)。

**代码片段打不出来。**
输入前缀后按 `Tab`，并确认 *Editor › Suggest: Snippets* 已开启。

**格式化把我大括号挪位置了。**
由 `godot-shader.formatting.braceNewLine` 控制（默认同行）。

**输入 `}` 或 `;` 没有自动整理。**
on-type 格式化跟随 `editor.formatOnType` 设置，开启即可（或直接按格式化文档）。

**能一次性应用所有快速修复吗？**
可以：*Source Action… → Fix All*，或加 `"editor.codeActionsOnSave": { "source.fixAll": "explicit" }`。

**怎么切换界面语言？**
`godot-shader.general.language`：`en` 或 `zh`，诊断信息跟随同一语言。

---

## 开发

```bash
npm install
npm run compile      # tsc → out/
npm run package      # 升版本 + 编译 + 生成 .vsix
```

```text
src/
  extension.ts            # 激活、注册所有 Provider、状态栏
  shader-data.ts          # 162 内置符号、121 函数、23 类型、28 关键字、hint、render_mode
  symbol-index.ts         # 单文档符号索引（uniform/局部/函数/struct），按版本缓存
  include-graph.ts        # #include 图 → 跨文件符号表（防循环）
  i18n.ts                 # 中英文案
  en-descriptions.ts      # 345 条英文描述
  utils.ts                # 注释/字符串屏蔽、声明与作用域解析
  features/
    completion.ts         # 上下文补全、用户符号、分量、struct 字段
    hover.ts              # 内置 + 用户 + 跨文件悬停
    diagnostics.ts        # 23 条规则
    formatting.ts         # 整篇/选区格式化
    signature-help.ts     # 内置重载 + 用户/跨文件函数
    code-actions.ts       # 快速修复（分号、shader_type、大括号）
    folding.ts            # 代码块、注释块、#if 区段
    semantic-tokens.ts    # 语义高亮 + #if 0 处理
    definition.ts         # 跳转定义（本地 → include 图）
    references.ts         # 查找引用（作用域 & include 感知）
    rename.ts             # 重命名（作用域 & include 感知）
    highlight.ts          # 同名高亮（读/写）
    color-picker.ts       # vec3 / vec4 / 十六进制
    workspace-symbols.ts  # 工作区符号（带缓存）
    symbol-provider.ts    # 大纲与面包屑
    inlay-hints.ts        # 参数名提示（支持跨行）
    code-lens.ts          # 引用计数
    document-links.ts     # 可点击的 #include
    selection-range.ts    # 智能选择扩展
syntaxes/
  godot-shader.tmLanguage.json
snippets/
  godot-shader.json
```

欢迎提 Issue 或 PR。

---

## 许可证

AGPL-3.0 © [Fair Yan](https://github.com/yanhuifair)

---

## 支持作者

<div align="left">
  <img alt="Appreciate" src="images/appreciate.JPG" width="300" />
</div>

## Star History

<a href="https://www.star-history.com/?repos=yanhuifair%2FGodot-Shader-For-VScode&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=yanhuifair/Godot-Shader-For-VScode&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=yanhuifair/Godot-Shader-For-VScode&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=yanhuifair/Godot-Shader-For-VScode&type=date&legend=top-left" />
 </picture>
</a>
