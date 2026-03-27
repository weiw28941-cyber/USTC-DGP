#include "node_vector.h"

std::string node_vector::getType() const { return "vector"; }
std::string node_vector::getName() const { return "Vector"; }
std::string node_vector::getCategory() const { return "Data"; }
std::string node_vector::getDescription() const {
  return "Create a vector from components";
}

std::vector<Socket> node_vector::getInputs() const {
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
    std::string id;
    std::string label;
    if (i == 0) {
      id = "x";
      label = "X";
    } else if (i == 1) {
      id = "y";
      label = "Y";
    } else if (i == 2) {
      id = "z";
      label = "Z";
    } else {
      id = "v" + std::to_string(i);
      label = "V" + std::to_string(i);
    }

    if (stringMode) {
      inputs.push_back({id, label, DataType::STRING, texts[i]});
    } else {
      inputs.push_back({id, label, DataType::NUMBER, values[i]});
    }
  }

  return inputs;
}

std::vector<Socket> node_vector::getOutputs() const {
  return {{"vec", "Vector", DataType::VECTOR, std::vector<double>()}};
}

std::map<std::string, std::any> node_vector::getProperties() const {
  std::map<std::string, std::any> props = {
      {"values", std::string("1,2,3")}, {"operation", std::string("number")}};
  if (!properties_.empty()) {
    for (const auto &entry : properties_) {
      props[entry.first] = entry.second;
    }
  }
  return props;
}

std::map<std::string, std::vector<std::string>>
node_vector::getPropertyOptions() const {
  return {{"operation", {"number", "string"}}};
}

NodeSchema node_vector::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#3182ce";
  auto valuesIt = schema.properties.find("values");
  if (valuesIt != schema.properties.end()) {
    valuesIt->second.editor = "text";
    valuesIt->second.description =
        "Comma-separated values or explicit array input.";
  }
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Interpret the vector components as numbers or strings.";
  }
  return schema;
}

bool node_vector::execute(const std::map<std::string, std::any> &inputs,
                          std::map<std::string, std::any> &outputs,
                          const std::map<std::string, std::any> &properties) {
  try {
    std::string op =
        NodeUtils::getValue<std::string>(properties.at("operation"), "number");
    const bool stringMode = (op == "string");

    std::vector<double> values;
    std::vector<std::string> texts;
    auto propIt = properties.find("values");
    if (propIt != properties.end()) {
      const auto &raw = propIt->second;
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

    size_t maxIndex = stringMode ? texts.size() : values.size();
    for (const auto &entry : inputs) {
      const std::string &key = entry.first;
      if (key == "x") {
        if (maxIndex < 1) {
          maxIndex = 1;
        }
        continue;
      }
      if (key == "y") {
        if (maxIndex < 2) {
          maxIndex = 2;
        }
        continue;
      }
      if (key == "z") {
        if (maxIndex < 3) {
          maxIndex = 3;
        }
        continue;
      }
      if (key.size() > 1 && key[0] == 'v') {
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
      std::vector<std::string> vec(maxIndex, std::string());
      for (size_t i = 0; i < maxIndex; ++i) {
        std::string id;
        if (i == 0) {
          id = "x";
        } else if (i == 1) {
          id = "y";
        } else if (i == 2) {
          id = "z";
        } else {
          id = "v" + std::to_string(i);
        }
        auto it = inputs.find(id);
        if (it != inputs.end()) {
          const auto &val = it->second;
          if (val.type() == typeid(std::string)) {
            vec[i] = std::any_cast<std::string>(val);
          } else if (val.type() == typeid(double)) {
            vec[i] = std::to_string(std::any_cast<double>(val));
          } else if (val.type() == typeid(int)) {
            vec[i] = std::to_string(std::any_cast<int>(val));
          } else {
            vec[i] = texts[i];
          }
        } else {
          vec[i] = texts[i];
        }
      }
      outputs["vec"] = vec;
    } else {
      if (maxIndex > values.size()) {
        values.resize(maxIndex, 0.0);
      }
      std::vector<double> vec(maxIndex, 0.0);
      for (size_t i = 0; i < maxIndex; ++i) {
        std::string id;
        if (i == 0) {
          id = "x";
        } else if (i == 1) {
          id = "y";
        } else if (i == 2) {
          id = "z";
        } else {
          id = "v" + std::to_string(i);
        }
        auto it = inputs.find(id);
        vec[i] = (it != inputs.end())
                     ? NodeUtils::getValue<double>(it->second, values[i])
                     : values[i];
      }
      outputs["vec"] = vec;
    }
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Vector node error: ") + e.what();
    return false;
  }
}

std::string node_vector_math::getType() const { return "vector_math"; }
std::string node_vector_math::getName() const { return "Vector Math"; }
std::string node_vector_math::getCategory() const { return "Operation"; }
std::string node_vector_math::getDescription() const {
  return "Component-wise vector operations";
}

std::vector<Socket> node_vector_math::getInputs() const {
  return {{"a", "Vector A", DataType::VECTOR, std::vector<double>()},
          {"b", "Vector B", DataType::VECTOR, std::vector<double>()}};
}

std::vector<Socket> node_vector_math::getOutputs() const {
  return {{"result", "Result", DataType::VECTOR, std::vector<double>()}};
}

std::map<std::string, std::any> node_vector_math::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("add")}};
}

