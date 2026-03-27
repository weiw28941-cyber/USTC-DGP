#include "node_list.h"
#include <numeric>

std::string node_list::getType() const { return "list"; }
std::string node_list::getName() const { return "List"; }
std::string node_list::getCategory() const { return "Data"; }
std::string node_list::getDescription() const { return "List operations"; }

std::vector<Socket> node_list::getInputs() const {
  std::string op = "number";
  auto opIt = properties_.find("operation");
  if (opIt != properties_.end() && opIt->second.type() == typeid(std::string)) {
    op = std::any_cast<std::string>(opIt->second);
  }

  const bool stringMode = (op == "string");
  std::vector<double> values;
  std::vector<std::string> texts;
  auto it = properties_.find("values");
  if (it != properties_.end()) {
    const auto &raw = it->second;
    if (raw.type() == typeid(std::vector<double>)) {
      const auto nums = std::any_cast<std::vector<double>>(raw);
      if (stringMode) {
        texts.reserve(nums.size());
        for (double v : nums) {
          texts.push_back(std::to_string(v));
        }
      } else {
        values = nums;
      }
    } else if (raw.type() == typeid(std::vector<int>)) {
      const auto ints = std::any_cast<std::vector<int>>(raw);
      if (stringMode) {
        texts.reserve(ints.size());
        for (int v : ints) {
          texts.push_back(std::to_string(v));
        }
      } else {
        values.assign(ints.begin(), ints.end());
      }
    } else if (raw.type() == typeid(std::vector<std::string>)) {
      const auto rawTexts = std::any_cast<std::vector<std::string>>(raw);
      if (stringMode) {
        texts = rawTexts;
      } else {
        for (const auto &item : rawTexts) {
          try {
            values.push_back(std::stod(item));
          } catch (...) {
          }
        }
      }
    } else if (raw.type() == typeid(std::string)) {
      const auto text = std::any_cast<std::string>(raw);
      std::stringstream ss(text);
      std::string item;
      while (std::getline(ss, item, ',')) {
        if (stringMode) {
          texts.push_back(item);
        } else {
          try {
            values.push_back(std::stod(item));
          } catch (...) {
          }
        }
      }
    }
  }

  std::vector<Socket> inputs;
  const size_t count = stringMode ? texts.size() : values.size();
  inputs.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    const std::string id = "e" + std::to_string(i);
    const std::string label = "E" + std::to_string(i);
    if (stringMode) {
      inputs.push_back({id, label, DataType::STRING, texts[i]});
    } else {
      inputs.push_back({id, label, DataType::NUMBER, values[i]});
    }
  }
  return inputs;
}

std::vector<Socket> node_list::getOutputs() const {
  return {{"list", "List", DataType::LIST, std::vector<double>()}};
}

std::map<std::string, std::any> node_list::getProperties() const {
  std::map<std::string, std::any> props = {
      {"values", std::string("1,2,3,4,5")},
      {"operation", std::string("number")}};
  if (!properties_.empty()) {
    for (const auto &entry : properties_) {
      props[entry.first] = entry.second;
    }
  }
  return props;
}

std::map<std::string, std::vector<std::string>>
node_list::getPropertyOptions() const {
  return {{"operation", {"number", "string"}}};
}

NodeSchema node_list::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#3182ce";
  auto valuesIt = schema.properties.find("values");
  if (valuesIt != schema.properties.end()) {
    valuesIt->second.editor = "text";
    valuesIt->second.description =
        "Comma-separated list contents or explicit array input.";
  }
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Interpret list elements as numbers or strings.";
  }
  return schema;
}

