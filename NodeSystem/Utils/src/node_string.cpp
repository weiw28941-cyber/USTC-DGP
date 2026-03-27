#include "node_string.h"

std::string node_string::getType() const { return "string"; }
std::string node_string::getName() const { return "String"; }
std::string node_string::getCategory() const { return "Input"; }
std::string node_string::getDescription() const {
  return "Editable string input";
}

std::vector<Socket> node_string::getInputs() const { return {}; }

std::vector<Socket> node_string::getOutputs() const {
  return {{"text", "Text", DataType::STRING, std::string("")}};
}

std::map<std::string, std::any> node_string::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"text", std::string("")}};
}

NodeSchema node_string::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#c05621";
  auto textIt = schema.properties.find("text");
  if (textIt != schema.properties.end()) {
    textIt->second.type = "string";
    textIt->second.editor = "text";
    textIt->second.description = "Editable text emitted by this node.";
  }
  return schema;
}

bool node_string::execute(const std::map<std::string, std::any> & /*inputs*/,
                          std::map<std::string, std::any> &outputs,
                          const std::map<std::string, std::any> &properties) {
  try {
    const std::string text =
        NodeUtils::getValue<std::string>(properties.at("text"), "");
    outputs["text"] = text;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("String node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_string> node_string_registrar;
}