std::map<std::string, std::vector<std::string>>
node_vector_math::getPropertyOptions() const {
  return {{"operation",
           {"add", "subtract", "multiply", "divide", "min", "max", "cross",
            "merge"}}};
}

NodeSchema node_vector_math::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Component-wise vector operation, cross product, or merge.";
  }
  return schema;
}

bool node_vector_math::execute(
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

    if (op == "cross") {
      if (a.size() != 3 || b.size() != 3) {
        errorMessage = "Cross requires 3D vectors";
        return false;
      }
      std::vector<double> result = {a[1] * b[2] - a[2] * b[1],
                                    a[2] * b[0] - a[0] * b[2],
                                    a[0] * b[1] - a[1] * b[0]};
      outputs["result"] = result;
      return true;
    }

    if (op == "merge") {
      std::vector<double> result = a;
      result.insert(result.end(), b.begin(), b.end());
      outputs["result"] = result;
      return true;
    }

    if (a.size() != b.size()) {
      errorMessage = "Vector dimensions must match";
      return false;
    }

    std::vector<double> result(a.size());
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
    errorMessage = std::string("Vector math node error: ") + e.what();
    return false;
  }
}

std::string node_vector_unary::getType() const { return "vector_unary"; }
std::string node_vector_unary::getName() const { return "Vector Unary"; }
std::string node_vector_unary::getCategory() const { return "Operation"; }
std::string node_vector_unary::getDescription() const {
  return "Single-vector operations";
}

std::vector<Socket> node_vector_unary::getInputs() const {
  return {{"a", "Vector", DataType::VECTOR, std::vector<double>()}};
}

std::vector<Socket> node_vector_unary::getOutputs() const {
  return {{"result", "Result", DataType::VECTOR, std::vector<double>()},
          {"scalar", "Scalar", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> node_vector_unary::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("magnitude")}};
}

std::map<std::string, std::vector<std::string>>
node_vector_unary::getPropertyOptions() const {
  return {{"operation",
           {"magnitude", "normalize", "sum", "average", "min", "max"}}};
}

NodeSchema node_vector_unary::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Unary vector reduction or normalization applied to input A.";
  }
  return schema;
}

