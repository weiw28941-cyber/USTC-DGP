#pragma once

#include "json.hpp"

#include <map>
#include <string>
#include <vector>

using json = nlohmann::json;

struct SocketSchema {
  std::string id;
  std::string label;
  std::string type;
  std::string customType;
};

struct PropertySchema {
  std::string type = "string";
  json defaultValue = "";
  bool editable = true;
  std::vector<std::string> options;
  std::string editor;
  std::string description;
};

struct NodeSchema {
  std::string id;
  std::string name;
  std::string category;
  std::string description;
  std::string color = "#4a90e2";
  std::vector<SocketSchema> inputs;
  std::vector<SocketSchema> outputs;
  std::map<std::string, PropertySchema> properties;
};
