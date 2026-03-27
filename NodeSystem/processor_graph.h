#pragma once

#include "graph_execution_state.h"
#include "graph_executor.h"
#include "graph_model.h"
#include "graph_patch_applier.h"

#include <string>
#include <unordered_map>
#include <unordered_set>

using json = nlohmann::json;

class NodeGraph {
public:
  GraphModel graph;
  GraphExecutionState execution_state;
  bool verbose = true;

  void loadFromJson(const json &data) {
    execution_state.clearForReload();
    graph.loadFromJson(data);
    std::unordered_set<int> valid_node_ids;
    valid_node_ids.reserve(graph.nodes.size());
    for (const auto &[id, _] : graph.nodes) {
      valid_node_ids.insert(id);
    }
    execution_state.pruneNodeCache(valid_node_ids);
  }

  GraphExecutor makeExecutor() {
    return GraphExecutor(graph, execution_state, verbose);
  }

  bool applyPatch(const json &patch, std::string &err) {
    return GraphPatchApplier(
               graph, [this](int node_id) {
                 makeExecutor().invalidateSubgraphFrom(node_id);
               })
        .applyPatch(patch, err);
  }

  bool applyPatches(const json &patches, std::string &err) {
    return GraphPatchApplier(
               graph, [this](int node_id) {
                 makeExecutor().invalidateSubgraphFrom(node_id);
               })
        .applyPatches(patches, err);
  }

  json execute(const std::unordered_set<int> *focus_nodes = nullptr) {
    return makeExecutor().execute(focus_nodes);
  }

  json executeDelta(
      const std::unordered_set<int> *focus_nodes = nullptr,
      bool omit_outputs = false, std::size_t max_preview_items = 0,
      const std::unordered_set<int> *output_node_ids = nullptr,
      const std::unordered_map<int, std::unordered_set<std::string>>
          *output_socket_ids = nullptr) {
    return makeExecutor().executeDelta(focus_nodes, omit_outputs,
                                       max_preview_items, output_node_ids,
                                       output_socket_ids);
  }

  json readOutputPage(int node_id, const std::string &socket_id,
                      std::size_t offset = 0, std::size_t limit = 0) {
    return makeExecutor().readOutputPage(node_id, socket_id, offset, limit);
  }

  void printGraph() {
    graph.printGraph(verbose);
  }
};
