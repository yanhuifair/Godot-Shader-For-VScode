# 命令、侧栏与 @shader

## 命令（命令面板 / 右键菜单）

| 命令 | 快捷键 | 作用 |
|---|---|---|
| `Godot Shader: 展开 #include` | `Ctrl+Alt+E` / `Cmd+Alt+E` | 展开所有 include 的只读预览 |
| `Godot Shader: 切换 shader_type` | — | 快速替换或插入 `shader_type` |
| `Godot Shader: 插入着色器模板` | — | 按类型插入骨架 |
| `Godot Shader: 显示输出面板` | — | include 解析日志 |
| `Godot Shader: 重建符号缓存` | — | 缓存异常时手动重扫 |

## 侧栏

活动栏里的 **Godot Shader** 视图分三段：

- **参数与变量** —— 按 `group_uniforms` 分组，点击跳到声明
- **包含文件** —— 当前文件的 include 图，缺失的文件标红
- **工作区着色器** —— 所有 `.gdshader`，附 shader_type

## 在对话里问

`@shader` 可以直接回答关于当前着色器的问题：

```
@shader /expand        展开后的完整源码
@shader /uniforms      参数表格
@shader /diagnostics   当前诊断
@shader /docs TIME     查内置变量 / 函数文档
```

`/expand`、`/uniforms`、`/diagnostics`、`/docs` 不需要额外的语言模型；
自由提问则需要一个可用的模型（例如 GitHub Copilot）。
