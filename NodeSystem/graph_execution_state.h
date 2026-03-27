#pragma once

#include "graph_types.h"

#include <any>
#include <map>
#include <string>
#include <unordered_map>
#include <unordered_set>

struct GraphExecutionState {
  std::unordered_map<int, std::map<std::string, std::any>> computed_values;
  std::unordered_map<int, CachedNodeResult> node_cache;
  std::unordered_set<int> exec_cache_hit_nodes;
  std::unordered_set<int> exec_computed_nodes;

  void clearForReload() {
    computed_values.clear();
    exec_cache_hit_nodes.clear();
    exec_computed_nodes.clear();
  }

  void clearAll() {
    computed_values.clear();
    node_cache.clear();
    exec_cache_hit_nodes.clear();
    exec_computed_nodes.clear();
  }

  void pruneNodeCache(const std::unordered_set<int> &valid_node_ids) {
    for (auto it = node_cache.begin(); it != node_cache.end();) {
      if (valid_node_ids.find(it->first) == valid_node_ids.end()) {
        it = node_cache.erase(it);
      } else {
        ++it;
      }
    }
  }
};
