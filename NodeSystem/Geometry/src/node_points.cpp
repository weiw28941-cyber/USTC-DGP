#include "node_points.h"
#include <fstream>
#include <memory>
#include <sstream>
#include <utility>

namespace {
std::string trim(const std::string &s) {
  const auto begin = s.find_first_not_of(" \t\r\n");
  if (begin == std::string::npos) {
    return "";
  }
  const auto end = s.find_last_not_of(" \t\r\n");
  return s.substr(begin, end - begin + 1);
}
} // namespace

std::string node_points::getType() const { return "points"; }
std::string node_points::getName() const { return "Points"; }
std::string node_points::getCategory() const { return "Data"; }
std::string node_points::getDescription() const {
  return "Build point cloud from N x 3 matrix";
}

std::vector<Socket> node_points::getInputs() const {
  return {{"mat", "Matrix(Nx3)", DataType::MATRIX,
           std::vector<std::vector<double>>{}}};
}

std::vector<Socket> node_points::getOutputs() const {
  return {{"points", "Points", DataType::CUSTOM, PointCloud{}, "points"}};
}

std::map<std::string, std::any> node_points::getProperties() const {
  return {};
}

NodeSchema node_points::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#3182ce";
  return schema;
}

bool node_points::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> & /*properties*/) {
  try {
    const auto it = inputs.find("mat");
    if (it == inputs.end()) {
      errorMessage = "Points node error: missing matrix input";
      return false;
    }
    const auto matrix =
        NodeUtils::getValue<std::vector<std::vector<double>>>(it->second, {});
    if (matrix.empty()) {
      errorMessage = "Points node error: input matrix is empty";
      return false;
    }

    PointCloud pc;
    pc.points.reserve(matrix.size());
    for (size_t r = 0; r < matrix.size(); ++r) {
      const auto &row = matrix[r];
      if (row.size() != 3) {
        errorMessage = "Points node error: matrix must be N x 3";
        return false;
      }
      pc.points.push_back({row[0], row[1], row[2]});
    }

    outputs["points"] = std::make_shared<PointCloud>(std::move(pc));
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Points node error: ") + e.what();
    return false;
  }
}

std::string node_loadpoints::getType() const { return "load_points"; }
std::string node_loadpoints::getName() const { return "Load Points"; }
std::string node_loadpoints::getCategory() const { return "Method"; }
std::string node_loadpoints::getDescription() const {
  return "Load point cloud from XYZ text file";
}

std::vector<Socket> node_loadpoints::getInputs() const {
  return {{"path", "Path", DataType::STRING, std::string("")}};
}

std::vector<Socket> node_loadpoints::getOutputs() const {
  return {{"points", "Points", DataType::CUSTOM, PointCloud{}, "points"}};
}

std::map<std::string, std::any> node_loadpoints::getProperties() const {
  std::map<std::string, std::any> props = {{"path", std::string("")}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_loadpoints::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  auto pathIt = schema.properties.find("path");
  if (pathIt != schema.properties.end()) {
    pathIt->second.editor = "text";
    pathIt->second.description = "Path to an XYZ-style point cloud text file.";
  }
  return schema;
}

bool node_loadpoints::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    std::string path;
    auto inIt = inputs.find("path");
    if (inIt != inputs.end()) {
      path = NodeUtils::getValue<std::string>(inIt->second, "");
    }
    if (path.empty()) {
      auto propIt = properties.find("path");
      if (propIt != properties.end()) {
        path = NodeUtils::getValue<std::string>(propIt->second, "");
      }
    }
    path = trim(path);
    if (path.empty()) {
      errorMessage = "Load Points node error: path is empty";
      return false;
    }

    std::ifstream file(path);
    if (!file.is_open()) {
      errorMessage = "Load Points node error: cannot open file: " + path;
      return false;
    }

    PointCloud pc;
    std::string line;
    while (std::getline(file, line)) {
      line = trim(line);
      if (line.empty() || line[0] == '#') {
        continue;
      }
      for (char &ch : line) {
        if (ch == ',') {
          ch = ' ';
        }
      }
      std::istringstream iss(line);
      double x = 0.0, y = 0.0, z = 0.0;
      if (!(iss >> x >> y >> z)) {
        errorMessage = "Load Points node error: invalid point line";
        return false;
      }
      pc.points.push_back({x, y, z});
    }

    if (pc.points.empty()) {
      errorMessage = "Load Points node error: no points loaded";
      return false;
    }
    outputs["points"] = std::make_shared<PointCloud>(std::move(pc));
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Load Points node error: ") + e.what();
    return false;
  }
}

