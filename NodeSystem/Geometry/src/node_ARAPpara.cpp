#include "node_ARAPpara.h"
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

std::string node_ARAPpara::getType() const { return "arap_para"; }
std::string node_ARAPpara::getName() const { return "ARAP Para"; }
std::string node_ARAPpara::getCategory() const { return "Geometry"; }
std::string node_ARAPpara::getDescription() const {
  return "Compute ARAP parameters for a mesh";
}

std::vector<Socket> node_ARAPpara::getInputs() const {
  return {{"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"}};
}

std::vector<Socket> node_ARAPpara::getOutputs() const {
  return {
      {"uv", "Matrix", DataType::MATRIX, std::vector<std::vector<double>>()}};
}

std::map<std::string, std::any> node_ARAPpara::getProperties() const {
  return {};
}

NodeSchema node_ARAPpara::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  return schema;
}

bool node_ARAPpara::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> & /*properties*/) {
  try {
    const auto meshIt = inputs.find("mesh");
    if (meshIt == inputs.end()) {
      errorMessage =
          "ARAP Parameterizations node error: input mesh is missing or invalid";
      return false;
    }
    const Mesh *mesh = NodeUtils::getValuePtr<Mesh>(meshIt->second);
    if (!mesh) {
      errorMessage =
          "ARAP Parameterizations node error: input mesh is missing or invalid";
      return false;
    }
    const size_t vertexCount = mesh->vertices.size();
    if (vertexCount == 0) {
      errorMessage = "ARAP Parameterizations node error: mesh has no vertices";
      return false;
    }

    /*** compute ARAP parameterizations ***/
    std::vector<std::vector<double>> uv(vertexCount,
                                        std::vector<double>(2, 0.0));
    for (size_t i = 0; i < vertexCount; ++i) {
      uv[i][0] = std::rand() / static_cast<double>(RAND_MAX);
      uv[i][1] = std::rand() / static_cast<double>(RAND_MAX);
    }

    /*** compute ARAP parameterizations ***/

    outputs["uv"] = uv;
    return true;
  } catch (const std::exception &e) {
    errorMessage =
        std::string("ARAP Parameterizations node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_ARAPpara> node_arap_para_registrar;
} // namespace