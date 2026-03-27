#include "graph_runtime.h"
#include "node_system_registration.h"
#include "output_transport.h"
#include "processor_graph.h"

#include <algorithm>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>

namespace {

void expect(bool condition, const std::string &message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

json makeVectorGraphJson() {
  return json::parse(R"({
    "nodes": [
      { "id": 0, "type": "value", "value": 1.5, "operation": "", "label": "X" },
      { "id": 1, "type": "value", "value": 2.5, "operation": "", "label": "Y" },
      { "id": 2, "type": "value", "value": 3.5, "operation": "", "label": "Z" },
      { "id": 3, "type": "vector", "properties": { "values": [0, 0, 0], "operation": "number" } }
    ],
    "connections": [
      { "from_node": 0, "from_socket": "out", "to_node": 3, "to_socket": "x" },
      { "from_node": 1, "from_socket": "out", "to_node": 3, "to_socket": "y" },
      { "from_node": 2, "from_socket": "out", "to_node": 3, "to_socket": "z" }
    ]
  })");
}

void testParseExecutionRequest() {
  const json source = json::parse(R"({
    "_execution": {
      "target_nodes": [3, 7],
      "delta_only": true,
      "omit_outputs": true,
      "max_preview_items": 5,
      "output_node_ids": [7],
      "output_socket_ids": {
        "7": ["vec", "debug"]
      }
    }
  })");

  const GraphExecutionRequest request =
      parseExecutionRequest(source, "_execution");

  expect(request.focus_ptr != nullptr, "focus_ptr should be populated");
  expect(request.focus_nodes.size() == 2, "expected two focus nodes");
  expect(request.focus_nodes.count(3) == 1, "missing focus node 3");
  expect(request.focus_nodes.count(7) == 1, "missing focus node 7");
  expect(request.delta_only, "delta_only should be true");
  expect(request.omit_outputs, "omit_outputs should be true");
  expect(request.max_preview_items == 5, "max_preview_items should be 5");
  expect(request.output_node_ids_ptr != nullptr,
         "output_node_ids_ptr should be populated");
  expect(request.output_node_ids.count(7) == 1, "missing output node 7");
  expect(request.output_socket_ids_ptr != nullptr,
         "output_socket_ids_ptr should be populated");
  expect(request.output_socket_ids.count(7) == 1,
         "missing output socket filter for node 7");
  expect(request.output_socket_ids.at(7).count("vec") == 1,
         "missing vec socket filter");
  expect(request.output_socket_ids.at(7).count("debug") == 1,
         "missing debug socket filter");
}

void testPropertyPatchInvalidatesAffectedSubgraphOnly() {
  NodeGraph graph;
  graph.verbose = false;
  graph.loadFromJson(makeVectorGraphJson());

  graph.execute();
  expect(graph.execution_state.computed_values.size() == 4,
         "expected all nodes to be computed before patch");

  std::string err;
  const bool ok = graph.applyPatch(
      json{{"op", "set_node_property"},
           {"nodeId", 0},
           {"key", "value"},
           {"value", 9.0}},
      err);
  expect(ok, "set_node_property patch should succeed: " + err);

  expect(graph.execution_state.computed_values.count(0) == 0,
         "patched node 0 should be invalidated");
  expect(graph.execution_state.computed_values.count(3) == 0,
         "downstream node 3 should be invalidated");
  expect(graph.execution_state.computed_values.count(1) == 1,
         "unaffected node 1 should stay cached");
  expect(graph.execution_state.computed_values.count(2) == 1,
         "unaffected node 2 should stay cached");

  std::unordered_set<int> focus{3};
  const json results = graph.executeDelta(&focus);
  expect(!results["node_deltas"].empty(),
         "executeDelta should return node deltas");
  expect(graph.execution_state.computed_values.count(0) == 1,
         "patched source node should recompute when downstream executes");
  expect(graph.execution_state.computed_values.count(3) == 1,
         "downstream node should recompute");
}

