#pragma once

#include "graph_execution_state.h"
#include "graph_model.h"

using json = nlohmann::json;

class GraphExecutor {
public:
  GraphExecutor(GraphModel &graph, GraphExecutionState &state, bool verbose);

  void invalidateSubgraphFrom(int seed_node_id);
  json execute(const std::unordered_set<int> *focus_nodes = nullptr);
  json executeDelta(
      const std::unordered_set<int> *focus_nodes = nullptr,
      bool omit_outputs = false, std::size_t max_preview_items = 0,
      const std::unordered_set<int> *output_node_ids = nullptr,
      const std::unordered_map<int, std::unordered_set<std::string>>
          *output_socket_ids = nullptr);
  json readOutputPage(int node_id, const std::string &socket_id,
                      std::size_t offset = 0, std::size_t limit = 0);

private:
  std::map<std::string, std::any> getInputValues(int node_id);
  bool computeNode(int node_id);
  int getSocketIndex(const NodeBase &node, const std::string &socket_id,
                     bool is_input) const;

  GraphModel &graph_;
  GraphExecutionState &state_;
  bool verbose_ = true;
};
