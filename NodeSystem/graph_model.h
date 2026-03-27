#pragma once

#include "graph_types.h"
#include "json.hpp"
#include "node_base.h"

#include <any>
#include <map>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

class GraphModel {
public:
  std::map<int, std::unique_ptr<NodeBase>> nodes;
  std::vector<GraphConnection> connections;
  std::unordered_map<int, std::vector<size_t>> incoming_connection_indices;
  std::unordered_map<int, std::vector<int>> outgoing_node_ids;

  void loadFromJson(const json &data);
  void rebuildIncomingConnectionIndices();
  void printGraph(bool verbose) const;

  static std::any jsonToAny(const json &j);
};