void testInvalidateSubgraphFromOnlyClearsDownstream() {
  NodeGraph graph;
  graph.verbose = false;
  graph.loadFromJson(makeVectorGraphJson());

  graph.execute();
  expect(graph.execution_state.computed_values.size() == 4,
         "expected all nodes to be computed before invalidation");

  graph.makeExecutor().invalidateSubgraphFrom(1);

  expect(graph.execution_state.computed_values.count(1) == 0,
         "seed node 1 should be invalidated");
  expect(graph.execution_state.computed_values.count(3) == 0,
         "downstream vector node should be invalidated");
  expect(graph.execution_state.computed_values.count(0) == 1,
         "independent node 0 should remain cached");
  expect(graph.execution_state.computed_values.count(2) == 1,
         "independent node 2 should remain cached");
}

void testReloadPreservesReusableNodeCache() {
  NodeGraph graph;
  graph.verbose = false;
  const json graphJson = makeVectorGraphJson();
  graph.loadFromJson(graphJson);
  graph.execute();

  expect(graph.execution_state.node_cache.size() == 4,
         "expected node cache to be warm after initial execute");

  graph.loadFromJson(graphJson);
  expect(graph.execution_state.computed_values.empty(),
         "reload should clear computed_values");
  expect(graph.execution_state.node_cache.size() == 4,
         "reload should preserve reusable node_cache entries");

  std::unordered_set<int> focus{3};
  const json results = graph.executeDelta(&focus);
  const json stats = results.value("execution_stats", json::object());
  expect(stats.value("computedNodeCount", 0) == 0,
         "unchanged reload should not recompute focused subgraph");
  expect(stats.value("cacheHitNodeCount", 0) == 4,
         "unchanged reload should reuse upstream cache chain");
}

void testSuccessfulRecomputeClearsStaleErrorMessage() {
  NodeGraph graph;
  graph.verbose = false;
  const json graphJson = json::parse(R"({
    "nodes": [
      { "id": 0, "type": "vector", "properties": { "values": [1, 2, 3], "operation": "number" } },
      { "id": 1, "type": "vector_unary", "properties": { "operation": "average" } }
    ],
    "connections": []
  })");
  graph.loadFromJson(graphJson);

  const json first = graph.execute();
  const auto &firstNodes = first.at("nodes");
  const auto failing = std::find_if(firstNodes.begin(), firstNodes.end(), [](const json &node) {
    return node.value("id", -1) == 1;
  });
  expect(failing != firstNodes.end(), "expected vector_unary node in first execute");
  expect((*failing).value("success", true) == false,
         "vector_unary without input should fail for average");
  expect(!(*failing).value("error", std::string()).empty(),
         "failed vector_unary should expose an error");

  std::string err;
  const bool ok = graph.applyPatch(
      json{{"op", "add_connection"},
           {"from_node", 0},
           {"from_socket", "vec"},
           {"to_node", 1},
           {"to_socket", "a"}},
      err);
  expect(ok, "add_connection patch should succeed: " + err);

  std::unordered_set<int> focus{1};
  const json second = graph.executeDelta(&focus);
  const auto &secondNodes = second.at("node_deltas");
  const auto recovered = std::find_if(secondNodes.begin(), secondNodes.end(), [](const json &node) {
    return node.value("id", -1) == 1;
  });
  expect(recovered != secondNodes.end(), "expected vector_unary node delta after reconnect");
  expect((*recovered).value("success", false) == true,
         "vector_unary should recover after input connection is restored");
  expect((*recovered).value("error", std::string()).empty(),
         "successful recompute should clear stale error text");
}

void testReadOutputPagePaginatesArrayOutputs() {
  NodeGraph graph;
  graph.verbose = false;
  graph.loadFromJson(json::parse(R"({
    "nodes": [
      { "id": 0, "type": "vector", "properties": { "values": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "operation": "number" } }
    ],
    "connections": []
  })"));

  const json page0 = graph.readOutputPage(0, "vec", 0, 4);
  expect(page0.value("success", false) == true,
         "first page fetch should succeed");
  expect(page0.value("paginated", false) == true,
         "vector output should be paginated");
  expect(page0.value("totalCount", 0) == 10,
         "vector totalCount should match full size");
  expect(page0.value("count", 0) == 4,
         "first page should contain 4 items");
  expect(page0.value("hasMore", false) == true,
         "first page should report more items");
  expect(page0.at("output").is_array() && page0.at("output").size() == 4,
         "first page output should contain 4 items");
  expect(page0.at("output")[0].get<double>() == 0.0,
         "first page should start with first vector item");

  const json page1 = graph.readOutputPage(0, "vec", 4, 4);
  expect(page1.value("success", false) == true,
         "second page fetch should succeed");
  expect(page1.value("count", 0) == 4,
         "second page should contain 4 items");
  expect(page1.at("output")[0].get<double>() == 4.0,
         "second page should start at requested offset");

  const json page2 = graph.readOutputPage(0, "vec", 8, 4);
  expect(page2.value("success", false) == true,
         "tail page fetch should succeed");
  expect(page2.value("count", 0) == 2,
         "tail page should contain remaining items only");
  expect(page2.value("hasMore", true) == false,
         "tail page should report no more items");
  expect(page2.at("output")[1].get<double>() == 9.0,
         "tail page should end with final vector item");
}

