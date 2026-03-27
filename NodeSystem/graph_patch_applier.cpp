#include "graph_patch_applier.h"

#include "patch_semantics.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <unordered_set>

namespace {
bool envFlagEnabled(const char *name) {
#ifdef _MSC_VER
  char *buffer = nullptr;
  size_t len = 0;
  if (_dupenv_s(&buffer, &len, name) != 0 || buffer == nullptr) {
    return false;
  }
  const std::string value(buffer);
  free(buffer);
  return value == "1";
#else
  const char *value = std::getenv(name);
  return value != nullptr && std::string(value) == "1";
#endif
}
} // namespace

GraphPatchApplier::GraphPatchApplier(
    GraphModel &graph, std::function<void(int)> invalidate_subgraph)
    : graph_(graph), invalidate_subgraph_(std::move(invalidate_subgraph)) {}

json GraphPatchApplier::anyToJsonOrObject(const std::any &value) {
  json out = json::object();
  if (NodeUtils::anyToJson(value, out) && out.is_object()) {
    return out;
  }
  return json::object();
}

bool GraphPatchApplier::normalizeInteractionEvent(const json &raw,
                                                  int fallback_node_id,
                                                  json &out_event,
                                                  std::string &err) {
  if (!raw.is_object()) {
    err = "interaction_event value must be an object";
    return false;
  }
  const std::string channel = [&]() {
    if (raw.contains("channel") && raw["channel"].is_string()) {
      const auto s = raw["channel"].get<std::string>();
      if (!s.empty()) {
        return s;
      }
    }
    return std::string("viewer");
  }();
  std::string phase = "update";
  if (raw.contains("phase") && raw["phase"].is_string()) {
    std::string p = raw["phase"].get<std::string>();
    std::transform(p.begin(), p.end(), p.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    if (p == "begin" || p == "update" || p == "commit" || p == "cancel") {
      phase = p;
    }
  }
  const int target_node_id = (raw.contains("targetNodeId") &&
                              raw["targetNodeId"].is_number_integer())
                                 ? raw["targetNodeId"].get<int>()
                                 : fallback_node_id;
  int source_node_id = fallback_node_id;
  if (raw.contains("sourceNodeId") && raw["sourceNodeId"].is_number_integer()) {
    source_node_id = raw["sourceNodeId"].get<int>();
  } else if (raw.contains("payload") && raw["payload"].is_object() &&
             raw["payload"].contains("sourceViewerNodeId") &&
             raw["payload"]["sourceViewerNodeId"].is_number_integer()) {
    source_node_id = raw["payload"]["sourceViewerNodeId"].get<int>();
  }
  const std::int64_t now_ms = static_cast<std::int64_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
  std::int64_t version = now_ms;
  if (raw.contains("version") && raw["version"].is_number_integer()) {
    version = std::max<std::int64_t>(0, raw["version"].get<std::int64_t>());
  }
  std::string source = "webui";
  if (raw.contains("source") && raw["source"].is_string() &&
      !raw["source"].get<std::string>().empty()) {
    source = raw["source"].get<std::string>();
  }
  out_event = json::object();
  out_event["channel"] = channel;
  out_event["phase"] = phase;
  out_event["sourceNodeId"] = source_node_id;
  out_event["targetNodeId"] = target_node_id;
  out_event["version"] = version;
  out_event["source"] = source;
  out_event["timestampMs"] =
      (raw.contains("timestampMs") && raw["timestampMs"].is_number_integer())
          ? std::max<std::int64_t>(0, raw["timestampMs"].get<std::int64_t>())
          : now_ms;
  out_event["ts"] = out_event["timestampMs"];
  out_event["payload"] = (raw.contains("payload") && raw["payload"].is_object())
                             ? raw["payload"]
                             : json::object();
  return true;
}

void GraphPatchApplier::mergeInteractionEventIntoProps(
    std::map<std::string, std::any> &props, const json &event) {
  json state = json::object();
  auto it = props.find("interaction_state");
  if (it != props.end()) {
    state = anyToJsonOrObject(it->second);
  }
  if (!state.is_object()) {
    state = json::object();
  }
  if (!state.contains("channels") || !state["channels"].is_object()) {
    state["channels"] = json::object();
  }
  const std::string channel = event.value("channel", "viewer");
  if (!state["channels"].contains(channel) ||
      !state["channels"][channel].is_object()) {
    state["channels"][channel] = json::object();
  }
  json &channel_state = state["channels"][channel];
  const std::string phase = event.value("phase", "update");
  const json payload = event.value("payload", json::object());
  channel_state["version"] = event.value("version", 0);
  channel_state["phase"] = phase;
  channel_state["source"] = event.value("source", "webui");
  channel_state["sourceNodeId"] = event.value("sourceNodeId", -1);
  channel_state["targetNodeId"] = event.value("targetNodeId", -1);
  channel_state["timestampMs"] = event.value("timestampMs", 0);
  channel_state["lastEvent"] = event;
  if (phase == "begin" || phase == "update") {
    channel_state["transient"] = payload;
    channel_state["payload"] = payload;
  } else if (phase == "commit") {
    channel_state["committed"] = payload;
    channel_state["payload"] = payload;
    channel_state["transient"] = json::object();
  } else if (phase == "cancel") {
    channel_state["transient"] = json::object();
  }
  state["lastChannel"] = channel;
  state["lastVersion"] = event.value("version", 0);
  state["lastPhase"] = phase;
  state["timestampMs"] = event.value("timestampMs", 0);
  state["ts"] = state["timestampMs"];
  props["interaction_state"] = GraphModel::jsonToAny(state);
  props["interaction_event"] = GraphModel::jsonToAny(event);
}

bool GraphPatchApplier::applyPatch(const json &patch, std::string &err) {
  if (!patch.is_object()) {
    err = "Patch must be an object";
    return false;
  }
  const std::string op = patch.value("op", "");
  if (op.empty()) {
    err = "Patch op is required";
    return false;
  }

  if (classifyPatchOp(op) == PatchKind::NodeState) {
    if (!patch.contains("nodeId") || !patch["nodeId"].is_number_integer()) {
      err = "Patch nodeId is required";
      return false;
    }
    const int node_id = patch["nodeId"].get<int>();
    auto nodeIt = graph_.nodes.find(node_id);
    if (nodeIt == graph_.nodes.end()) {
      err = "Node not found: " + std::to_string(node_id);
      return false;
    }
    const std::string key = patch.value("key", "");
    if (key.empty()) {
      err = "Patch key is required";
      return false;
    }
    auto props = nodeIt->second->getProperties();
    if (op == "viewer_interaction") {
      json rawEvent = json::object();
      if (key == "interaction_event") {
        if (!patch.contains("value")) {
          err = "interaction_event patch missing value";
          return false;
        }
        rawEvent = patch["value"];
      } else {
        static std::size_t legacy_patch_count = 0;
        legacy_patch_count += 1;
        if (envFlagEnabled("INTERACTION_DEBUG") &&
            (legacy_patch_count <= 5 || legacy_patch_count % 100 == 0)) {
          std::cerr << "[interaction][deprecated] legacy viewer_interaction "
                    << "key=\"" << key
                    << "\" normalized to interaction_event count="
                    << legacy_patch_count << std::endl;
        }
        rawEvent["channel"] =
            (patch.contains("channel") && patch["channel"].is_string())
                ? patch["channel"].get<std::string>()
                : "viewer";
        rawEvent["phase"] =
            (patch.contains("phase") && patch["phase"].is_string())
                ? patch["phase"].get<std::string>()
                : "update";
        rawEvent["sourceNodeId"] = node_id;
        rawEvent["targetNodeId"] = node_id;
        rawEvent["version"] = static_cast<std::int64_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch())
                .count());
        rawEvent["source"] = "webui-legacy";
        rawEvent["payload"] = json::object(
            {{"sourceViewerNodeId", node_id},
             {"action", key},
             {"value", patch.contains("value") ? patch["value"] : json()}});
      }
      json eventJson;
      if (!normalizeInteractionEvent(rawEvent, node_id, eventJson, err)) {
        return false;
      }
      mergeInteractionEventIntoProps(props, eventJson);
      for (const auto &conn : graph_.connections) {
        if (conn.from_node != node_id || conn.from_socket != "interaction") {
          continue;
        }
        auto dstIt = graph_.nodes.find(conn.to_node);
        if (dstIt == graph_.nodes.end()) {
          continue;
        }
        auto dstProps = dstIt->second->getProperties();
        mergeInteractionEventIntoProps(dstProps, eventJson);
        dstIt->second->setProperties(dstProps);
      }
    } else if (patch.contains("value")) {
      props[key] = GraphModel::jsonToAny(patch["value"]);
    } else {
      props.erase(key);
    }
    nodeIt->second->setProperties(props);
    invalidate_subgraph_(node_id);
    return true;
  }

  if (op == "add_node") {
    if (!patch.contains("node") || !patch["node"].is_object()) {
      err = "Invalid add_node patch: missing node";
      return false;
    }
    const json &node_data = patch["node"];
    if (!node_data.contains("id") || !node_data["id"].is_number_integer()) {
      err = "Invalid add_node patch: node.id is required";
      return false;
    }
    if (!node_data.contains("type") || !node_data["type"].is_string()) {
      err = "Invalid add_node patch: node.type is required";
      return false;
    }
    const int id = node_data["id"].get<int>();
    if (graph_.nodes.find(id) != graph_.nodes.end()) {
      err = "add_node id already exists: " + std::to_string(id);
      return false;
    }
    const std::string type = node_data["type"].get<std::string>();
    auto node = NodeFactory::instance().createNode(type);
    if (!node) {
      err = "Unknown node type: " + type;
      return false;
    }
    node->id = id;
    node->fromJson(node_data);
    const auto default_props = node->getProperties();
    auto supportsProp = [&default_props](const std::string &key) {
      return default_props.find(key) != default_props.end();
    };
    std::map<std::string, std::any> props;
    if (node_data.contains("properties") && node_data["properties"].is_object()) {
      for (const auto &[k, v] : node_data["properties"].items()) {
        if (!supportsProp(k)) {
          continue;
        }
        props[k] = GraphModel::jsonToAny(v);
      }
    }
    if (node_data.contains("value") && supportsProp("value")) {
      props["value"] = GraphModel::jsonToAny(node_data["value"]);
    }
    if (node_data.contains("operation") && supportsProp("operation")) {
      props["operation"] = GraphModel::jsonToAny(node_data["operation"]);
    }
    if (node_data.contains("label") && supportsProp("label")) {
      props["label"] = GraphModel::jsonToAny(node_data["label"]);
    }
    if (node_data.contains("text") && supportsProp("text")) {
      props["text"] = GraphModel::jsonToAny(node_data["text"]);
    }
    if (node_data.contains("values") && supportsProp("values")) {
      props["values"] = GraphModel::jsonToAny(node_data["values"]);
    }
    node->setProperties(props);
    graph_.nodes[id] = std::move(node);
    invalidate_subgraph_(id);
    return true;
  }

  if (op == "add_connection") {
    if (!patch.contains("from_node") || !patch.contains("to_node") ||
        !patch.contains("from_socket") || !patch.contains("to_socket")) {
      err = "Invalid add_connection patch";
      return false;
    }
    GraphConnection conn;
    conn.from_node = patch["from_node"].get<int>();
    conn.to_node = patch["to_node"].get<int>();
    conn.from_socket = patch["from_socket"].get<std::string>();
    conn.to_socket = patch["to_socket"].get<std::string>();
    conn.success = true;
    conn.errorMessage.clear();
    graph_.connections.push_back(conn);
    graph_.rebuildIncomingConnectionIndices();
    invalidate_subgraph_(conn.to_node);
    return true;
  }

  if (op == "remove_node") {
    if (!patch.contains("nodeId") || !patch["nodeId"].is_number_integer()) {
      err = "Invalid remove_node patch: nodeId is required";
      return false;
    }
    const int node_id = patch["nodeId"].get<int>();
    auto nodeIt = graph_.nodes.find(node_id);
    if (nodeIt == graph_.nodes.end()) {
      err = "Node not found: " + std::to_string(node_id);
      return false;
    }

    std::unordered_set<int> downstream_ids;
    graph_.connections.erase(
        std::remove_if(graph_.connections.begin(), graph_.connections.end(),
                       [&](const GraphConnection &c) {
                         const bool touches =
                             c.from_node == node_id || c.to_node == node_id;
                         if (touches && c.from_node == node_id &&
                             c.to_node != node_id) {
                           downstream_ids.insert(c.to_node);
                         }
                         return touches;
                       }),
        graph_.connections.end());
    graph_.nodes.erase(nodeIt);
    graph_.rebuildIncomingConnectionIndices();
    for (const int downstream_id : downstream_ids) {
      invalidate_subgraph_(downstream_id);
    }
    return true;
  }

  if (op == "remove_connection") {
    if (!patch.contains("from_node") || !patch.contains("to_node") ||
        !patch.contains("from_socket") || !patch.contains("to_socket")) {
      err = "Invalid remove_connection patch";
      return false;
    }
    const int from_node = patch["from_node"].get<int>();
    const int to_node = patch["to_node"].get<int>();
    const std::string from_socket = patch["from_socket"].get<std::string>();
    const std::string to_socket = patch["to_socket"].get<std::string>();
    graph_.connections.erase(
        std::remove_if(graph_.connections.begin(), graph_.connections.end(),
                       [&](const GraphConnection &c) {
                         return c.from_node == from_node &&
                                c.to_node == to_node &&
                                c.from_socket == from_socket &&
                                c.to_socket == to_socket;
                       }),
        graph_.connections.end());
    graph_.rebuildIncomingConnectionIndices();
    invalidate_subgraph_(to_node);
    return true;
  }

  if (classifyPatchOp(op) == PatchKind::LayoutOnly) {
    return true;
  }

  err = "Unsupported patch op: " + op;
  return false;
}

bool GraphPatchApplier::applyPatches(const json &patches, std::string &err) {
  if (!patches.is_array()) {
    err = "Patches must be an array";
    return false;
  }
  for (const auto &p : patches) {
    if (!applyPatch(p, err)) {
      return false;
    }
  }
  return true;
}
