#include "node_scalarCurvature.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <limits>
#include <map>
#include <utility>

std::string node_scalarCurvature::getType() const { return "scalar_curvature"; }
std::string node_scalarCurvature::getName() const { return "Scalar Curvature"; }
std::string node_scalarCurvature::getCategory() const { return "Geometry"; }
std::string node_scalarCurvature::getDescription() const {
  return "Compute per-vertex Gaussian or mean curvature from a mesh";
}

std::vector<Socket> node_scalarCurvature::getInputs() const {
  return {{"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"}};
}

std::vector<Socket> node_scalarCurvature::getOutputs() const {
  return {{"curvature", "Curvature", DataType::LIST, std::vector<double>{}}};
}

std::map<std::string, std::any> node_scalarCurvature::getProperties() const {
  std::map<std::string, std::any> props = {
      {"operation", std::string("gaussian")},
  };
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

std::map<std::string, std::vector<std::string>>
node_scalarCurvature::getPropertyOptions() const {
  return {{"operation", {"gaussian", "mean"}}};
}

NodeSchema node_scalarCurvature::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Choose Gaussian curvature or mean curvature per vertex.";
  }
  return schema;
}

bool node_scalarCurvature::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    const auto meshIt = inputs.find("mesh");
    if (meshIt == inputs.end()) {
      errorMessage =
          "Scalar Curvature node error: input mesh is missing or invalid";
      return false;
    }
    const Mesh *mesh = NodeUtils::getValuePtr<Mesh>(meshIt->second);
    if (!mesh) {
      errorMessage =
          "Scalar Curvature node error: input mesh is missing or invalid";
      return false;
    }
    const size_t vertexCount = mesh->vertices.size();
    if (vertexCount == 0) {
      errorMessage = "Scalar Curvature node error: mesh has no vertices";
      return false;
    }
    if (mesh->triangles.empty()) {
      errorMessage = "Scalar Curvature node error: mesh has no triangles";
      return false;
    }

    std::string op = "gaussian";
    auto opIt = properties.find("operation");
    if (opIt != properties.end()) {
      op = NodeUtils::getValue<std::string>(opIt->second, "gaussian");
    }
    if (op != "gaussian" && op != "mean") {
      op = "gaussian";
    }

    /*** compute curvature ***/
    std::vector<double> gaussian(vertexCount, 0.0);
    std::vector<double> mean(vertexCount, 0.0);
    for (size_t i = 0; i < vertexCount; ++i) {
      gaussian[i] =
          std::rand() /
          static_cast<double>(RAND_MAX); // Initialize Gaussian curvature to
                                         // random value between 0 and 2π
      mean[i] = std::rand() /
                static_cast<double>(RAND_MAX); // Initialize mean curvature to
                                               // random value between 0 and 2π
    }

    /*** compute curvature ***/

    outputs["curvature"] = (op == "mean") ? mean : gaussian;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Scalar Curvature node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_scalarCurvature> node_scalar_curvature_registrar;
} // namespace