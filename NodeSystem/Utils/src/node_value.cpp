#include "node_value.h"
#include <stdexcept>

std::string node_value::getType() const { return "value"; }
std::string node_value::getName() const { return "Value"; }
std::string node_value::getCategory() const { return "Input"; }
std::string node_value::getDescription() const { return "Numeric value input"; }

std::vector<Socket> node_value::getInputs() const { return {}; }

std::vector<Socket> node_value::getOutputs() const {
  return {{"out", "Value", DataType::NUMBER, value}};
}

std::map<std::string, std::any> node_value::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"value", value}};
}

std::map<std::string, std::vector<std::string>>
node_value::getPropertyOptions() const {
  return {};
}

NodeSchema node_value::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#dd6b20";
  auto valueIt = schema.properties.find("value");
  if (valueIt != schema.properties.end()) {
    valueIt->second.type = "number";
    valueIt->second.editor = "number";
    valueIt->second.description =
        "Constant numeric value emitted by this node.";
  }
  return schema;
}

bool node_value::execute(const std::map<std::string, std::any> & /*inputs*/,
                         std::map<std::string, std::any> &outputs,
                         const std::map<std::string, std::any> &properties) {
  try {
    const auto &raw = properties.at("value");
    if (raw.type() == typeid(double)) {
      value = std::any_cast<double>(raw);
    } else if (raw.type() == typeid(int)) {
      value = static_cast<double>(std::any_cast<int>(raw));
    } else if (raw.type() == typeid(std::string)) {
      const auto text = std::any_cast<std::string>(raw);
      if (text.empty() || text == "null") {
        throw std::runtime_error("empty/null string");
      }
      size_t pos = 0;
      value = std::stod(text, &pos);
      if (pos != text.size()) {
        throw std::runtime_error("non-numeric characters");
      }
    } else {
      throw std::runtime_error("unsupported value type");
    }
    outputs["out"] = value;
    return true;
  } catch (const std::exception &e) {
    errorMessage =
        std::string("Invalid value: must be a number (") + e.what() + ")";
    return false;
  }
}

std::string node_value_math::getType() const { return "value_math"; }
std::string node_value_math::getName() const { return "Value Math"; }
std::string node_value_math::getCategory() const { return "Operation"; }
std::string node_value_math::getDescription() const {
  return "Value operations";
}

std::vector<Socket> node_value_math::getInputs() const {
  return {{"a", "A", DataType::NUMBER, 0.0}, {"b", "B", DataType::NUMBER, 0.0}};
}

std::vector<Socket> node_value_math::getOutputs() const {
  return {{"result", "Result", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> node_value_math::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("add")}};
}

std::map<std::string, std::vector<std::string>>
node_value_math::getPropertyOptions() const {
  return {{"operation", {"add", "subtract", "multiply", "divide"}}};
}

NodeSchema node_value_math::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Arithmetic operation applied to inputs A and B.";
  }
  return schema;
}

bool node_value_math::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    double a = NodeUtils::getValue<double>(inputs.at("a"), 0.0);
    double b = NodeUtils::getValue<double>(inputs.at("b"), 0.0);
    std::string op =
        NodeUtils::getValue<std::string>(properties.at("operation"), "add");

    double result = 0.0;

    if (op == "add") {
      result = a + b;
    } else if (op == "subtract") {
      result = a - b;
    } else if (op == "multiply") {
      result = a * b;
    } else if (op == "divide") {
      if (b == 0.0) {
        errorMessage = "Division by zero";
        return false;
      }
      result = a / b;
    } else {
      errorMessage = "Unknown operation: " + op;
      return false;
    }

    outputs["result"] = result;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Value math node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_value> node_value_registrar;
NodeRegistrar<node_value_math> node_value_math_registrar;
} // namespace
