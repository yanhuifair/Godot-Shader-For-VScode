# 用 include 组织着色器

把公共的 `uniform` 和函数放进 `.gdshaderinc`，主着色器只保留自己的逻辑：

```glsl
// common.gdshaderinc
uniform vec4 tint : source_color;

vec3 apply_tint(vec3 c) {
    return c * tint.rgb;
}
```

```glsl
// effect.gdshader
shader_type canvas_item;
#include "common.gdshaderinc"

void fragment() {
    COLOR = vec4(apply_tint(COLOR.rgb), 1.0);
}
```

这些行为都是自动的：

- 补全里会出现另一个 `.gdshaderinc` 里的符号，接受时**自动插入 `#include`**
- 把 `.gdshaderinc` 拖进编辑器 → 自动插入 `#include` 行
- 粘贴一段引用了别处符号的代码 → 询问是否补上对应 `#include`
- `Ctrl+Alt+E` / `Cmd+Alt+E` 展开全部 include，生成只读预览

侧边栏的 **Includes** 会列出当前文件包含的所有文件，缺失的标红。
