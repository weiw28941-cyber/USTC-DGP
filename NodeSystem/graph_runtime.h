#pragma once

#include "json.hpp"

#include <cstddef>
#include <string>
#include <unordered_map>
#include <unordered_set>

using json = nlohmann::json;

class NodeGraph;

struct GraphExecutionRequest {
  std::unordered_set<int> focus_nodes;
  const std::unordered_set<int> *focus_ptr = nullptr;
  bool delta_only = false;
  bool omit_outputs = false;
  std::size_t max_preview_items = 0;
  std::unordered_set<int> output_node_ids;
  const std::unordered_set<int> *output_node_ids_ptr = nullptr;
  std::unordered_map<int, std::unordered_set<std::string>> output_socket_ids;
  const std::unordered_map<int, std::unordered_set<std::string>>
      *output_socket_ids_ptr = nullptr;
};

void generateNodeTypesConfig(const std::string &output_file);
GraphExecutionRequest parseExecutionRequest(const json &source,
                                           const char *execution_key = nullptr);
json executeGraphRequest(NodeGraph &graph, const GraphExecutionRequest &request);
int runCliApp(int argc, char *argv[]);
int runWorkerLoop();
