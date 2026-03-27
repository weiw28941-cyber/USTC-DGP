# 自建 C++ 节点指南

本文档对应当前仓库的实际节点框架，重点覆盖：
- 如何新增一个 C++ 节点
- 节点 schema 如何接入前端
- 输入/输出与增量执行如何在现有架构里工作

## 1. 当前节点框架

当前后端不是单文件 `processor.cpp` 结构，而是模块化执行内核：
- `graph_model.*`：节点图、连接、JSON 装载
- `graph_patch_applier.*`：patch 应用、interaction 归一化、局部失效触发
- `graph_executor.*`：执行、缓存、增量执行、失效传播
- `graph_runtime.*`：worker/CLI 协议入口
- `patch_semantics.*`：patch 分类与触发规则
- `node_signature.*`：输入/属性签名

节点系统的核心抽象仍然是：
- `NodeBase`
- `NodeFactory`
- `NodeRegistrar<T>`

但现在 `getSchema()` 已经是正式接口，不再只是可选增强。

## 2. 环境与构建

### 依赖
- CMake
- C++17 编译器
- Node.js

### 构建

```powershell
cmake -S . -B build
cmake --build build --config Release
```

常用目标：

```powershell
cmake --build build --target processor --config Release
cmake --build build --target processor_tests --config Release
cmake --build build --target generate_node_config --config Release
```

运行测试：

```powershell
ctest --test-dir build --output-on-failure
```

## 3. 推荐的新节点流程

### 3.1 先用脚手架

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new_node.ps1 -Name demo_add
```

Geometry 节点：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new_node.ps1 `
  -Name geom_probe `
  -Category Geometry `
  -DisplayName "Geom Probe" `
  -Description "Probe geometry value"
```

### 3.2 生成文件位置

- `Utils` 节点：
  - `NodeSystem/Utils/include/node_xxx.h`
  - `NodeSystem/Utils/src/node_xxx.cpp`
- `Geometry` 节点：
  - `NodeSystem/Geometry/include/node_xxx.h`
  - `NodeSystem/Geometry/src/node_xxx.cpp`

### 3.3 脚手架生成后要补完的内容

- `getInputs()`
- `getOutputs()`
- `getProperties()`
- `getSchema()`
- `execute(...)`
- 如有 `CUSTOM` 输出，补 `NodeUtils::registerAnyToJson<T>()`

## 4. 节点类的最低要求

一个节点通常至少实现这些接口：
- `getType()`
- `getName()`
- `getCategory()`
- `getDescription()`
- `getInputs()`
- `getOutputs()`
- `getProperties()`
- `getSchema()`
- `execute(...)`

并在 `.cpp` 末尾注册：

```cpp
namespace {
NodeRegistrar<node_demo> node_demo_registrar;
}
```

不需要再去改 `processor.cpp`。当前构建会自动收集节点源文件。

## 5. 为什么必须写 `getSchema()`

当前前端已直接消费 schema：
- 节点配置生成自 `NodeFactory::generateNodeTypesConfig()`
- `Op/Type` 标签是否可切换取决于 schema 的 `options/editor`
- 节点 tooltip 与描述取决于 schema
- 属性是否只读取决于 `editable`

建议在 `getSchema()` 里明确设置：
- `color`
- property `type`
- property `editor`
- property `description`
- property `options`
- 运行态属性的 `editable = false`

例如：

```cpp
NodeSchema node_demo::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2b6cb0";

  auto scaleIt = schema.properties.find("scale");
  if (scaleIt != schema.properties.end()) {
    scaleIt->second.type = "number";
    scaleIt->second.editor = "number";
    scaleIt->second.description = "Multiplier applied to the output.";
  }

  return schema;
}
```

## 6. 输入如何进入节点

执行时，节点输入不是直接从 JSON 生读，而是通过图执行器解析：
- 先按 `getInputs()` 建默认输入
- 再用连接结果覆盖
- 必要时递归计算上游节点

所以要保证：
- socket `id` 稳定
- `getInputs()` 和前端 socket 命名一致
- 动态输入节点有稳定命名规则

对于动态输入节点，当前工程常见做法是：
- `vector/list/geometry` 根据 property 重建 inputs
- 前后端都使用一致的 socket id 规则

