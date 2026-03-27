#pragma once

#include <string>

enum class PatchKind {
  LayoutOnly,
  GraphStructure,
  NodeState,
  Unsupported
};

PatchKind classifyPatchOp(const std::string &op);
bool patchTriggersExecution(const std::string &op);
bool patchSeedsNodeId(const std::string &op);
bool patchSeedsAddedNode(const std::string &op);
bool patchSeedsToNode(const std::string &op);
