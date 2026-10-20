# 打开一个着色器

`.gdshader` 与 `.gdshaderinc` 会自动使用 `Godot Shader` 语言模式，不需要安装 Godot 本体。

```glsl
shader_type canvas_item;

uniform vec4 tint : source_color = vec4(1.0);

void fragment() {
    COLOR = tint;
}
```

新建文件后另存为 `.gdshader` 即可获得高亮、补全与诊断。

**小技巧**：命令面板运行 `Godot Shader: 插入着色器模板`，按所选类型生成最简骨架。

![Godot Shader](../images/logo.png)