## 7. 输出如何回到前端

链路是：
1. `execute()` 写入 `outputs`
2. `GraphExecutor` 缓存并序列化结果
3. `Server/server.js` 返回全量结果或 delta
4. WebUI 根据输出类型更新 preview / viewer

所以要保证：
- `outputs["socket_id"]` 和 `getOutputs()` 完全一致
- 类型与声明一致
- `CUSTOM` 类型可序列化

## 8. `CUSTOM` 类型怎么支持 preview

如果输出是 `DataType::CUSTOM`，需要注册 `std::any -> json`：

```cpp
namespace {
struct my_any_to_json_registrar {
  my_any_to_json_registrar() {
    NodeUtils::registerAnyToJson<MyType>([](const std::any& value, json& out) {
      const auto& v = std::any_cast<const MyType&>(value);
      out = json::object();
      out["field"] = v.field;
      return true;
    });

    NodeUtils::registerAnyToJson<std::shared_ptr<MyType>>(
      [](const std::any& value, json& out) {
        const auto& p = std::any_cast<const std::shared_ptr<MyType>&>(value);
        if (!p) {
          out = json::object();
          return true;
        }
        out = json::object();
        out["field"] = p->field;
        return true;
      }
    );
  }
};

my_any_to_json_registrar my_any_to_json_registrar_instance;
}
```

## 8.1 Output Transport 约定

当前节点框架不再默认把所有输出都当成 direct inline JSON。新增节点时，请先判断输出属于哪一类：

- `inline`
  - 小标量、小对象、小型交互状态
  - 继续直接 `any -> json`
- `paged`
  - 顶层大数组
  - 例如 `vector/list/matrix` 这类结果
  - 增量执行时首屏返回 descriptor，前端再按页拉取
- `chunked`
  - 大型几何/网格 payload
  - 例如 `geometry`、`geometry_viewer`
  - 返回 metadata 后，由服务端/前端分块拉取

相关公共封装：

- C++：`NodeSystem/output_transport.*`
- Server：`Server/output_transport.js`
- WebUI：`WebUI/core/output_transport.js`

推荐规则：

1. 如果输出是“数组本体”，优先考虑 `paged`
2. 如果输出包含 `positions/indices/colors/...` 这类大型几何字段，优先考虑 `chunked`
3. 不要为大数组或几何输出继续新增 direct inline fallback

4. `preview budget` 只用于决定首屏 transport 策略，不再递归截断 nested arrays

当前 `preview budget` 语义：
- `inline`
  - 只适合小结果、小对象、小数组
  - 如果输出已经过大，应升级成 `paged` 或 `chunked`
- `paged`
  - `preview budget` 作为 `pageSize`
  - 后续通过 `/graph/:sessionId/output-page` 继续读取，不重新执行整图
- `chunked`
  - `preview budget` 不应裁剪几何字段本体
  - 首屏只返回 metadata，前端再按 chunk 拉取完整 payload

注意：
- 不要依赖后端“递归截断 JSON 数组”来做 preview 优化
- viewer / preview 应始终基于完整 transport descriptor，而不是基于被截断的 nested arrays

## 8.2 什么时候需要补 transport metadata

如果你的 `CUSTOM` 输出想接入 `chunked` 或 viewer 流，请保证序列化后的 JSON 至少能提供稳定标识和统计信息，例如：

- `viewerType`
- `meshId`
- `version`
- `dataFormat`
- `vertexCount / triangleCount / lineCount / pointCount`
- `boundsMin / boundsMax`

`geometry` / `geometry_viewer` 现在就是按这个模式工作的。

如果你的输出是顶层数组，不需要自己拼 `paged` JSON；增量执行层会通过 `NodeSystem/output_transport.*` 生成 descriptor，前端会通过 `/graph/:sessionId/output-page` 读取。

## 8.3 Frontend Preview Integration Contract

When a new node type is added, frontend preview integration must follow the strict contract below.

Preview socket contract:
- Each node type must expose a stable preview socket contract.
- The frontend now validates `previewSocket` during node type loading.
- Do not rely on runtime fallback such as `outputs[0]`.