void testExecuteDeltaUsesPagedDescriptorForArrayPreview() {
  NodeGraph graph;
  graph.verbose = false;
  graph.loadFromJson(json::parse(R"({
    "nodes": [
      { "id": 0, "type": "vector", "properties": { "values": [0, 1, 2, 3, 4, 5], "operation": "number" } }
    ],
    "connections": []
  })"));

  std::unordered_set<int> focus{0};
  std::unordered_set<int> outputNodes{0};
  std::unordered_map<int, std::unordered_set<std::string>> outputSockets{
      {0, {"vec"}}};
  const json result = graph.executeDelta(&focus, false, 4, &outputNodes, &outputSockets);
  expect(result.contains("node_deltas") && result["node_deltas"].is_array() &&
             result["node_deltas"].size() == 1,
         "executeDelta should return exactly one node delta");
  const json &nodeDelta = result["node_deltas"][0];
  expect(nodeDelta.value("outputs_truncated", false) == true,
         "array preview should be marked truncated when paged");
  expect(nodeDelta.contains("outputs") && nodeDelta["outputs"].contains("vec"),
         "vector node delta should expose vec output");
  const json &descriptor = nodeDelta["outputs"]["vec"];
  expect(descriptor.contains("stream") && descriptor["stream"].is_object(),
         "vector preview should expose a paged stream descriptor");
  expect(descriptor["stream"].value("mode", std::string()) == "paged",
         "vector preview stream mode should be paged");
  expect(descriptor["stream"].value("socketId", std::string()) == "vec",
         "paged descriptor should carry socket id");
  expect(descriptor["stream"].value("totalCount", 0) == 6,
         "paged descriptor should keep total count");
  expect(descriptor["stream"].value("pageSize", 0) == 4,
         "paged descriptor should reuse preview budget as page size");
  expect(descriptor["stream"].value("loadedCount", -1) == 0,
         "paged descriptor should start with zero loaded items");
  expect(descriptor.value("paginated", false) == true,
         "paged descriptor should be marked paginated");
}

void testExecuteDeltaIncludesRequestedOutputNodesOutsideFocus() {
  NodeGraph graph;
  graph.verbose = false;
  graph.loadFromJson(json::parse(R"({
    "nodes": [
      { "id": 0, "type": "value", "properties": { "value": 1 } },
      { "id": 1, "type": "vector", "properties": { "values": [0], "operation": "number" } }
    ],
    "connections": [
      { "from_node": 0, "from_socket": "value", "to_node": 1, "to_socket": "x" }
    ]
  })"));

  std::unordered_set<int> focus{0};
  std::unordered_set<int> outputNodes{1};
  std::unordered_map<int, std::unordered_set<std::string>> outputSockets{
      {1, {"vec"}}};
  const json result =
      graph.executeDelta(&focus, false, 4, &outputNodes, &outputSockets);
  expect(result.contains("node_deltas") && result["node_deltas"].is_array(),
         "executeDelta should return node deltas");

  bool sawVector = false;
  for (const auto &nodeDelta : result["node_deltas"]) {
    if (nodeDelta.value("id", -1) != 1) {
      continue;
    }
    sawVector = true;
    expect(nodeDelta.contains("outputs") && nodeDelta["outputs"].contains("vec"),
           "requested vector output should be included even when vector is outside focus");
    const json &descriptor = nodeDelta["outputs"]["vec"];
    expect(descriptor.contains("stream") && descriptor["stream"].is_object(),
           "vector output should still use paged preview descriptor");
    expect(descriptor["stream"].value("totalCount", 0) == 1,
           "vector preview should reflect downstream computed size");
  }
  expect(sawVector, "executeDelta should include the requested vector node");
}

