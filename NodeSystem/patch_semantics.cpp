#include "patch_semantics.h"

PatchKind classifyPatchOp(const std::string &op) {
  if (op == "move_node" || op == "set_node_size" || op == "set_graph_meta") {
    return PatchKind::LayoutOnly;
  }
  if (op == "add_connection" || op == "remove_connection" || op == "add_node" ||
      op == "remove_node") {
    return PatchKind::GraphStructure;
  }
  if (op == "set_node_property" || op == "set_node_input_literal" ||
      op == "viewer_interaction") {
    return PatchKind::NodeState;
  }
  return PatchKind::Unsupported;
}

bool patchTriggersExecution(const std::string &op) {
  const PatchKind kind = classifyPatchOp(op);
  return kind == PatchKind::GraphStructure || kind == PatchKind::NodeState;
}

bool patchSeedsNodeId(const std::string &op) {
  return op == "set_node_property" || op == "set_node_input_literal" ||
         op == "viewer_interaction";
}

bool patchSeedsAddedNode(const std::string &op) { return op == "add_node"; }

bool patchSeedsToNode(const std::string &op) {
  return op == "add_connection" || op == "remove_connection";
}