Frontend graph-change execution:
- Property and socket edits must use:
  - `WebUI/core/graph_change_execution.js`
  - `applyPreviewTrackedNodeEdit(...)`
- Connection edits must use:
  - `WebUI/core/graph_change_execution.js`
  - `enqueueConnectionGraphChange(...)`

Enforcement:
- Property edits without explicit preview execution options now fail fast.
- Connection edits without explicit preview execution options now fail fast.
- Missing preview socket contract for a node with outputs now fails fast.

Why this matters:
- It prevents silent cases where the graph recomputes but preview does not refresh.
- It keeps property changes, socket changes, and connection changes on one standard path.

See:
- `docs/frontend_preview_contract.md`

## 9. interaction 相关节点

当前推荐统一走 `interaction_event` / `interaction_state`：
- viewer 节点输出 `interaction`
- `interaction_state` 节点输入 `event`
- 下游节点从 `interaction_state` 的 `state / committed / transient / channel_state` 读取

当前语义：
- `mesh_edit`、`selection` 会进入图执行链
- `camera` 只更新 viewer 本地相机状态，不触发节点框架执行

如果你的节点要消费交互信息：
- 把输入设计成 `DataType::MAP`
- 兼容 `interaction_event` 的 `channel/phase/payload`
- 对运行态字段在 schema 里设 `editable = false`

## 10. 最小节点模板

### `node_demo.h`

```cpp
#pragma once

#include "node_base.h"

class node_demo : public NodeBase {
public:
  std::string getType() const override;
  std::string getName() const override;
  std::string getCategory() const override;
  std::string getDescription() const override;
  std::vector<Socket> getInputs() const override;
  std::vector<Socket> getOutputs() const override;
  std::map<std::string, std::any> getProperties() const override;
  NodeSchema getSchema() const override;
  bool execute(const std::map<std::string, std::any>& inputs,
               std::map<std::string, std::any>& outputs,
               const std::map<std::string, std::any>& properties) override;
};
```

### `node_demo.cpp`

```cpp
#include "node_demo.h"

std::string node_demo::getType() const { return "demo"; }
std::string node_demo::getName() const { return "Demo"; }
std::string node_demo::getCategory() const { return "Custom"; }
std::string node_demo::getDescription() const { return "Demo node"; }

std::vector<Socket> node_demo::getInputs() const {
  return {{"a", "A", DataType::NUMBER, 0.0},
          {"b", "B", DataType::NUMBER, 0.0}};
}

std::vector<Socket> node_demo::getOutputs() const {
  return {{"sum", "Sum", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> node_demo::getProperties() const {
  std::map<std::string, std::any> props = {{"scale", 1.0}};
  for (const auto& entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_demo::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2b6cb0";
  auto scaleIt = schema.properties.find("scale");
  if (scaleIt != schema.properties.end()) {
    scaleIt->second.type = "number";
    scaleIt->second.editor = "number";
    scaleIt->second.description = "Multiplier applied to the sum.";
  }
  return schema;
}

bool node_demo::execute(const std::map<std::string, std::any>& inputs,
                        std::map<std::string, std::any>& outputs,
                        const std::map<std::string, std::any>& properties) {
  try {
    const double a = NodeUtils::getValue<double>(inputs.at("a"), 0.0);
    const double b = NodeUtils::getValue<double>(inputs.at("b"), 0.0);
    const double scale = NodeUtils::getValue<double>(properties.at("scale"), 1.0);
    outputs["sum"] = (a + b) * scale;
    return true;
  } catch (const std::exception& e) {
    errorMessage = std::string("Demo node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_demo> node_demo_registrar;
}
```

## 11. 常见问题

1. 新节点编译了但前端不显示  
   先重新构建并确认 `json/generated/node_types.json` 已更新。

2. preview 只有 `Object`  
   通常是 `CUSTOM` 类型没注册 `NodeUtils::registerAnyToJson<T>()`。

3. interaction_state 一直空  
   检查 viewer `interaction` 是否真的连到了 `interaction_state.event`。

4. 修改节点属性后没有增量重算  
   检查是否走了 `set_node_property` 或 `set_node_input_literal` patch，而不是只改了前端本地状态。
