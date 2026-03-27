#include "node_texture.h"

namespace {
std::string trim(const std::string &s) {
  const auto begin = s.find_first_not_of(" \t\r\n");
  if (begin == std::string::npos) {
    return "";
  }
  const auto end = s.find_last_not_of(" \t\r\n");
  return s.substr(begin, end - begin + 1);
}

std::vector<std::vector<double>> makeIdentity4() {
  return {{1.0, 0.0, 0.0, 0.0},
          {0.0, 1.0, 0.0, 0.0},
          {0.0, 0.0, 1.0, 0.0},
          {0.0, 0.0, 0.0, 1.0}};
}
} // namespace

std::string node_texture::getType() const { return "texture"; }
std::string node_texture::getName() const { return "Texture"; }
std::string node_texture::getCategory() const { return "Data"; }
std::string node_texture::getDescription() const {
  return "Texture resource from image path and material matrix";
}

std::vector<Socket> node_texture::getInputs() const {
  return {{"path", "Image Path", DataType::STRING, std::string("")},
          {"material", "Material Matrix", DataType::MATRIX, makeIdentity4()}};
}

std::vector<Socket> node_texture::getOutputs() const {
  return {{"texture", "Texture", DataType::CUSTOM, TextureData{}, "texture"}};
}

std::map<std::string, std::any> node_texture::getProperties() const {
  std::map<std::string, std::any> props = {
      {"path", std::string("")},
      {"material", makeIdentity4()},
  };
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_texture::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#3182ce";
  auto pathIt = schema.properties.find("path");
  if (pathIt != schema.properties.end()) {
    pathIt->second.editor = "text";
    pathIt->second.description = "Image path used for the texture resource. "
                                 "Empty falls back to checkerboard.";
  }
  auto materialIt = schema.properties.find("material");
  if (materialIt != schema.properties.end()) {
    materialIt->second.editor = "text";
    materialIt->second.description =
        "Material transform matrix forwarded with the texture payload.";
  }
  return schema;
}

bool node_texture::execute(const std::map<std::string, std::any> &inputs,
                           std::map<std::string, std::any> &outputs,
                           const std::map<std::string, std::any> &properties) {
  try {
    std::string path;
    auto pathIt = inputs.find("path");
    if (pathIt != inputs.end()) {
      path = NodeUtils::getValue<std::string>(pathIt->second, "");
    }
    if (path.empty()) {
      auto propPathIt = properties.find("path");
      if (propPathIt != properties.end()) {
        path = NodeUtils::getValue<std::string>(propPathIt->second, "");
      }
    }
    path = trim(path);

    std::vector<std::vector<double>> material = makeIdentity4();
    auto materialIt = inputs.find("material");
    if (materialIt != inputs.end()) {
      material = NodeUtils::getValue<std::vector<std::vector<double>>>(
          materialIt->second, material);
    } else {
      auto propMaterialIt = properties.find("material");
      if (propMaterialIt != properties.end()) {
        material = NodeUtils::getValue<std::vector<std::vector<double>>>(
            propMaterialIt->second, material);
      }
    }

    if (material.empty()) {
      errorMessage = "Texture node error: material matrix is empty";
      return false;
    }
    const size_t cols = material.front().size();
    if (cols == 0) {
      errorMessage = "Texture node error: material matrix has empty row";
      return false;
    }
    for (const auto &row : material) {
      if (row.size() != cols) {
        errorMessage = "Texture node error: material matrix row size mismatch";
        return false;
      }
    }

    TextureData tex;
    tex.useBuiltinChecker = path.empty();
    tex.path = tex.useBuiltinChecker ? "builtin://checkerboard" : path;
    tex.materialMatrix = material;
    outputs["texture"] = tex;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Texture node error: ") + e.what();
    return false;
  }
}

namespace {
struct texture_any_to_json_registrar {
  texture_any_to_json_registrar() {
    NodeUtils::registerAnyToJson<TextureData>(
        [](const std::any &value, json &out) {
          const auto &tex = std::any_cast<const TextureData &>(value);
          out = json::object();
          out["path"] = tex.path;
          out["useBuiltinChecker"] = tex.useBuiltinChecker;
          out["material"] = tex.materialMatrix;
          out["rows"] = tex.materialMatrix.size();
          out["cols"] =
              tex.materialMatrix.empty() ? 0 : tex.materialMatrix[0].size();
          return true;
        });
  }
};

texture_any_to_json_registrar texture_any_to_json_registrar_instance;
NodeRegistrar<node_texture> node_texture_registrar;
} // namespace
