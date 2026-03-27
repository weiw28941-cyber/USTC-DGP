#pragma once

#include "graph_model.h"

#include <functional>
#include <string>

class GraphPatchApplier {
public:
  GraphPatchApplier(GraphModel &graph,
                    std::function<void(int)> invalidate_subgraph);

  bool applyPatch(const json &patch, std::string &err);
  bool applyPatches(const json &patches, std::string &err);

private:
  static json anyToJsonOrObject(const std::any &value);
  static bool normalizeInteractionEvent(const json &raw, int fallback_node_id,
                                        json &out_event, std::string &err);
  static void mergeInteractionEventIntoProps(
      std::map<std::string, std::any> &props, const json &event);

  GraphModel &graph_;
  std::function<void(int)> invalidate_subgraph_;
};
