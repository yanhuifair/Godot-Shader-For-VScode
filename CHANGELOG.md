# Changelog

All notable changes to **Godot Shader for VS Code** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [1.0.112] — 2026-10-21

### Added

- **On-type formatting** — with `editor.formatOnType` enabled, typing `}` aligns it with its opening
  brace and typing `;` normalizes the line it closes.
- **Call hierarchy** (`Shift+Alt+H`) — incoming calls are searched in the current file and every file
  it includes, outgoing calls resolve helper functions declared in `.gdshaderinc`.
- **Fix All** — all auto-fixable diagnostics (missing `;`, `shader_type`, stray/missing braces) can be
  applied at once via `Source Action… → Fix All` or `editor.codeActionsOnSave: {"source.fixAll": …}`.
- **`#include` tracing** — `godot-shader.trace.includeResolution` logs resolution results to the
  output panel.
- Multi-root workspaces: `res://` includes now resolve against the folder that actually contains the
  file.

### Fixed

- Files without a `shader_type` no longer produce bogus "read-only" errors for output variables such
  as `COLOR` — the read-only check now requires a known shader type.

## [1.0.111] — 2026-10-21

### Added

- **Commands, context menu and keybinding** — `Godot Shader: Expand #include`, `Switch shader_type`,
  `Insert Shader Template`, `Show Output Panel`, `Reload Symbol Caches`; the first three also appear
  in the editor context menu for `godot-shader` files (`Ctrl+Alt+E` / `Cmd+Alt+E` for the preview).
- **Auto-import** — symbols declared in other `.gdshaderinc` files of the workspace are offered in
  completion and insert the matching `#include` via `additionalTextEdits`. Toggle with
  `godot-shader.completion.autoImport`.
- **Read-only expanded preview** — expands every `#include` inline into a virtual document
  (cycle-safe, with source banners), without touching the original file.
- **Output channel** — `Godot Shader` panel for command results and include diagnostics; the status
  bar item now opens it on click.
- **Richer diagnostics** — unused declarations/locals use `DiagnosticTag.Unnecessary`, deprecated
  functions use `DiagnosticTag.Deprecated` (both render as strikethrough), and duplicate declarations
  carry `DiagnosticRelatedInformation` pointing at the first declaration.
- **`semanticTokenScopes` + `configurationDefaults`** — semantic tokens now map to standard TextMate
  scopes (works with any theme), and `.gdshader` files get sensible editor defaults (tab size 4,
  word-based suggestions off, bracket colorization on).
- **Localised command titles** — `package.nls.json` / `package.nls.zh-cn.json`.
- Marketplace metadata: `markdown`, `qna`, and workspace capability declarations.

### Changed

- Completion resolves workspace include symbols asynchronously (cached, max 200 files).
- `@types/vscode` pinned to `1.85.0` so the extension cannot accidentally use newer APIs.

## [1.0.110] — 2026-10-21

### Fixed

- Formatting: `braceNewLine: false` now actually joins a `{` on its own line back onto the previous
  line, and one-line blocks (`void f(){ … }`) are expanded — previously both were no-ops.
- `#if 0` dimming was documented but never implemented; a TextMate rule now scopes disabled blocks
  as comments.
- `varying sampler2D x;` is now reported as an invalid varying type.

### Docs

- Rewrote `README.md` / `README-zh.md`: highlights, table of contents, requirements, known
  limitations, FAQ and development sections; corrected every count (121 functions, 23 rules,
  345 English descriptions) and the snippet table (all 65 prefixes verified against the JSON).

## [1.0.109] — 2026-10-20

### Added

- Cross-file symbol resolution through `#include` (transitive, cycle-safe): completion, hover,
  signature help, go-to-definition, find references and rename all work across `.gdshaderinc` files.
- `res://` include paths resolved against the workspace root; missing includes reported as warnings.
- Unused-declaration diagnostic now counts usages inside included files.

## [1.0.108] — 2026-10-20

### Added

- Per-document symbol index (uniforms, locals, parameters, functions, structs) shared by completion,
  hover, signature help, definition, outline and semantic tokens.
- Completion of every symbol declared in the file; struct field completion; `group_uniforms`
  completion; `global` / `instance` keyword support.
- Struct hover, struct-in-outline, folding of comment blocks and `#if…#endif`.
- Diagnostics: missing `#include` target, `shader_type` position, `group_uniforms` semicolon.

## [1.0.107] — 2026-10-20

### Added

- Scope-aware find-references / rename / document highlight (locals stay inside their function).
- Hover and signature help for user-defined functions (with doc comments); overload selection by
  argument count; multi-line call support.
- Swizzle completion (`.x`, `.rgb`, …) with type awareness.
- Quick fix for a stray closing brace.

### Fixed

- CodeLens counts ignore comments and strings, matching find-references.

## [1.0.106] — 2026-10-20

### Fixed

Significant false-positive cleanup in diagnostics:

- `COLOR`/`VERTEX`/`UV`/`TEXTURE` writable in `canvas_item`, `DEPTH` writable in `spatial`.
- Trailing-comment words no longer parsed as hints; numbers inside strings/comments ignored.
- `varying flat/smooth` and `global`/`instance uniform` parsed correctly everywhere.
- `discard` inside comments, multi-line expressions and struct brace depth handled.
- Semantic highlighting no longer colours words inside comments/strings.
- Inlay hints skip definitions and constructors; `#include` completion replaces the whole path.
- Formatting keeps the document EOL (CRLF stays CRLF) and preserves `*` continuation lines.
- Packaging excludes `.github`, `.workbuddy` and test fixtures (667 KB → 196 KB).
- `auto-version.js` also updates the Chinese README badge.

## Earlier versions

See the [commit history](https://github.com/yanhuifair/Godot-Shader-For-VScode/commits/main).
