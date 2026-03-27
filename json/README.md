# json 目录说明

本目录用于存放节点框架使用的 JSON 资源与运行时文件。

当前按用途分为 5 类：

## generated

路径：
- [generated/node_types.json](/Users/lym29/Documents/Frame/json/generated/node_types.json)

用途：
- 由 C++ 后端根据 `NodeFactory::generateNodeTypesConfig()` 自动生成
- WebUI 启动时读取，用于构建节点类型列表和 schema 元数据

特点：
- 这是生成物，不建议手改
- 删掉后可通过构建重新生成

重新生成：

```powershell
cmake --build build --target generate_node_config --config Release
```

## runtime

路径：
- [runtime/graph_input.json](/Users/lym29/Documents/Frame/json/runtime/graph_input.json)
- [runtime/graph_output.json](/Users/lym29/Documents/Frame/json/runtime/graph_output.json)

用途：
- 服务端或 CLI 执行时落盘的输入/输出快照
- 主要用于调试、排查和手工验证

特点：
- 不是源码资源
- 运行时会被覆盖
- 可以删除，后续执行时会重新生成

## config

路径：
- [config/interaction_schema.json](/Users/lym29/Documents/Frame/json/config/interaction_schema.json)
- [config/shortcuts.json](/Users/lym29/Documents/Frame/json/config/shortcuts.json)

用途：
- `interaction_schema.json`
  - 交互事件结构说明
  - 供文档和交互协议对照使用
- `shortcuts.json`
  - WebUI 快捷键配置
  - 由服务端 `/shortcuts` 接口读写

特点：
- 这是运行配置，不是构建产物
- 可以手动编辑，但应保持 JSON 合法
- 不建议随意删除

## examples

路径示例：
- [examples/example_graph.json](/Users/lym29/Documents/Frame/json/examples/example_graph.json)
- [examples/test_graph.json](/Users/lym29/Documents/Frame/json/examples/test_graph.json)
- [examples/test_vector.json](/Users/lym29/Documents/Frame/json/examples/test_vector.json)

用途：
- 样例图
- 手工加载/演示用 JSON

特点：
- 不是框架必需文件
- 删除不会影响构建
- 但会影响示例和手动验证

## tests

路径示例：
- [tests/matrix_ok.json](/Users/lym29/Documents/Frame/json/tests/matrix_ok.json)
- [tests/matrix_ok_out.json](/Users/lym29/Documents/Frame/json/tests/matrix_ok_out.json)
- [tests/test_interaction_with_event.json](/Users/lym29/Documents/Frame/json/tests/test_interaction_with_event.json)

用途：
- 回归测试输入
- 预期输出样例
- interaction / matrix 等场景验证数据

特点：
- 不是构建产物
- 删除不会影响主程序运行
- 但会削弱测试和问题复现能力

## 维护约定

建议遵循：
- `generated/`：只放自动生成文件
- `runtime/`：只放运行时临时/覆盖文件
- `config/`：只放长期配置
- `examples/`：只放示例和演示图
- `tests/`：只放测试输入/输出

如果后面新增 JSON 文件，优先按“是否生成物 / 是否运行时覆盖 / 是否配置 / 是否测试样例”来归类。