void testPagedMatrixDescriptorUsesRowBudget() {
  json matrix = json::array(
      {json::array({1, 2, 3, 4, 5}), json::array({6, 7, 8, 9, 10}),
       json::array({11, 12, 13, 14, 15}), json::array({16, 17, 18, 19, 20}),
       json::array({21, 22, 23, 24, 25})});
  const json descriptor =
      OutputTransport::makePagedArrayDescriptor("mat", matrix, 12);
  expect(descriptor["stream"].value("mode", std::string()) == "paged",
         "matrix descriptor should stay paged");
  expect(descriptor["stream"].value("pageSize", 0) == 2,
         "matrix rows per page should shrink so rows*cols fits preview budget");
  expect(descriptor["stream"].value("rows", 0) == 5,
         "matrix descriptor should expose total rows");
  expect(descriptor["stream"].value("cols", 0) == 5,
         "matrix descriptor should expose total cols");
  expect(descriptor["stream"].value("pageUnit", std::string()) == "rows",
         "matrix descriptor should mark row-based paging");
}

void testExecuteDeltaDoesNotRecursivelyTruncateNestedPreviewPayloads() {
  NodeGraph graph;
  graph.verbose = false;
  graph.loadFromJson(json::parse(R"({
    "nodes": [
      { "id": 0, "type": "geometry_viewer", "properties": { "light": [0.45, 0.75, 0.55], "intensity": 1.2 } }
    ],
    "connections": []
  })"));

  std::unordered_set<int> focus{0};
  std::unordered_set<int> outputNodes{0};
  std::unordered_map<int, std::unordered_set<std::string>> outputSockets{
      {0, {"view"}}};
  const json result =
      graph.executeDelta(&focus, false, 1, &outputNodes, &outputSockets);
  expect(result.contains("node_deltas") && result["node_deltas"].is_array() &&
             result["node_deltas"].size() == 1,
         "geometry_viewer executeDelta should return exactly one node delta");
  const json &nodeDelta = result["node_deltas"][0];
  expect(nodeDelta.value("outputs_truncated", false) == false,
         "nested geometry payloads should not be marked truncated by preview budget");
  expect(nodeDelta.contains("outputs") && nodeDelta["outputs"].contains("view"),
         "geometry_viewer node delta should expose view output");
  const json &view = nodeDelta["outputs"]["view"];
  expect(view.is_object(), "geometry_viewer view output should stay inline object");
  expect(view.contains("positions") && view["positions"].is_array(),
         "geometry_viewer view should contain positions array");
  expect(view["positions"].size() == 24,
         "default geometry positions should remain intact under preview budget");
  expect(view.contains("triIndices") && view["triIndices"].is_array(),
         "geometry_viewer view should contain triangle indices");
  expect(view["triIndices"].size() == 36,
         "default geometry triangles should remain intact under preview budget");
}

const json &findNodeTypeConfig(const json &config, const std::string &nodeId) {
  for (const auto &entry : config.at("nodeTypes")) {
    if (entry.value("id", std::string()) == nodeId) {
      return entry;
    }
  }
  throw std::runtime_error("missing node config for type: " + nodeId);
}