bool node_vector_unary::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    auto a = NodeUtils::getValue<std::vector<double>>(inputs.at("a"),
                                                      std::vector<double>{});
    std::string op = NodeUtils::getValue<std::string>(
        properties.at("operation"), "magnitude");

    if (op == "magnitude") {
      double sum = 0.0;
      for (double v : a) {
        sum += v * v;
      }
      const double mag = std::sqrt(sum);
      outputs["scalar"] = mag;
      outputs["result"] = a;
      return true;
    }

    if (op == "normalize") {
      double sum = 0.0;
      for (double v : a) {
        sum += v * v;
      }
      const double mag = std::sqrt(sum);
      if (mag == 0.0) {
        errorMessage = "Cannot normalize zero vector";
        return false;
      }
      std::vector<double> result(a.size());
      for (size_t i = 0; i < a.size(); ++i) {
        result[i] = a[i] / mag;
      }
      outputs["result"] = result;
      outputs["scalar"] = mag;
      return true;
    }

    if (op == "sum") {
      double result = 0.0;
      for (double v : a) {
        result += v;
      }
      outputs["scalar"] = result;
      outputs["result"] = a;
      return true;
    }

    if (op == "average") {
      if (a.empty()) {
        errorMessage = "Cannot compute average of empty list";
        return false;
      }
      double result = 0.0;
      for (double v : a) {
        result += v;
      }
      outputs["result"] = a;
      outputs["scalar"] = result / a.size();
      return true;
    }

    if (op == "min") {
      if (a.empty()) {
        errorMessage = "Cannot compute minimum of empty list";
        return false;
      }
      outputs["scalar"] = *std::min_element(a.begin(), a.end());
      return true;
    }

    if (op == "max") {
      if (a.empty()) {
        errorMessage = "Cannot compute maximum of empty list";
        return false;
      }
      outputs["scalar"] = *std::max_element(a.begin(), a.end());
      return true;
    }

    errorMessage = "Unknown operation: " + op;
    return false;
  } catch (const std::exception &e) {
    errorMessage = std::string("Vector unary node error: ") + e.what();
    return false;
  }
}

std::string node_vector_scalar::getType() const { return "vector_scalar"; }
std::string node_vector_scalar::getName() const { return "Vector Scalar"; }
std::string node_vector_scalar::getCategory() const { return "Operation"; }
std::string node_vector_scalar::getDescription() const {
  return "Vector-scalar operations";
}

std::vector<Socket> node_vector_scalar::getInputs() const {
  return {{"vec", "Vector", DataType::VECTOR, std::vector<double>()},
          {"scalar", "Scalar", DataType::NUMBER, 0.0}};
}

std::vector<Socket> node_vector_scalar::getOutputs() const {
  return {{"result", "Result", DataType::VECTOR, std::vector<double>()}};
}

std::map<std::string, std::any> node_vector_scalar::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("add")}};
}

std::map<std::string, std::vector<std::string>>
node_vector_scalar::getPropertyOptions() const {
  return {
      {"operation", {"add", "subtract", "multiply", "divide", "min", "max"}}};
}

NodeSchema node_vector_scalar::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Operation applied between each vector component and the scalar input.";
  }
  return schema;
}

bool node_vector_scalar::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    auto vec = NodeUtils::getValue<std::vector<double>>(inputs.at("vec"),
                                                        std::vector<double>{});
    double scalar = NodeUtils::getValue<double>(inputs.at("scalar"), 0.0);
    std::string op = NodeUtils::getValue<std::string>(
        properties.at("operation"), "multiply");

    std::vector<double> result(vec.size());
    if (op == "add") {
      for (size_t i = 0; i < vec.size(); ++i) {
        result[i] = vec[i] + scalar;
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "subtract") {
      for (size_t i = 0; i < vec.size(); ++i) {
        result[i] = vec[i] - scalar;
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "multiply") {
      for (size_t i = 0; i < vec.size(); ++i) {
        result[i] = vec[i] * scalar;
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "divide") {
      if (scalar == 0.0) {
        errorMessage = "Division by zero";
        return false;
      }
      for (size_t i = 0; i < vec.size(); ++i) {
        result[i] = vec[i] / scalar;
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "max") {
      for (size_t i = 0; i < vec.size(); ++i) {
        result[i] = std::max(vec[i], scalar);
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "min") {
      for (size_t i = 0; i < vec.size(); ++i) {
        result[i] = std::min(vec[i], scalar);
      }
      outputs["result"] = result;
      return true;
    }

    errorMessage = "Unknown operation: " + op;
    return false;
  } catch (const std::exception &e) {
    errorMessage = std::string("Vector scalar node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_vector> node_vector_registrar;
NodeRegistrar<node_vector_math> node_vector_math_registrar;
NodeRegistrar<node_vector_unary> node_vector_unary_registrar;
NodeRegistrar<node_vector_scalar> node_vector_scalar_registrar;
} // namespace
