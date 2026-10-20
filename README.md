<!-- Copyright (c) 2026 Fair -->
<!-- SPDX-License-Identifier: AGPL-3.0 -->
<!-- markdownlint-disable MD033 MD041 MD013 -->
<div align="center">

![VS Code](https://img.shields.io/badge/VS%20Code-1.100%2B-007ACC?logo=visualstudiocode&logoColor=white)
![Godot](https://img.shields.io/badge/Godot-4.x-478CBF?logo=godotengine&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.116-2ea44f)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Stars](https://img.shields.io/github/stars/yanhuifair/Godot-Shader-For-VScode?style=flat-square)
[![Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-Install-blue?logo=visualstudio)](https://marketplace.visualstudio.com/items?itemName=fairyan.godot-shader-for-vscode)

</div>

<p align="center">
  <img alt="logo" src="images/logo.png" width="128" />
</p>

# Godot Shader for VS Code

> 🌐 [简体中文](./README-zh.md)

Full language support for Godot 4 shaders — **28 language providers**, **162 built-in symbols**,
**121 functions**, **65 snippets**, **23 diagnostic rules**, **cross-file resolution** through
`#include`, fully bilingual (zh / en).

**Repository:** <https://github.com/yanhuifair/Godot-Shader-For-VScode>
**Marketplace:** <https://marketplace.visualstudio.com/items?itemName=fairyan.godot-shader-for-vscode>

[Highlights](#highlights) · [Install](#install) · [Completion](#completion) · [Cross-file](#cross-file-support) · [Hover](#hover) · [Signature help](#signature-help) · [Inlay hints](#inlay-hints) · [CodeLens](#codelens) · [Diagnostics](#diagnostics) · [Formatting](#formatting) · [Navigation](#navigation) · [Call hierarchy](#call-hierarchy) · [Commands](#commands) · [Visual](#visual-features) · [Quick fixes](#quick-fixes) · [Snippets](#snippets) · [Configuration](#configuration) · [Requirements](#requirements) · [Limitations](#known-limitations) · [FAQ](#faq) · [Development](#development)

---

## Highlights

- **Your own symbols are first-class** — completion, hover, signature help, go-to-definition,
  references and rename understand uniforms, functions, structs and locals you declare, not just
  the built-ins.
- **Cross-file by default** — symbols from `#include`d `.gdshaderinc` files (including transitive
  includes) resolve everywhere; renames also fix the declaration inside the included file.
- **Auto-import** — symbols declared in other `.gdshaderinc` files of the workspace are completed
  too, and the matching `#include` is inserted for you.
- **One command away** — expand every include into a read-only preview, switch `shader_type`,
  insert a template, reload symbol caches (command palette, context menu, `Ctrl+Alt+E`).
- **Editing niceties** — on-type formatting (auto-align `}`, normalize `;`), Fix All for
  auto-fixable diagnostics, and a call hierarchy that walks helper functions across includes.
- **Comment- and string-aware diagnostics** — 23 rules that never fire on text inside comments,
  strings or `#if 0` blocks.
- **Real formatting** — switch/case indentation, operator spacing, brace style, CRLF preservation.
- **Include on paste & drop** — paste code that uses symbols from another `.gdshaderinc` and
  the `#include` is written for you; drop a file into the editor and the include line appears.
- **Type-aware navigation** — type definition (variable → its `struct`), go-to-declaration
  (jumps to the `#include` that brings a symbol in), struct composition hierarchy, linked editing.
- **A real sidebar** — uniforms grouped by `group_uniforms`, the include graph with missing files
  flagged, and every shader in the workspace.
- **Ask `@shader`** — chat participant for `/expand`, `/uniforms`, `/diagnostics` and `/docs`
  (`/expand` & co. work without a language model).
- **Works everywhere** — unsaved buffers, Remote-SSH, WSL, dev containers and virtual file systems.
- **Everything else** — semantic highlighting, folding, color picker, quick fixes, code lens,
  snippets, bilingual UI.

Nothing here requires Godot to be running: the extension is pure static analysis.

---

## Install

### From the Marketplace (recommended)

1. Open VS Code → **Extensions** (`Ctrl+Shift+X`)
2. Search **Godot Shader for VS Code** → **Install**
3. Or open the [marketplace page](https://marketplace.visualstudio.com/items?itemName=fairyan.godot-shader-for-vscode) directly

### From source

```bash
git clone https://github.com/yanhuifair/Godot-Shader-For-VScode.git
cd Godot-Shader-For-VScode
npm install
npm run package          # builds godot-shader-for-vscode-<version>.vsix
```

Then `Ctrl+Shift+P` → **Extensions: Install from VSIX…** → pick the generated `.vsix`.

> `.gdshader` and `.gdshaderinc` are picked up automatically — no configuration required.
> Open any shader and the status bar shows its `shader_type`; if it stays empty, the file was not
> recognized as `godot-shader` (see [FAQ](#faq)).

---

## Features

### Completion

Context-aware and filtered by the current `shader_type`.

```glsl
shader_type spatial;                    // ← spatial / canvas_item / sky / fog / particles (+ auto `;`)
render_mode blend_mix, cull_disabled;   // ← only modes valid for spatial
uniform float strength : hint_range(    // ← hints (source_color, filter_linear, …)
#                                       // ← preprocessor: #ifdef, #include, #define, …
#include "                              // ← workspace .gdshaderinc paths
COLOR.                                  // ← swizzles (x y z w r g b a s t p q)
main_light.                             // ← struct fields
group_uniforms Base;                    // ← existing inspector group names
my_uniform                              // ← your own uniforms / functions / structs / locals
```

The list also contains **every symbol declared in the file**: uniforms, varyings, constants,
structs, functions (inserted with parameter placeholders) and the locals/parameters of the function
you are typing in — followed by the symbols coming from `#include`d files, tagged with their source.

Symbols declared in **other `.gdshaderinc` files of the workspace** are offered as well — accepting
one inserts the matching `#include` for you (toggle: `godot-shader.completion.autoImport`).

### Cross-file Support

Symbols declared in `.gdshaderinc` files — including transitive includes — are resolved across the
whole include graph. Completion, hover (naming the source file), signature help, go-to-definition,
find-references and rename all work through `#include`. Include cycles are detected, and missing
includes are reported as warnings.

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
    COLOR = shared_tint * ripple_at(UV, 10.0);   // both symbols come from the include
}
```

Both `res://shaders/common.gdshaderinc` and `./common.gdshaderinc` forms are supported
(`res://` is resolved against the workspace root).

Run **Godot Shader: Expand #include** (`Ctrl+Alt+E`) to read the whole shader with every include
expanded inline — a read-only virtual document, the original files stay untouched.

### Hover

Type, description, available shader types, return ranges and usage examples — plus everything you
declared yourself.

```glsl
sin(                                  // hover → Signature: sin(float x)
dot(normal, light_dir)                // hover → Returns: scalar | Example: dot(normal, light_dir)
COLOR                                 // hover → Type: vec4 | Available in: canvas_item, spatial
tint_sample(uv, amt)                  // hover → your signature, parameters and the comment above it
tint                                  // hover → uniform vec4 tint | Hint: source_color | Editable in the Inspector
LightData                             // hover → struct fields and where it is used
main_light.direction                  // hover → field type
group_uniforms                        // hover → keyword documentation
```

### Signature Help

Parameter hints for built-ins (overloads selected by argument count) and for functions you define —
including functions that live in an included file and calls spread over several lines.

```glsl
mix(█                                 // mix(vecX a, vecX b, float|vecX t)
vec3(0.5, 0.5, █                      // vec3(float, float, float) — overload resolved automatically
tint_sample(uv, █                     // vec4 tint_sample(vec2 uv, float amt)
```

### Inlay Hints

Parameter names inline, for built-ins, your own functions and multi-line calls. Can be turned off.

```glsl
mix(x: color1, y: color2, t: 0.5)
my_func(n: 10, flag: true)
```

### CodeLens

Reference counts above every `uniform` / `varying` / `const` (comments and strings are not counted).

```glsl
uniform float strength;               // 3 references
```

### Diagnostics

**23 rules**, all comment/string aware. Unused declarations and deprecated functions are struck through; duplicate declarations link to the first one.

```glsl
shader_type spatial;                  // ✅ valid
shader_type unknown;                  // ❌ Invalid shader_type: unknown
render_mode invalid_mode;             // ❌ 'invalid_mode' is invalid for spatial
uniform double value;                 // ❌ Invalid type 'double' (not a Godot uniform type)
// { " }                               // ✅ braces in comments/strings ignored
#include "missing.gdshaderinc"        // ⚠️ Included file not found
```

| Rule | Example |
|------|---------|
| `shader_type` value | `shader_type unknown;` → error |
| `shader_type` position | Any statement before `shader_type` → warning |
| Brace matching | `void f() {` without `}` → missing closing brace / extra `}` → warning |
| Semicolon | `COLOR = vec3(1.0)` → missing `;` (multi-line expressions understood) |
| `#include` target | File not found → warning |
| `render_mode` | `render_mode bad_mode;` → invalid for the current type |
| `stencil_mode` | `stencil_mode read;` without alpha → warning |
| Declaration types | `uniform double value;` → invalid type for uniforms (struct types are allowed) |
| Declaration syntax | `uniform vec3 broken_type my_var;` → extra identifier |
| Uniform hints | `: not_a_hint` → invalid hint / flag |
| `const` init | `const float x;` → must be initialized |
| `varying` type | `varying sampler2D x;` → invalid varying type |
| Duplicate declarations | Two `uniform float x;` → duplicate |
| Reserved words | `void main() {}` → `main` is reserved |
| Built-in scope | `EYEDIR` in spatial → not available |
| Read-only inputs | Writing an input where it is read-only, e.g. `ALBEDO` in `light()` → error |
| Built-in function availability | `void sky()` in spatial → error |
| Control flow | `break` outside loop/switch → error; `discard` outside fragment/light → error |
| Number format | `1.5.5` → invalid number |
| Type mismatch | `uint u = VERTEX_ID;` (int → uint) → error |
| Invalid constructors | `vec2(vec3(1.0))` → cannot truncate |
| Deprecated functions | `atan2(x, y)` → use `atan(y, x)` |
| Unused declarations | `uniform float x;` never used → hint (also checks included files) |
| Unused locals | `float tmp = 1.0;` never used → warning |
| Performance (strict mode) | `discard` in fragment → info; `texture()` inside a loop → warning |

### Formatting

Full-document and range formatting with switch/case, operator spacing and block-comment protection.
Line endings are preserved (CRLF stays CRLF).

```glsl
// Before
void fragment(){COLOR=vec3(1.0,0.5,0.2);}

// After (Shift+Alt+F)
void fragment() {
    COLOR = vec3(1.0, 0.5, 0.2);
}
```

Configurable brace style — `"godot-shader.formatting.braceNewLine": false` keeps the brace on the
same line (default), `true` puts it on its own line:

```glsl
// false (default)              // true
void fragment() {               void fragment()
    COLOR = vec4(1.0);          {
}                                   COLOR = vec4(1.0);
                                }
```

Preprocessor directives always stay at column 0, and `case`/`default` labels plus ternary
`? :` spacing are normalized.

**On-type formatting** — enable `editor.formatOnType` and the formatter tidies as you type:
`}` snaps to the indentation of its opening brace, `;` normalizes the line it ends.


### Navigation

| Action | Shortcut | What it does |
|--------|----------|--------------|
| Go to Definition | `F12` | Declaration of a variable/function/struct — also inside `.gdshaderinc`; parameters jump to the parameter list |
| Find References | `Shift+F12` | All usages; locals are scoped to their function, `#include` symbols are searched across files |
| Rename | `F2` | Renames every occurrence, including the declaration inside the included file |
| Workspace Symbols | `Ctrl+T` | Uniforms/varyings/functions across all `.gdshader` **and** `.gdshaderinc` files |
| Document Links | `Ctrl+Click` | `#include "common.gdshaderinc"` → opens the file |
| Selection Range | `Alt+Shift+→` | `word` → `line` → `{ block }` → `void f() {…}` → full document |
| Call Hierarchy | `Shift+Alt+H` | Who calls this function and what it calls (searches the current include graph) |
| Type Definition | — | Variable or field → the `struct` it is typed with (through includes too) |
| Go to Declaration | — | Symbol coming from an include → the `#include` line that brings it in |
| Linked Editing | — | Type once, every occurrence in the same scope follows |
| Inline suggestion | — | Ghost text for `#include` paths, `shader_type` values and `group_uniforms` names |
| Outline | Sidebar | Structs (with fields), uniforms, varyings, functions |

Other shortcuts: `Ctrl+Space` completion · `Shift+Alt+F` format document · `Ctrl+.` quick fix ·
`Alt+Shift+→` expand selection.

### Call Hierarchy

Put the cursor on a function and press `Shift+Alt+H` (or right-click → *Show Call Hierarchy*).
Incoming calls are searched in the current file **and** every file it includes, so helper
functions declared in `.gdshaderinc` show up on both sides.

```glsl
float ripple(vec2 p) { … }            // ← 2 incoming calls
float wave(vec2 uv) { return ripple(uv) * 2.0; }   // calls ripple
void fragment() { COLOR = vec4(wave(UV)); }        // calls wave
```

### Commands

| Command | Shortcut | What it does |
|---------|----------|--------------|
| `Godot Shader: Expand #include` | `Ctrl+Alt+E` | Read-only preview with all includes expanded |
| `Godot Shader: Switch shader_type` | — | Quick pick to replace (or insert) `shader_type` |
| `Godot Shader: Insert Shader Template` | — | Insert a minimal template for the picked type |
| `Godot Shader: Show Output Panel` | — | Include/command log — also opens when clicking the status bar |
| `Godot Shader: Reload Symbol Caches` | — | Drop include & workspace symbol caches |
| `Godot Shader: Refresh Shader View` | — | Refresh the sidebar (also a button in its title bar) |

The first three also appear in the editor context menu.

### Include on Paste & Drop

Paste a block that references `ripple_at()` from `common.gdshaderinc` and VS Code offers
**“Paste and add 1 #include”** — accepting it inserts the text *and* the include line in one undo step.
Drag a `.gdshaderinc` into the editor and the matching `#include` is inserted at the drop point.
Symbols that are already reachable are never suggested twice.
Toggle: `godot-shader.paste.autoInclude`.

### Sidebar

The **Godot Shader** view in the activity bar has three sections:

| Section | Content |
|---|---|
| Uniforms & Varyings | Grouped by `group_uniforms`; click to jump to the declaration |
| Includes | The include graph of the current file, missing files flagged with ⚠ |
| Workspace Shaders | Every `.gdshader` with its `shader_type` |

The explorer also decorates files: error/warning count as a badge, and `↳` on files the current
shader includes.

### Chat: `@shader`

```
@shader /expand        the shader with every include expanded
@shader /uniforms      uniform table with types and hints
@shader /diagnostics   current diagnostics
@shader /docs TIME     documentation for a built-in variable, function, keyword or hint
```

The slash commands are deterministic and need no model; a free-form question is forwarded to the
language model you pick in the chat view (if any).

### Visual Features

**Semantic highlighting** — every token class gets its own color:

```glsl
uniform float strength;     // keyword  | type  | variable name
COLOR = vec3(1.0, 0.5, 0.2); // built-in | type | number | number | number
void fragment() { … }       // keyword  | function name
```

**`#if 0` dimming** — disabled blocks are scoped as comments, so they fade out:

```glsl
#if 0
// Everything here is dimmed
vec3 disabled_color = vec3(1.0, 0.0, 0.0);
#endif
```

**Folding** — function/struct bodies, consecutive `//` blocks, multi-line `/* */` and `#if… #endif`.

**Color picker** — click a literal color:

```glsl
vec3 sky = vec3(0.3, 0.5, 1.0);      // click the vec3 → color picker
vec4 col = vec4(1.0, 0.5, 0.2, 1.0); // click the vec4 → color picker
#define BG_COLOR #478cbf             // click the hex → color picker
```

**Status bar** — shows the `shader_type` of the current file.

### Quick Fixes

`Ctrl+.` on a diagnostic:

```glsl
vec3 col = vec3(1.0)          // Quick Fix: add ;
render_mode unshaded;         // Quick Fix: add shader_type canvas_item;
void fragment() { …          // Quick Fix: add missing }
}                             // Quick Fix: remove stray }
uniform float unused;         // Quick Fix: remove unused declaration
atan2(1.0, 2.0)               // Quick Fix: change to atan
#include "missing.gdshaderinc" // Quick Fix: create missing include file
```

Every fixable diagnostic can also be applied in one go: run **Source Action… → Fix All** or set
`"editor.codeActionsOnSave": { "source.fixAll": "explicit" }`.

**Source Action… → Organize Includes** sorts and de-duplicates a contiguous `#include` block.

### Snippets

65 snippets, grouped by prefix (type the prefix, press `Tab`):

| Prefix | Inserts |
|--------|---------|
| `shader-{canvas,spatial,sky,fog,particles}` | Minimal shader template |

| `shader-{canvas,spatial}-full` | Template with every section |
| `func-{vertex,fragment,light}`, `sky-func`, `fog-func` | Entry function stubs |
| `uniform`, `uniform-{range,color,texture,filter}` | Uniform declarations |
| `varying`, `struct` | varying / struct block |
| `if`, `ifelse`, `for`, `while` | Control flow |
| `ctor-{vec2,vec3,vec4,mat4}` | Constructors |
| `sample-texture`, `sample-texturelod` | Texture sampling |
| `builtin-{time,vertex,tangent,binormal,uv,uv2,screen-uv}` | Built-in variable references |
| `set-{color,albedo,alpha,metallic,roughness,emission,normal-map,normal-depth}` | Output assignments |
| `set-normal`, `builtin-*` | Built-in value references |
| `alpha-scissor` | `ALPHA_SCISSOR_THRESHOLD` |
| `anim-{vertex,uv}` | Vertex/UV animation |
| `math-{lerp,clamp,smoothstep,normalize,dot,cross,length,distance}` | Math helpers |
| `fresnel`, `hemi-light`, `phong` | Lighting snippets |
| `comment`, `todo`, `fixme` | Comment blocks |
| `ifdef`, `ifndef`, `define` | Preprocessor (inserts `#endif` too) |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `godot-shader.general.language` | `en` | UI language: `en` or `zh` |
| `godot-shader.diagnostics.checkBuiltinScope` | `true` | Validate built-in variable scope per shader type |
| `godot-shader.diagnostics.strictMode` | `false` | Extra performance warnings (`discard`, `texture()` in loops) |
| `godot-shader.formatting.braceNewLine` | `false` | Put `{` on its own line |
| `godot-shader.completion.autoImport` | `true` | Complete symbols from other `.gdshaderinc` files and insert the `#include` |
| `godot-shader.paste.autoInclude` | `true` | Offer `#include` when pasting code that uses external symbols |
| `godot-shader.inlineCompletions.enabled` | `true` | Ghost-text completion for include paths, `shader_type`, groups |
| `godot-shader.inlayHints.showParameterNames` | `true` | Show inline parameter name hints |
| `godot-shader.colorPicker.enabled` | `true` | Show the color picker for color literals |
| `godot-shader.trace.includeResolution` | `false` | Log `#include` resolution to the output panel |

---

## Requirements

- **VS Code 1.100** or newer (the extension uses the stable paste/drop-edit, inline-completion
  and chat APIs)
- Godot **4.x** shader language (`shader_type`-style, `.gdshader` / `.gdshaderinc`)
- No Godot installation, no build step, no background service — the extension is static analysis only

---

## Known Limitations

- **Diagnostics are heuristic.** They use targeted parsing rather than a full GLSL compiler: fast and
  comment-safe, but they can miss unusual constructs (and never block saving).
- **`#include` is resolved textually.** Every `#include` line is followed; conditional compilation
  (`#if`) is not evaluated when building the symbol graph.
- **Renaming a shared include symbol rewrites the include file**, so other shaders that include it are
  affected too — that is how `#include` works, not something the extension can scope down.
- **`#if 0` dimming is block-level**: a nested `#endif` inside a disabled block ends the dimming early.
- **Call hierarchy is scoped to the current include graph** — it does not scan every `.gdshader`
  in the workspace, so callers in unrelated files are not listed.
- **Color picker** understands `vec3(r, g, b)`, `vec4(r, g, b, a)` and `#RRGGBB` / `#RRGGBBAA`
  literals only — not `vec4(vec3, a)` or single-value `vec3(x)`.
- **Linked editing and rename stop at the file boundary** for symbols declared in an include —
  rename (F2) still updates the include file, but live linked editing only follows the current file.
- **Type hierarchy models composition, not inheritance** — shaders have no inheritance, so
  “supertypes” are the structs that embed the current one.
- **No shader preview or compilation.** Godot stays the source of truth for rendering.

---

## FAQ

**Nothing highlights / the extension seems inactive.**
It only activates for `.gdshader` and `.gdshaderinc`. Check the language indicator in the status bar;
if needed use *Change Language Mode → Godot Shader*.

**`#include` is reported as "file not found".**
Open the Godot project folder (the one containing `project.godot`) as the workspace root so `res://`
can be resolved, or use a path relative to the current file.

**Renaming changed my `.gdshaderinc`.**
Expected: the symbol is declared there. See [Known Limitations](#known-limitations).

**Snippets do not expand.**
Type the prefix and press `Tab`; make sure *Editor › Suggest: Snippets* is enabled.

**My braces moved to a new line.**
That is `godot-shader.formatting.braceNewLine` (or your `files.eol` / editor settings).

**Nothing happens when I type `}` or `;`.**
On-type formatting follows the `editor.formatOnType` setting — enable it (or run *Format Document*).

**Can I apply all quick fixes at once?**
Yes: *Source Action… → Fix All*, or add `"editor.codeActionsOnSave": { "source.fixAll": "explicit" }`.

**How do I switch the UI language?**
`godot-shader.general.language`: `en` or `zh`. Diagnostics use the same language.

---

## Development

```bash
npm install
npm run compile      # tsc → out/
npm run package      # bump version + compile + build .vsix
```

```text
src/
  extension.ts            # activation, provider registration, status bar
  shader-data.ts          # 162 built-ins, 121 functions, 23 types, 28 keywords, hints, render modes
  symbol-index.ts         # per-document symbol index (uniforms/locals/functions/structs), version-cached
  include-graph.ts        # #include graph → cross-file symbol table (cycle-safe)
  i18n.ts                 # bilingual strings (zh / en)
  en-descriptions.ts      # 345 English descriptions
  utils.ts                # masking (comments/strings), declaration & scope parsing
  features/
    completion.ts         # context-aware completion, user symbols, swizzles, struct fields
    hover.ts              # built-in + user + cross-file hover
    diagnostics.ts        # 23 rules
    formatting.ts         # document & range formatting
    signature-help.ts     # built-in overloads + user & cross-file functions
    code-actions.ts       # quick fixes (;, shader_type, braces)
    folding.ts            # blocks, comment blocks, #if regions
    semantic-tokens.ts    # semantic highlighting + #if 0 handling
    definition.ts         # go-to-definition (local → include graph)
    references.ts         # find references (scope & include aware)
    rename.ts             # rename (scope & include aware)
    highlight.ts          # occurrence highlight (read/write)
    color-picker.ts       # vec3 / vec4 / hex literals
    workspace-symbols.ts  # workspace-wide symbols (cached)
    symbol-provider.ts    # outline & breadcrumbs
    inlay-hints.ts        # parameter-name hints (multi-line aware)
    code-lens.ts          # reference counts
    document-links.ts     # clickable #include
    selection-range.ts    # smart selection expansion
syntaxes/
  godot-shader.tmLanguage.json
snippets/
  godot-shader.json
```

Contributions are welcome — open an issue or a PR.

---

## License

AGPL-3.0 © [Fair Yan](https://github.com/yanhuifair)

---

## Appreciate

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
