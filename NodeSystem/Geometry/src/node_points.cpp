#include "node_points.h"
#include <cstddef>
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
  return "Build point cloud from vertices and optional colors";
}

std::vector<Socket> node_points::getInputs() const {
  return {
      {"vertices", "Vertices(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
      {"colors", "Colors(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
  };
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
    const auto verticesIt = inputs.find("vertices");
    if (verticesIt == inputs.end()) {
      errorMessage = "Points node error: missing vertices input";
      return false;
    }
    const auto vertices = NodeUtils::getValue<std::vector<std::vector<double>>>(
        verticesIt->second, {});
    if (vertices.empty()) {
      errorMessage = "Points node error: input vertices is empty";
      return false;
    }
    std::vector<std::vector<double>> colors;
    const auto colorsIt = inputs.find("colors");
    if (colorsIt != inputs.end()) {
      colors = NodeUtils::getValue<std::vector<std::vector<double>>>(
          colorsIt->second, {});
    }

    PointCloud pc;
    pc.vertices.reserve(vertices.size());
    for (size_t r = 0; r < vertices.size(); ++r) {
      const auto &row = vertices[r];
      if (row.size() != 3) {
        errorMessage = "Points node error: vertices must be N x 3";
        return false;
      }
      pc.vertices.push_back({row[0], row[1], row[2]});
    }
    if (colors.empty()) {
      pc.colors.assign(pc.vertices.size(), {1.0, 1.0, 1.0});
    } else {
      if (colors.size() != pc.vertices.size()) {
        errorMessage = "Points node error: colors must have same rows as "
                       "vertices";
        return false;
      }
      pc.colors.reserve(colors.size());
      for (size_t r = 0; r < colors.size(); ++r) {
        const auto &row = colors[r];
        if (row.size() != 3) {
          errorMessage = "Points node error: colors must be N x 3";
          return false;
        }
        pc.colors.push_back({row[0], row[1], row[2]});
      }
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
        errorMessage = "Load Points node error: invalid point line (expected "
                       "at least x y z)";
        return false;
      }
      pc.vertices.push_back({x, y, z});

      double r = 1.0, g = 1.0, b = 1.0;
      if (iss >> r >> g >> b) {
        // Successfully read RGB
        pc.colors.push_back({r, g, b});
      } else {
        // No RGB data, use default white color
        pc.colors.push_back({1.0, 1.0, 1.0});
      }
    }

    if (pc.vertices.empty()) {
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
    for (size_t i = 0; i < pc->vertices.size(); ++i) {
      const auto &p = pc->vertices[i];
      file << p[0] << " " << p[1] << " " << p[2];
      if (i < pc->colors.size()) {
        const auto &c = pc->colors[i];
        file << " " << c[0] << " " << c[1] << " " << c[2];
      }
      file << "\n";
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

std::string node_points_attributes::getType() const {
  return "points_attributes";
}
std::string node_points_attributes::getName() const {
  return "Points Attributes";
}
std::string node_points_attributes::getCategory() const { return "Method"; }
std::string node_points_attributes::getDescription() const {
  return "Split points into vertices and colors";
}

std::vector<Socket> node_points_attributes::getInputs() const {
  return {{"points", "Points", DataType::CUSTOM, PointCloud{}, "points"}};
}

std::vector<Socket> node_points_attributes::getOutputs() const {
  return {
      {"vertices", "Vertices(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
      {"colors", "Colors(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
  };
}

std::map<std::string, std::any> node_points_attributes::getProperties() const {
  return {};
}

NodeSchema node_points_attributes::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  return schema;
}

bool node_points_attributes::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> & /*properties*/) {
  try {
    auto pointsIt = inputs.find("points");
    if (pointsIt == inputs.end()) {
      errorMessage =
          "Points Attributes node error: input points is missing or invalid";
      return false;
    }
    const PointCloud *pc = NodeUtils::getValuePtr<PointCloud>(pointsIt->second);
    if (!pc) {
      errorMessage =
          "Points Attributes node error: input points is missing or invalid";
      return false;
    }

    std::vector<std::vector<double>> vertices;
    vertices.reserve(pc->vertices.size());
    for (const auto &p : pc->vertices) {
      vertices.push_back({p[0], p[1], p[2]});
    }

    std::vector<std::vector<double>> colors;
    if (pc->colors.size() == pc->vertices.size()) {
      colors.reserve(pc->colors.size());
      for (const auto &c : pc->colors) {
        colors.push_back({c[0], c[1], c[2]});
      }
    } else {
      colors.assign(pc->vertices.size(), {1.0, 1.0, 1.0});
    }

    outputs["vertices"] = std::move(vertices);
    outputs["colors"] = std::move(colors);
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Points Attributes node error: ") + e.what();
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
          out["vertices"] = json::array();
          for (const auto &p : pc.vertices) {
            out["vertices"].push_back({p[0], p[1], p[2]});
          }
          out["count"] = pc.vertices.size();
          out["colors"] = json::array();
          for (const auto &c : pc.colors) {
            out["colors"].push_back({c[0], c[1], c[2]});
          }
          return true;
        });
    NodeUtils::registerAnyToJson<std::shared_ptr<PointCloud>>(
        [](const std::any &value, json &out) {
          const auto &pcPtr =
              std::any_cast<const std::shared_ptr<PointCloud> &>(value);
          if (!pcPtr) {
            out = json::object();
            out["vertices"] = json::array();
            out["count"] = 0;
            out["colors"] = json::array();
            return true;
          }
          out = json::object();
          out["vertices"] = json::array();
          for (const auto &p : pcPtr->vertices) {
            out["vertices"].push_back({p[0], p[1], p[2]});
          }
          out["count"] = pcPtr->vertices.size();
          out["colors"] = json::array();
          for (const auto &c : pcPtr->colors) {
            out["colors"].push_back({c[0], c[1], c[2]});
          }
          return true;
        });
  }
};

points_any_to_json_registrar points_any_to_json_registrar_instance;
NodeRegistrar<node_points> node_points_registrar;
NodeRegistrar<node_loadpoints> node_loadpoints_registrar;
NodeRegistrar<node_writepoints> node_writepoints_registrar;
NodeRegistrar<node_points_attributes> node_points_attributes_registrar;
} // namespace
