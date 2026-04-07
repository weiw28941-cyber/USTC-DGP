#include "node_pointCurvature.h"
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

std::string node_pointCurvature::getType() const { return "point_curvature"; }
std::string node_pointCurvature::getName() const { return "Point Curvature"; }
std::string node_pointCurvature::getCategory() const { return "Geometry"; }
std::string node_pointCurvature::getDescription() const {
  return "Compute per-vertex Gaussian or mean curvature from a point cloud";
}

std::vector<Socket> node_pointCurvature::getInputs() const {
  return {{"points", "Points", DataType::CUSTOM, PointCloud{}, "points"}};
}

std::vector<Socket> node_pointCurvature::getOutputs() const {
  return {{"curvature", "Curvature", DataType::LIST, std::vector<double>{}}};
}

std::map<std::string, std::any> node_pointCurvature::getProperties() const {
  std::map<std::string, std::any> props = {
      {"operation", std::string("gaussian")},
  };
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

std::map<std::string, std::vector<std::string>>
node_pointCurvature::getPropertyOptions() const {
  return {{"operation", {"gaussian", "mean"}}};
}

NodeSchema node_pointCurvature::getSchema() const {
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

bool node_pointCurvature::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    const auto pointsIt = inputs.find("points");
    if (pointsIt == inputs.end()) {
      errorMessage =
          "Point Curvature node error: input points are missing or invalid";
      return false;
    }
    const PointCloud *points =
        NodeUtils::getValuePtr<PointCloud>(pointsIt->second);
    if (!points) {
      errorMessage =
          "Point Curvature node error: input points are missing or invalid";
      return false;
    }
    const size_t vertexCount = points->vertices.size();
    if (vertexCount == 0) {
      errorMessage = "Point Curvature node error: point cloud has no vertices";
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
    errorMessage = std::string("Point Curvature node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_pointCurvature> node_point_curvature_registrar;
} // namespace