void testGeneratedNodeTypeSchemasExposeStableMetadata() {
  const json config = NodeFactory::instance().generateNodeTypesConfig();
  expect(config.contains("nodeTypes") && config["nodeTypes"].is_array(),
         "nodeTypes config should contain an array");
  expect(!config["nodeTypes"].empty(),
         "nodeTypes config should not be empty");

  std::set<std::string> seenIds;
  for (const auto &entry : config["nodeTypes"]) {
    const std::string id = entry.value("id", std::string());
    expect(!id.empty(), "each node type should have a non-empty id");
    expect(seenIds.insert(id).second, "duplicate node type id: " + id);
    expect(entry.contains("name") && entry["name"].is_string(),
           "node type should expose a name: " + id);
    expect(entry.contains("category") && entry["category"].is_string(),
           "node type should expose a category: " + id);
    expect(entry.contains("color") && entry["color"].is_string(),
           "node type should expose a color: " + id);
    expect(entry.contains("inputs") && entry["inputs"].is_array(),
           "node type should expose inputs: " + id);
    expect(entry.contains("outputs") && entry["outputs"].is_array(),
           "node type should expose outputs: " + id);
    expect(entry.contains("properties") && entry["properties"].is_object(),
           "node type should expose properties object: " + id);
  }

  const auto &valueNode = findNodeTypeConfig(config, "value");
  expect(valueNode["properties"].contains("value"),
         "value node should expose value property");
  expect(valueNode["properties"]["value"].value("editor", std::string()) == "number",
         "value.value should use number editor");

  const auto &vectorNode = findNodeTypeConfig(config, "vector");
  expect(vectorNode["properties"]["operation"].value("editor", std::string()) == "select",
         "vector.operation should use select editor");
  const auto &vectorMathNode = findNodeTypeConfig(config, "vector_math");
  expect(vectorMathNode["properties"]["operation"].value("editor", std::string()) == "select",
         "vector_math.operation should use select editor");
  const auto &vectorUnaryNode = findNodeTypeConfig(config, "vector_unary");
  expect(vectorUnaryNode["properties"]["operation"].value("editor", std::string()) == "select",
         "vector_unary.operation should use select editor");
  const auto &vectorScalarNode = findNodeTypeConfig(config, "vector_scalar");
  expect(vectorScalarNode["properties"]["operation"].value("editor", std::string()) == "select",
         "vector_scalar.operation should use select editor");

  const auto &listNode = findNodeTypeConfig(config, "list");
  expect(listNode["properties"]["operation"].value("editor", std::string()) == "select",
         "list.operation should use select editor");
  const auto &listMathNode = findNodeTypeConfig(config, "list_math");
  expect(listMathNode["properties"]["operation"].value("editor", std::string()) == "select",
         "list_math.operation should use select editor");
  const auto &listUnaryNode = findNodeTypeConfig(config, "list_unary");
  expect(listUnaryNode["properties"]["operation"].value("editor", std::string()) == "select",
         "list_unary.operation should use select editor");
  const auto &listScalarNode = findNodeTypeConfig(config, "list_scalar");
  expect(listScalarNode["properties"]["operation"].value("editor", std::string()) == "select",
         "list_scalar.operation should use select editor");

  const auto &matrixMathNode = findNodeTypeConfig(config, "matrix_math");
  expect(matrixMathNode["properties"]["operation"].value("editor", std::string()) == "select",
         "matrix_math.operation should use select editor");
  const auto &textureNode = findNodeTypeConfig(config, "texture");
  expect(textureNode["properties"]["path"].value("editor", std::string()) == "text",
         "texture.path should use text editor");

  const auto &interactionNode = findNodeTypeConfig(config, "interaction_state");
  expect(interactionNode["properties"]["interaction_event"].value("editable", true) == false,
         "interaction_state.interaction_event should be readonly");

  const auto &viewerNode = findNodeTypeConfig(config, "geometry_viewer");
  expect(viewerNode["properties"]["interaction_event"].value("editable", true) == false,
         "geometry_viewer.interaction_event should be readonly");
  expect(viewerNode["properties"]["intensity"].value("editor", std::string()) == "number",
         "geometry_viewer.intensity should use number editor");

  const auto &laplacianNode = findNodeTypeConfig(config, "laplacian_deform");
  expect(laplacianNode["properties"]["iterations"].value("editor", std::string()) == "number",
         "laplacian_deform.iterations should use number editor");
  expect(laplacianNode["properties"]["phase_filter"].value("editor", std::string()) == "select",
         "laplacian_deform.phase_filter should use select editor");
}

} // namespace

int main() {
  try {
    testParseExecutionRequest();
    testPropertyPatchInvalidatesAffectedSubgraphOnly();
    testInvalidateSubgraphFromOnlyClearsDownstream();
    testReloadPreservesReusableNodeCache();
    testSuccessfulRecomputeClearsStaleErrorMessage();
    testReadOutputPagePaginatesArrayOutputs();
    testExecuteDeltaUsesPagedDescriptorForArrayPreview();
    testPagedMatrixDescriptorUsesRowBudget();
    testExecuteDeltaIncludesRequestedOutputNodesOutsideFocus();
    testExecuteDeltaDoesNotRecursivelyTruncateNestedPreviewPayloads();
    testGeneratedNodeTypeSchemasExposeStableMetadata();
    std::cout << "processor_tests passed" << std::endl;
    return 0;
  } catch (const std::exception &e) {
    std::cerr << "processor_tests failed: " << e.what() << std::endl;
    return 1;
  }
}
