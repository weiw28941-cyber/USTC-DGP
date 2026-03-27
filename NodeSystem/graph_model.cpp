#include "graph_model.h"

#include <iostream>

void GraphModel::loadFromJson(const json &data) {
  nodes.clear();
  connections.clear();
  incoming_connection_indices.clear();
  outgoing_node_ids.clear();

  for (const auto &node_data : data["nodes"]) {
    int id = node_data["id"];
    std::string type = node_data["type"];

    auto node = NodeFactory::instance().createNode(type);
    if (!node) {
      std::cerr << "Warning: Unknown node type '" << type << "'" << std::endl;
      continue;
    }

    node->id = id;
    node->fromJson(node_data);
    const auto default_props = node->getProperties();
    auto supportsProp = [&default_props](const std::string &key) {
      return default_props.find(key) != default_props.end();
    };

    std::map<std::string, std::any> props;
    if (node_data.contains("value") && supportsProp("value")) {
      if (node_data["value"].is_number()) {
        props["value"] = node_data["value"].get<double>();
      } else if (node_data["value"].is_string()) {
        props["value"] = node_data["value"].get<std::string>();
      } else {
        props["value"] = node_data["value"].dump();
      }
    }
    if (node_data.contains("operation") && supportsProp("operation")) {
      props["operation"] = node_data["operation"].get<std::string>();
    }
    if (node_data.contains("label") && supportsProp("label")) {
      props["label"] = node_data["label"].get<std::string>();
    }
    if (node_data.contains("text") && supportsProp("text")) {
      props["text"] = node_data["text"].get<std::string>();
    }
    if (node_data.contains("values") && supportsProp("values")) {
      if (node_data["values"].is_array()) {
        std::vector<double> values;
        std::vector<std::string> textValues;
        bool hasString = false;
        for (const auto &item : node_data["values"]) {
          if (item.is_number()) {
            values.push_back(item.get<double>());
            if (hasString) {
              textValues.push_back(std::to_string(item.get<double>()));
            }
          } else if (item.is_string()) {
            if (!hasString) {
              hasString = true;
              textValues.reserve(values.size() + 1);
              for (double v : values) {
                textValues.push_back(std::to_string(v));
              }
            }
            textValues.push_back(item.get<std::string>());
          }
        }
        if (hasString) {
          props["values"] = textValues;
        } else {
          props["values"] = values;
        }
      } else if (node_data["values"].is_string()) {
        props["values"] = node_data["values"].get<std::string>();
      }
    }
    if (node_data.contains("properties") && node_data["properties"].is_object()) {
      for (auto it = node_data["properties"].begin();
           it != node_data["properties"].end(); ++it) {
        const std::string key = it.key();
        if (!supportsProp(key)) {
          continue;
        }
        props[key] = jsonToAny(it.value());
      }
    }

    node->setProperties(props);
    nodes[id] = std::move(node);
  }

  for (const auto &conn_data : data["connections"]) {
    GraphConnection conn;
    conn.from_node = conn_data["from_node"];
    conn.from_socket = conn_data["from_socket"];
    conn.to_node = conn_data["to_node"];
    conn.to_socket = conn_data["to_socket"];
    conn.success = true;
    conn.errorMessage.clear();
    connections.push_back(conn);
  }

  rebuildIncomingConnectionIndices();
}

std::any GraphModel::jsonToAny(const json &j) {
  if (j.is_null()) {
    return std::any{};
  }
  if (j.is_boolean()) {
    return j.get<bool>();
  }
  if (j.is_number_integer()) {
    return j.get<int>();
  }
  if (j.is_number_unsigned()) {
    return static_cast<int>(j.get<unsigned int>());
  }
  if (j.is_number_float()) {
    return j.get<double>();
  }
  if (j.is_string()) {
    return j.get<std::string>();
  }
  if (j.is_array()) {
    bool all_number = true;
    bool all_int = true;
    bool all_string = true;
    for (const auto &item : j) {
      all_number = all_number && item.is_number();
      all_int = all_int && item.is_number_integer();
      all_string = all_string && item.is_string();
    }
    if (all_int) {
      std::vector<int> out;
      out.reserve(j.size());
      for (const auto &item : j) {
        out.push_back(item.get<int>());
      }
      return out;
    }
    if (all_number) {
      std::vector<double> out;
      out.reserve(j.size());
      for (const auto &item : j) {
        out.push_back(item.get<double>());
      }
      return out;
    }
    if (all_string) {
      std::vector<std::string> out;
      out.reserve(j.size());
      for (const auto &item : j) {
        out.push_back(item.get<std::string>());
      }
      return out;
    }
  }
  if (j.is_object()) {
    return j;
  }
  return j.dump();
}

void GraphModel::rebuildIncomingConnectionIndices() {
  incoming_connection_indices.clear();
  outgoing_node_ids.clear();
  for (size_t i = 0; i < connections.size(); ++i) {
    incoming_connection_indices[connections[i].to_node].push_back(i);
    outgoing_node_ids[connections[i].from_node].push_back(connections[i].to_node);
  }
}

void GraphModel::printGraph(bool verbose) const {
  if (!verbose) {
    return;
  }
  std::cout << "\n=== Node Graph Structure ===" << std::endl;
  std::cout << "\nNodes:" << std::endl;
  for (const auto &[id, node] : nodes) {
    std::cout << "  Node " << id << ": " << node->getType() << " ("
              << node->getName() << ")" << std::endl;
  }

  std::cout << "\nConnections:" << std::endl;
  for (const auto &conn : connections) {
    std::cout << "  Node " << conn.from_node << "." << conn.from_socket
              << " -> Node " << conn.to_node << "." << conn.to_socket
              << std::endl;
  }
  std::cout << std::endl;
}