bool node_list::execute(const std::map<std::string, std::any> &inputs,
                        std::map<std::string, std::any> &outputs,
                        const std::map<std::string, std::any> &properties) {
  try {
    std::string op =
        NodeUtils::getValue<std::string>(properties.at("operation"), "number");
    const bool stringMode = (op == "string");

    std::vector<double> list;
    std::vector<std::string> texts;

    auto it = properties.find("values");
    if (it != properties.end()) {
      const auto &raw = it->second;
      if (raw.type() == typeid(std::vector<double>)) {
        const auto nums = std::any_cast<std::vector<double>>(raw);
        if (stringMode) {
          texts.reserve(nums.size());
          for (double v : nums) {
            texts.push_back(std::to_string(v));
          }
        } else {
          list = nums;
        }
      } else if (raw.type() == typeid(std::vector<int>)) {
        const auto ints = std::any_cast<std::vector<int>>(raw);
        if (stringMode) {
          texts.reserve(ints.size());
          for (int v : ints) {
            texts.push_back(std::to_string(v));
          }
        } else {
          list.assign(ints.begin(), ints.end());
        }
      } else if (raw.type() == typeid(std::vector<std::string>)) {
        const auto rawTexts = std::any_cast<std::vector<std::string>>(raw);
        if (stringMode) {
          texts = rawTexts;
        } else {
          for (const auto &item : rawTexts) {
            try {
              list.push_back(std::stod(item));
            } catch (...) {
            }
          }
        }
      } else {
        const std::string valuesStr = NodeUtils::getValue<std::string>(raw, "");
        std::stringstream ss(valuesStr);
        std::string item;
        while (std::getline(ss, item, ',')) {
          if (stringMode) {
            texts.push_back(item);
          } else {
            try {
              list.push_back(std::stod(item));
            } catch (...) {
            }
          }
        }
      }
    }

    size_t maxIndex = stringMode ? texts.size() : list.size();
    for (const auto &entry : inputs) {
      const std::string &key = entry.first;
      if (key.size() > 1 && key[0] == 'e') {
        try {
          const size_t idx = static_cast<size_t>(std::stoul(key.substr(1)));
          if (idx + 1 > maxIndex) {
            maxIndex = idx + 1;
          }
        } catch (...) {
        }
      }
    }

    if (stringMode) {
      if (maxIndex > texts.size()) {
        texts.resize(maxIndex, std::string());
      }
      for (size_t i = 0; i < maxIndex; ++i) {
        const std::string key = "e" + std::to_string(i);
        auto itInput = inputs.find(key);
        if (itInput != inputs.end()) {
          const auto &val = itInput->second;
          if (val.type() == typeid(std::string)) {
            texts[i] = std::any_cast<std::string>(val);
          } else if (val.type() == typeid(double)) {
            texts[i] = std::to_string(std::any_cast<double>(val));
          } else if (val.type() == typeid(int)) {
            texts[i] = std::to_string(std::any_cast<int>(val));
          }
        }
      }
      outputs["list"] = texts;
    } else {
      if (maxIndex > list.size()) {
        list.resize(maxIndex, 0.0);
      }
      for (size_t i = 0; i < maxIndex; ++i) {
        const std::string key = "e" + std::to_string(i);
        auto itInput = inputs.find(key);
        if (itInput != inputs.end()) {
          list[i] = NodeUtils::getValue<double>(itInput->second, list[i]);
        }
      }
      outputs["list"] = list;
    }
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("List node error: ") + e.what();
    return false;
  }
}

std::string node_list_math::getType() const { return "list_math"; }
std::string node_list_math::getName() const { return "List Math"; }
std::string node_list_math::getCategory() const { return "Operation"; }
std::string node_list_math::getDescription() const {
  return "Component-wise list operations";
}

std::vector<Socket> node_list_math::getInputs() const {
  return {{"a", "List A", DataType::LIST, std::vector<double>()},
          {"b", "List B", DataType::LIST, std::vector<double>()}};
}

std::vector<Socket> node_list_math::getOutputs() const {
  return {{"result", "Result", DataType::LIST, std::vector<double>()}};
}

std::map<std::string, std::any> node_list_math::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("add")}};
}

std::map<std::string, std::vector<std::string>>
node_list_math::getPropertyOptions() const {
  return {{"operation",
           {"add", "subtract", "multiply", "divide", "min", "max", "merge"}}};
}

NodeSchema node_list_math::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Component-wise list math or concatenation between inputs A and B.";
  }
  return schema;
}

bool node_list_math::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    auto a = NodeUtils::getValue<std::vector<double>>(inputs.at("a"),
                                                      std::vector<double>{});
    auto b = NodeUtils::getValue<std::vector<double>>(inputs.at("b"),
                                                      std::vector<double>{});
    std::string op =
        NodeUtils::getValue<std::string>(properties.at("operation"), "add");

    if (op == "merge") {
      std::vector<double> result = a;
      result.insert(result.end(), b.begin(), b.end());
      outputs["result"] = result;
      return true;
    }

    if (a.size() != b.size()) {
      errorMessage = "List dimensions must match";
      return false;
    }

    std::vector<double> result(a.size(), 0.0);
    if (op == "add") {
      for (size_t i = 0; i < a.size(); ++i) {
        result[i] = a[i] + b[i];
      }
    } else if (op == "subtract") {
      for (size_t i = 0; i < a.size(); ++i) {
        result[i] = a[i] - b[i];
      }
    } else if (op == "multiply") {
      for (size_t i = 0; i < a.size(); ++i) {
        result[i] = a[i] * b[i];
      }
    } else if (op == "divide") {
      for (size_t i = 0; i < a.size(); ++i) {
        if (b[i] == 0.0) {
          errorMessage = "Division by zero";
          return false;
        }
        result[i] = a[i] / b[i];
      }
    } else if (op == "min") {
      for (size_t i = 0; i < a.size(); ++i) {
        result[i] = std::min(a[i], b[i]);
      }
    } else if (op == "max") {
      for (size_t i = 0; i < a.size(); ++i) {
        result[i] = std::max(a[i], b[i]);
      }
    } else {
      errorMessage = "Unknown operation: " + op;
      return false;
    }

    outputs["result"] = result;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("List math node error: ") + e.what();
    return false;
  }
}