std::string node_writepoints::getType() const { return "write_points"; }
std::string node_writepoints::getName() const { return "Write Points"; }
std::string node_writepoints::getCategory() const { return "Method"; }
std::string node_writepoints::getDescription() const {
  return "Write point cloud to XYZ text file";
}

std::vector<Socket> node_writepoints::getInputs() const {
  return {
      {"points", "Points", DataType::CUSTOM, PointCloud{}, "points"},
      {"path", "Path", DataType::STRING, std::string("")},
  };
}

std::vector<Socket> node_writepoints::getOutputs() const {
  return {{"ok", "OK", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> node_writepoints::getProperties() const {
  std::map<std::string, std::any> props = {{"path", std::string("")}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_writepoints::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  auto pathIt = schema.properties.find("path");
  if (pathIt != schema.properties.end()) {
    pathIt->second.editor = "text";
    pathIt->second.description =
        "Output path for the exported XYZ point cloud.";
  }
  return schema;
}

bool node_writepoints::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  outputs["ok"] = 0.0;
  try {
    auto pointsIt = inputs.find("points");
    if (pointsIt == inputs.end()) {
      errorMessage =
          "Write Points node error: input points is missing or invalid";
      return false;
    }
    const PointCloud *pc = NodeUtils::getValuePtr<PointCloud>(pointsIt->second);
    if (!pc) {
      errorMessage =
          "Write Points node error: input points is missing or invalid";
      return false;
    }

    std::string path;
    auto pathIt = inputs.find("path");
    if (pathIt != inputs.end()) {
      path = NodeUtils::getValue<std::string>(pathIt->second, "");
    }
    if (path.empty()) {
      auto propIt = properties.find("path");
      if (propIt != properties.end()) {
        path = NodeUtils::getValue<std::string>(propIt->second, "");
      }
    }
    path = trim(path);
    if (path.empty()) {
      errorMessage = "Write Points node error: path is empty";
      return false;
    }

    std::ofstream file(path, std::ios::out | std::ios::trunc);
    if (!file.is_open()) {
      errorMessage = "Write Points node error: cannot open file: " + path;
      return false;
    }
    file << "# Exported by NodeGraphProcessor\n";
    for (const auto &p : pc->points) {
      file << p[0] << " " << p[1] << " " << p[2] << "\n";
    }
    if (!file.good()) {
      errorMessage = "Write Points node error: write failed: " + path;
      return false;
    }
    outputs["ok"] = 1.0;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Write Points node error: ") + e.what();
    return false;
  }
}

namespace {
struct points_any_to_json_registrar {
  points_any_to_json_registrar() {
    NodeUtils::registerAnyToJson<PointCloud>(
        [](const std::any &value, json &out) {
          const auto &pc = std::any_cast<const PointCloud &>(value);
          out = json::object();
          out["points"] = json::array();
          for (const auto &p : pc.points) {
            out["points"].push_back({p[0], p[1], p[2]});
          }
          out["count"] = pc.points.size();
          return true;
        });
    NodeUtils::registerAnyToJson<std::shared_ptr<PointCloud>>(
        [](const std::any &value, json &out) {
          const auto &pcPtr =
              std::any_cast<const std::shared_ptr<PointCloud> &>(value);
          if (!pcPtr) {
            out = json::object();
            out["points"] = json::array();
            out["count"] = 0;
            return true;
          }
          out = json::object();
          out["points"] = json::array();
          for (const auto &p : pcPtr->points) {
            out["points"].push_back({p[0], p[1], p[2]});
          }
          out["count"] = pcPtr->points.size();
          return true;
        });
  }
};

points_any_to_json_registrar points_any_to_json_registrar_instance;
NodeRegistrar<node_points> node_points_registrar;
NodeRegistrar<node_loadpoints> node_loadpoints_registrar;
NodeRegistrar<node_writepoints> node_writepoints_registrar;
} // namespace
