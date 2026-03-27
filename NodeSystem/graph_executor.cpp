#include "graph_executor.h"

#include "node_signature.h"
#include "output_transport.h"

#include <iostream>

GraphExecutor::GraphExecutor(GraphModel &graph, GraphExecutionState &state,
                             bool verbose)
    : graph_(graph), state_(state), verbose_(verbose) {}

void GraphExecutor::invalidateSubgraphFrom(int seed_node_id) {
  std::vector<int> stack;
  stack.push_back(seed_node_id);
  std::unordered_set<int> visited;
  while (!stack.empty()) {
    const int node_id = stack.back();
    stack.pop_back();
    if (!visited.insert(node_id).second) {
      continue;
    }
    state_.computed_values.erase(node_id);
    const auto nextIt = graph_.outgoing_node_ids.find(node_id);
    if (nextIt == graph_.outgoing_node_ids.end()) {
      continue;
    }
    for (const int next_id : nextIt->second) {
      stack.push_back(next_id);
    }
  }
}

int GraphExecutor::getSocketIndex(const NodeBase &node,
                                  const std::string &socket_id,
                                  bool is_input) const {
  const auto sockets = is_input ? node.getInputs() : node.getOutputs();
  for (size_t i = 0; i < sockets.size(); ++i) {
    if (sockets[i].id == socket_id) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

std::map<std::string, std::any> GraphExecutor::getInputValues(int node_id) {
  std::map<std::string, std::any> inputs;

  auto nodeIt = graph_.nodes.find(node_id);
  if (nodeIt == graph_.nodes.end()) {
    return inputs;
  }
  auto &node = nodeIt->second;
  for (const auto &input : node->getInputs()) {
    inputs[input.id] = input.value;
  }

  const auto incomingIt = graph_.incoming_connection_indices.find(node_id);
  if (incomingIt == graph_.incoming_connection_indices.end()) {
    return inputs;
  }

  for (const size_t connIdx : incomingIt->second) {
      if (connIdx >= graph_.connections.size()) {
        continue;
      }
    auto &conn = graph_.connections[connIdx];
    conn.errorMessage.clear();

  if (state_.computed_values.find(conn.from_node) == state_.computed_values.end()) {
      computeNode(conn.from_node);
    }

    auto sourceIt = state_.computed_values.find(conn.from_node);
    if (sourceIt == state_.computed_values.end()) {
      conn.success = false;
      conn.errorMessage = "Source node has no computed outputs";
      continue;
    }

    auto &source_outputs = sourceIt->second;
    auto outputIt = source_outputs.find(conn.from_socket);
    if (outputIt != source_outputs.end()) {
      inputs[conn.to_socket] = outputIt->second;
      auto fromNodeIt = graph_.nodes.find(conn.from_node);
      if (fromNodeIt != graph_.nodes.end()) {
        conn.success = fromNodeIt->second->success;
        if (!conn.success) {
          conn.errorMessage = fromNodeIt->second->errorMessage.empty()
                                  ? "Source node failed"
                                  : fromNodeIt->second->errorMessage;
        }
      } else {
        conn.success = false;
        conn.errorMessage = "Source node not found";
      }
    } else {
      conn.success = false;
      conn.errorMessage =
          "Missing output value for socket: " + conn.from_socket;
    }
  }

  return inputs;
}

bool GraphExecutor::computeNode(int node_id) {
  if (state_.computed_values.find(node_id) != state_.computed_values.end()) {
    auto it = graph_.nodes.find(node_id);
    return (it != graph_.nodes.end()) ? it->second->success : false;
  }

  auto nodeIt = graph_.nodes.find(node_id);
  if (nodeIt == graph_.nodes.end()) {
    return false;
  }
  auto &node = nodeIt->second;

  auto inputs = getInputValues(node_id);
  const auto properties = node->getProperties();
  const std::size_t signature = buildNodeSignature(*node, inputs, properties);

  auto cacheIt = state_.node_cache.find(node_id);
  if (cacheIt != state_.node_cache.end() && cacheIt->second.signature == signature) {
    node->success = cacheIt->second.success;
    node->errorMessage =
        cacheIt->second.success ? std::string() : cacheIt->second.errorMessage;
    state_.computed_values[node_id] = cacheIt->second.outputs;
    state_.exec_cache_hit_nodes.insert(node_id);
    return node->success;
  }

  std::map<std::string, std::any> outputs;
  node->errorMessage.clear();
  bool success = node->execute(inputs, outputs, properties);

  node->success = success;
  if (success) {
    node->errorMessage.clear();
  }
  state_.node_cache[node_id] = CachedNodeResult{
      signature, std::move(outputs), success,
      success ? std::string() : node->errorMessage};
  state_.computed_values[node_id] = state_.node_cache[node_id].outputs;
  state_.exec_computed_nodes.insert(node_id);

  return success;
}

json GraphExecutor::readOutputPage(int node_id, const std::string &socket_id,
                                   std::size_t offset, std::size_t limit) {
  json result = {{"id", node_id},
                 {"socketId", socket_id},
                 {"offset", offset},
                 {"limit", limit},
                 {"success", false},
                 {"output", nullptr},
                 {"totalCount", 0},
                 {"count", 0},
                 {"hasMore", false},
                 {"paginated", false}};

  auto nodeIt = graph_.nodes.find(node_id);
  if (nodeIt == graph_.nodes.end()) {
    result["error"] = "Node not found";
    return result;
  }
  auto &node = nodeIt->second;

  computeNode(node_id);
  result["success"] = node->success;
  if (!node->success) {
    result["error"] = node->errorMessage.empty() ? "Node execution failed"
                                                 : node->errorMessage;
    return result;
  }

  auto outputsIt = state_.computed_values.find(node_id);
  if (outputsIt == state_.computed_values.end()) {
    result["error"] = "Node has no computed outputs";
    return result;
  }
  auto valueIt = outputsIt->second.find(socket_id);
  if (valueIt == outputsIt->second.end()) {
    result["error"] = "Socket output not found";
    return result;
  }

  json encoded;
  if (!NodeUtils::anyToJson(valueIt->second, encoded)) {
    result["error"] = "Output cannot be serialized";
    return result;
  }

  if (encoded.is_array()) {
    const std::size_t total = encoded.size();
    const std::size_t start = std::min(offset, total);
    const std::size_t end =
        (limit > 0) ? std::min(total, start + limit) : total;
    json page = json::array();
    for (std::size_t i = start; i < end; ++i) {
      page.push_back(encoded[static_cast<json::size_type>(i)]);
    }
    result["output"] = std::move(page);
    result["totalCount"] = total;
    result["count"] = end - start;
    result["hasMore"] = end < total;
    result["paginated"] = true;
    return result;
  }

  result["output"] = encoded;
  return result;
}

json GraphExecutor::execute(const std::unordered_set<int> *focus_nodes) {
  json results = json::object();
  results["nodes"] = json::array();
  results["connections"] = json::array();
  state_.exec_cache_hit_nodes.clear();
  state_.exec_computed_nodes.clear();

  if (verbose_) {
    std::cout << "\n=== Executing Node Graph ===" << std::endl;
  }

  std::vector<int> target_ids;
  target_ids.reserve(graph_.nodes.size());
  if (focus_nodes && !focus_nodes->empty()) {
    for (const auto &[id, _] : graph_.nodes) {
      if (focus_nodes->find(id) != focus_nodes->end()) {
        target_ids.push_back(id);
      }
    }
  } else {
    for (const auto &[id, _] : graph_.nodes) {
      target_ids.push_back(id);
    }
  }

  for (const int id : target_ids) {
    auto nodeIt = graph_.nodes.find(id);
    if (nodeIt == graph_.nodes.end()) {
      continue;
    }
    auto &node = nodeIt->second;
    computeNode(id);

    if (verbose_) {
      std::cout << "Node " << id << " (" << node->getType()
                << "): " << (node->success ? "SUCCESS" : "FAILED");
      if (!node->success) {
        std::cout << " - " << node->errorMessage;
      }
      std::cout << std::endl;
    }

    json nodeResult = node->toJson();
    nodeResult["name"] = node->getName();

    if (state_.computed_values.find(id) != state_.computed_values.end()) {
      json outputs = json::object();
      auto &node_outputs = state_.computed_values[id];

      for (const auto &[socket_id, value] : node_outputs) {
        json encoded;
        if (NodeUtils::anyToJson(value, encoded)) {
          outputs[socket_id] = encoded;
        } else {
          outputs[socket_id] = "<computed>";
        }
      }

      if (!outputs.empty()) {
        nodeResult["outputs"] = outputs;
      }
    }

    results["nodes"].push_back(nodeResult);
  }

  for (const auto &conn : graph_.connections) {
    if (focus_nodes && !focus_nodes->empty()) {
      const bool fromFocused =
          (focus_nodes->find(conn.from_node) != focus_nodes->end());
      const bool toFocused =
          (focus_nodes->find(conn.to_node) != focus_nodes->end());
      if (!fromFocused && !toFocused) {
        continue;
      }
    }
    json connResult = {{"from_node", conn.from_node},
                       {"from_socket", conn.from_socket},
                       {"to_node", conn.to_node},
                       {"to_socket", conn.to_socket},
                       {"success", conn.success}};
    auto fromIt = graph_.nodes.find(conn.from_node);
    auto toIt = graph_.nodes.find(conn.to_node);
    if (fromIt != graph_.nodes.end()) {
      connResult["from_node_name"] = fromIt->second->getName();
      connResult["from_socket_index"] =
          getSocketIndex(*fromIt->second, conn.from_socket, false);
    }
    if (toIt != graph_.nodes.end()) {
      connResult["to_node_name"] = toIt->second->getName();
      connResult["to_socket_index"] =
          getSocketIndex(*toIt->second, conn.to_socket, true);
    }
    if (!conn.success && !conn.errorMessage.empty()) {
      connResult["error"] = conn.errorMessage;
    }
    results["connections"].push_back(connResult);
  }

  if (verbose_) {
    std::cout << "=== Execution Complete ===" << std::endl;
  }

  json stats = json::object();
  stats["computedNodeCount"] = state_.exec_computed_nodes.size();
  stats["cacheHitNodeCount"] = state_.exec_cache_hit_nodes.size();
  stats["totalTouchedNodeCount"] =
      state_.exec_computed_nodes.size() + state_.exec_cache_hit_nodes.size();
  stats["computedNodes"] = json::array();
  for (const int id : state_.exec_computed_nodes) {
    stats["computedNodes"].push_back(id);
  }
  stats["cacheHitNodes"] = json::array();
  for (const int id : state_.exec_cache_hit_nodes) {
    stats["cacheHitNodes"].push_back(id);
  }
  results["execution_stats"] = std::move(stats);

  return results;
}

json GraphExecutor::executeDelta(
    const std::unordered_set<int> *focus_nodes, bool omit_outputs,
    std::size_t max_preview_items,
    const std::unordered_set<int> *output_node_ids,
    const std::unordered_map<int, std::unordered_set<std::string>>
        *output_socket_ids) {
  json results = json::object();
  results["node_deltas"] = json::array();
  results["connection_deltas"] = json::array();
  state_.exec_cache_hit_nodes.clear();
  state_.exec_computed_nodes.clear();

  std::vector<int> target_ids;
  target_ids.reserve(graph_.nodes.size());
  if ((focus_nodes && !focus_nodes->empty()) ||
      (output_node_ids && !output_node_ids->empty())) {
    for (const auto &[id, _] : graph_.nodes) {
      const bool inFocus =
          focus_nodes && !focus_nodes->empty() &&
          (focus_nodes->find(id) != focus_nodes->end());
      const bool requestedOutput =
          output_node_ids && !output_node_ids->empty() &&
          (output_node_ids->find(id) != output_node_ids->end());
      if (inFocus || requestedOutput) {
        target_ids.push_back(id);
      }
    }
  } else {
    for (const auto &[id, _] : graph_.nodes) {
      target_ids.push_back(id);
    }
  }

  for (const int id : target_ids) {
    auto nodeIt = graph_.nodes.find(id);
    if (nodeIt == graph_.nodes.end()) {
      continue;
    }
    auto &node = nodeIt->second;
    computeNode(id);

    json nodeDelta = {{"id", id},
                      {"success", node->success},
                      {"error", node->errorMessage.empty() ? "" : node->errorMessage},
                      {"outputs", json::object()}};
    bool includeOutputs = !omit_outputs;
    if (output_node_ids && !output_node_ids->empty()) {
      includeOutputs = (output_node_ids->find(id) != output_node_ids->end());
    }
    const std::unordered_set<std::string> *socketFilter = nullptr;
    if (output_socket_ids) {
      auto filterIt = output_socket_ids->find(id);
      if (filterIt != output_socket_ids->end() && !filterIt->second.empty()) {
        includeOutputs = true;
        socketFilter = &filterIt->second;
      }
    }
    if (!includeOutputs) {
      nodeDelta["outputs_omitted"] = true;
      results["node_deltas"].push_back(std::move(nodeDelta));
      continue;
    }

    auto outputsIt = state_.computed_values.find(id);
    if (outputsIt != state_.computed_values.end()) {
      bool anyTruncated = false;
      for (const auto &[socket_id, value] : outputsIt->second) {
        if (socketFilter && socketFilter->find(socket_id) == socketFilter->end()) {
          continue;
        }
        json encoded;
        if (NodeUtils::anyToJson(value, encoded)) {
          if (max_preview_items > 0 && encoded.is_array()) {
            nodeDelta["outputs"][socket_id] =
                OutputTransport::makePagedArrayDescriptor(socket_id, encoded,
                                                          max_preview_items);
            anyTruncated = true;
            continue;
          }
          nodeDelta["outputs"][socket_id] = encoded;
        } else {
          nodeDelta["outputs"][socket_id] = "<computed>";
        }
      }
      if (anyTruncated) {
        nodeDelta["outputs_truncated"] = true;
        nodeDelta["max_preview_items"] = max_preview_items;
      }
    }
    results["node_deltas"].push_back(std::move(nodeDelta));
  }

  for (const auto &conn : graph_.connections) {
    if (focus_nodes && !focus_nodes->empty()) {
      const bool fromFocused =
          (focus_nodes->find(conn.from_node) != focus_nodes->end());
      const bool toFocused =
          (focus_nodes->find(conn.to_node) != focus_nodes->end());
      if (!fromFocused && !toFocused) {
        continue;
      }
    }
    json connResult = {{"from_node", conn.from_node},
                       {"from_socket", conn.from_socket},
                       {"to_node", conn.to_node},
                       {"to_socket", conn.to_socket},
                       {"success", conn.success}};
    auto fromIt = graph_.nodes.find(conn.from_node);
    auto toIt = graph_.nodes.find(conn.to_node);
    if (fromIt != graph_.nodes.end()) {
      connResult["from_node_name"] = fromIt->second->getName();
      connResult["from_socket_index"] =
          getSocketIndex(*fromIt->second, conn.from_socket, false);
    }
    if (toIt != graph_.nodes.end()) {
      connResult["to_node_name"] = toIt->second->getName();
      connResult["to_socket_index"] =
          getSocketIndex(*toIt->second, conn.to_socket, true);
    }
    if (!conn.success && !conn.errorMessage.empty()) {
      connResult["error"] = conn.errorMessage;
    }
    results["connection_deltas"].push_back(std::move(connResult));
  }

  json stats = json::object();
  stats["computedNodeCount"] = state_.exec_computed_nodes.size();
  stats["cacheHitNodeCount"] = state_.exec_cache_hit_nodes.size();
  stats["totalTouchedNodeCount"] =
      state_.exec_computed_nodes.size() + state_.exec_cache_hit_nodes.size();
  stats["computedNodes"] = json::array();
  for (const int id : state_.exec_computed_nodes) {
    stats["computedNodes"].push_back(id);
  }
  stats["cacheHitNodes"] = json::array();
  for (const int id : state_.exec_cache_hit_nodes) {
    stats["cacheHitNodes"].push_back(id);
  }
  results["execution_stats"] = std::move(stats);
  return results;
}