std::string node_list_unary::getType() const { return "list_unary"; }
std::string node_list_unary::getName() const { return "List Unary"; }
std::string node_list_unary::getCategory() const { return "Operation"; }
std::string node_list_unary::getDescription() const {
  return "Single-list operations";
}

std::vector<Socket> node_list_unary::getInputs() const {
  return {{"a", "List", DataType::LIST, std::vector<double>()}};
}

std::vector<Socket> node_list_unary::getOutputs() const {
  return {{"result", "Result", DataType::LIST, std::vector<double>()},
          {"scalar", "Scalar", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> node_list_unary::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("sum")}};
}

std::map<std::string, std::vector<std::string>>
node_list_unary::getPropertyOptions() const {
  return {{"operation", {"sum", "average", "min", "max", "count", "reverse"}}};
}

NodeSchema node_list_unary::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Unary list reduction or transform applied to input A.";
  }
  return schema;
}

bool node_list_unary::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    auto a = NodeUtils::getValue<std::vector<double>>(inputs.at("a"),
                                                      std::vector<double>{});
    std::string op =
        NodeUtils::getValue<std::string>(properties.at("operation"), "sum");

    if (op == "reverse") {
      std::reverse(a.begin(), a.end());
      outputs["result"] = a;
      outputs["scalar"] = 0.0;
      return true;
    }

    outputs["result"] = a;
    if (op == "sum") {
      outputs["scalar"] = std::accumulate(a.begin(), a.end(), 0.0);
      return true;
    }

    if (op == "average") {
      if (a.empty()) {
        errorMessage = "Cannot compute average of empty list";
        return false;
      }
      outputs["scalar"] = std::accumulate(a.begin(), a.end(), 0.0) /
                          static_cast<double>(a.size());
      return true;
    }

    if (op == "min") {
      outputs["scalar"] = *std::min_element(a.begin(), a.end());
      return true;
    }

    if (op == "max") {
      outputs["scalar"] = *std::max_element(a.begin(), a.end());
      return true;
    }

    if (op == "count") {
      outputs["scalar"] = static_cast<double>(a.size());
      return true;
    }

    errorMessage = "Unknown operation: " + op;
    return false;
  } catch (const std::exception &e) {
    errorMessage = std::string("List unary node error: ") + e.what();
    return false;
  }
}

std::string node_list_scalar::getType() const { return "list_scalar"; }
std::string node_list_scalar::getName() const { return "List Scalar"; }
std::string node_list_scalar::getCategory() const { return "Operation"; }
std::string node_list_scalar::getDescription() const {
  return "List-scalar operations";
}

std::vector<Socket> node_list_scalar::getInputs() const {
  return {{"list", "List", DataType::LIST, std::vector<double>()},
          {"scalar", "Scalar", DataType::NUMBER, 0.0}};
}

std::vector<Socket> node_list_scalar::getOutputs() const {
  return {{"result", "Result", DataType::LIST, std::vector<double>()}};
}

std::map<std::string, std::any> node_list_scalar::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("add")}};
}

std::map<std::string, std::vector<std::string>>
node_list_scalar::getPropertyOptions() const {
  return {
      {"operation", {"add", "subtract", "multiply", "divide", "min", "max"}}};
}

NodeSchema node_list_scalar::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Operation applied between each list element and the scalar input.";
  }
  return schema;
}

bool node_list_scalar::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    auto list = NodeUtils::getValue<std::vector<double>>(inputs.at("list"),
                                                         std::vector<double>{});
    double scalar = NodeUtils::getValue<double>(inputs.at("scalar"), 0.0);
    std::string op =
        NodeUtils::getValue<std::string>(properties.at("operation"), "add");

    std::vector<double> result(list.size(), 0.0);
    if (op == "add") {
      for (size_t i = 0; i < list.size(); ++i) {
        result[i] = list[i] + scalar;
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "subtract") {
      for (size_t i = 0; i < list.size(); ++i) {
        result[i] = list[i] - scalar;
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "multiply") {
      for (size_t i = 0; i < list.size(); ++i) {
        result[i] = list[i] * scalar;
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "divide") {
      if (scalar == 0.0) {
        errorMessage = "Division by zero";
        return false;
      }
      for (size_t i = 0; i < list.size(); ++i) {
        result[i] = list[i] / scalar;
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "max") {
      for (size_t i = 0; i < list.size(); ++i) {
        result[i] = std::max(list[i], scalar);
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "min") {
      for (size_t i = 0; i < list.size(); ++i) {
        result[i] = std::min(list[i], scalar);
      }
      outputs["result"] = result;
      return true;
    }

    errorMessage = "Unknown operation: " + op;
    return false;
  } catch (const std::exception &e) {
    errorMessage = std::string("List scalar node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_list> node_list_registrar;
NodeRegistrar<node_list_math> node_list_math_registrar;
NodeRegistrar<node_list_unary> node_list_unary_registrar;
NodeRegistrar<node_list_scalar> node_list_scalar_registrar;
} // namespace
