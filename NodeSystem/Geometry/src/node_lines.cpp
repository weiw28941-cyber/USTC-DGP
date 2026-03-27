#include "node_lines.h"
#include <cmath>
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

bool parseObjIndexToken(const std::string &token, int vertexCount,
                        int &outIdx0) {
  const auto slashPos = token.find('/');
  const std::string idxText =
      (slashPos == std::string::npos) ? token : token.substr(0, slashPos);
  if (idxText.empty()) {
    return false;
  }

  int idx = 0;
  try {
    idx = std::stoi(idxText);
  } catch (...) {
    return false;
  }
  if (idx == 0) {
    return false;
  }
  if (idx < 0) {
    idx = vertexCount + idx + 1;
  }
  if (idx <= 0 || idx > vertexCount) {
    return false;
  }

  outIdx0 = idx - 1;
  return true;
}
} // namespace

std::string node_lines::getType() const { return "lines"; }
std::string node_lines::getName() const { return "Lines"; }
std::string node_lines::getCategory() const { return "Data"; }
std::string node_lines::getDescription() const {
  return "Build line set from points and N x 2 index matrix";
}

std::vector<Socket> node_lines::getInputs() const {
  return {{"points", "Points", DataType::CUSTOM, PointCloud{}, "points"},
          {"indices", "Indices(Nx2)", DataType::MATRIX,
           std::vector<std::vector<double>>{}}};
}

std::vector<Socket> node_lines::getOutputs() const {
  return {{"lines", "Lines", DataType::CUSTOM, LineSet{}, "lines"}};
}

std::map<std::string, std::any> node_lines::getProperties() const {
  std::map<std::string, std::any> props = {
      {"operation", std::string("undirected")}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

std::map<std::string, std::vector<std::string>>
node_lines::getPropertyOptions() const {
  return {{"operation", {"undirected", "directed"}}};
}

NodeSchema node_lines::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#3182ce";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Choose whether segments should be treated as directed or undirected.";
  }
  return schema;
}

bool node_lines::execute(const std::map<std::string, std::any> &inputs,
                         std::map<std::string, std::any> &outputs,
                         const std::map<std::string, std::any> &properties) {
  try {
    std::string op = "undirected";
    auto opIt = properties.find("operation");
    if (opIt != properties.end()) {
      op = NodeUtils::getValue<std::string>(opIt->second, "undirected");
    }

    auto pointsIt = inputs.find("points");
    if (pointsIt == inputs.end()) {
      errorMessage = "Lines node error: input points is missing";
      return false;
    }
    PointCloud points;
    if (const PointCloud *pc =
            NodeUtils::getValuePtr<PointCloud>(pointsIt->second)) {
      points = *pc;
    } else if (pointsIt->second.type() ==
               typeid(std::vector<std::vector<double>>)) {
      const auto mat =
          std::any_cast<std::vector<std::vector<double>>>(pointsIt->second);
      points.points.reserve(mat.size());
      for (const auto &row : mat) {
        if (row.size() != 3) {
          errorMessage = "Lines node error: points matrix must be N x 3";
          return false;
        }
        points.points.push_back({row[0], row[1], row[2]});
      }
    } else {
      errorMessage =
          "Lines node error: input points must be PointCloud or N x 3 matrix";
      return false;
    }
    if (points.points.empty()) {
      errorMessage = "Lines node error: points is empty";
      return false;
    }

    auto indicesIt = inputs.find("indices");
    if (indicesIt == inputs.end()) {
      errorMessage = "Lines node error: missing indices input";
      return false;
    }
    const auto matrix = NodeUtils::getValue<std::vector<std::vector<double>>>(
        indicesIt->second, {});
    if (matrix.empty()) {
      errorMessage = "Lines node error: indices matrix is empty";
      return false;
    }

    LineSet lines;
    lines.points = points.points;
    lines.directed = (op == "directed");
    lines.segments.reserve(matrix.size());

    for (size_t r = 0; r < matrix.size(); ++r) {
      const auto &row = matrix[r];
      if (row.size() != 2) {
        errorMessage = "Lines node error: indices matrix must be N x 2";
        return false;
      }
      const int a = static_cast<int>(std::round(row[0]));
      const int b = static_cast<int>(std::round(row[1]));
      if (std::fabs(row[0] - a) > 1e-9 || std::fabs(row[1] - b) > 1e-9) {
        errorMessage = "Lines node error: indices must be integers";
        return false;
      }
      if (a < 0 || b < 0 || a >= static_cast<int>(lines.points.size()) ||
          b >= static_cast<int>(lines.points.size())) {
        errorMessage = "Lines node error: index out of points range";
        return false;
      }
      lines.segments.push_back({a, b});
    }

    outputs["lines"] = std::make_shared<LineSet>(std::move(lines));
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Lines node error: ") + e.what();
    return false;
  }
}

std::string node_loadlines::getType() const { return "load_lines"; }
std::string node_loadlines::getName() const { return "Load Lines"; }
std::string node_loadlines::getCategory() const { return "Method"; }
std::string node_loadlines::getDescription() const {
  return "Load lines from OBJ file";
}

std::vector<Socket> node_loadlines::getInputs() const {
  return {{"path", "Path", DataType::STRING, std::string("")}};
}

std::vector<Socket> node_loadlines::getOutputs() const {
  return {{"lines", "Lines", DataType::CUSTOM, LineSet{}, "lines"}};
}

std::map<std::string, std::any> node_loadlines::getProperties() const {
  std::map<std::string, std::any> props = {{"path", std::string("")}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_loadlines::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  auto pathIt = schema.properties.find("path");
  if (pathIt != schema.properties.end()) {
    pathIt->second.editor = "text";
    pathIt->second.description =
        "Path to an OBJ file containing line elements.";
  }
  return schema;
}

bool node_loadlines::execute(
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
      errorMessage = "Load Lines node error: path is empty";
      return false;
    }

    std::ifstream file(path);
    if (!file.is_open()) {
      errorMessage = "Load Lines node error: cannot open file: " + path;
      return false;
    }

    LineSet lines;
    std::string line;
    while (std::getline(file, line)) {
      line = trim(line);
      if (line.empty() || line[0] == '#') {
        continue;
      }
      if (line.rfind("v ", 0) == 0) {
        std::istringstream iss(line.substr(2));
        double x = 0.0, y = 0.0, z = 0.0;
        if (!(iss >> x >> y >> z)) {
          errorMessage = "Load Lines node error: invalid vertex line";
          return false;
        }
        lines.points.push_back({x, y, z});
      } else if (line.rfind("l ", 0) == 0) {
        std::istringstream iss(line.substr(2));
        std::vector<int> polyline;
        std::string token;
        while (iss >> token) {
          int idx = -1;
          if (!parseObjIndexToken(token, static_cast<int>(lines.points.size()),
                                  idx)) {
            errorMessage = "Load Lines node error: invalid line index";
            return false;
          }
          polyline.push_back(idx);
        }
        if (polyline.size() < 2) {
          continue;
        }
        for (size_t i = 1; i < polyline.size(); ++i) {
          lines.segments.push_back({polyline[i - 1], polyline[i]});
        }
      }
    }

    if (lines.points.empty()) {
      errorMessage = "Load Lines node error: no vertices loaded";
      return false;
    }
    if (lines.segments.empty()) {
      errorMessage = "Load Lines node error: no line segments loaded";
      return false;
    }

    lines.directed = false;
    outputs["lines"] = std::make_shared<LineSet>(std::move(lines));
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Load Lines node error: ") + e.what();
    return false;
  }
}

std::string node_writelines::getType() const { return "write_lines"; }
std::string node_writelines::getName() const { return "Write Lines"; }
std::string node_writelines::getCategory() const { return "Method"; }
std::string node_writelines::getDescription() const {
  return "Write lines to OBJ file";
}

std::vector<Socket> node_writelines::getInputs() const {
  return {
      {"lines", "Lines", DataType::CUSTOM, LineSet{}, "lines"},
      {"path", "Path", DataType::STRING, std::string("")},
  };
}

std::vector<Socket> node_writelines::getOutputs() const {
  return {{"ok", "OK", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> node_writelines::getProperties() const {
  std::map<std::string, std::any> props = {{"path", std::string("")}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_writelines::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  auto pathIt = schema.properties.find("path");
  if (pathIt != schema.properties.end()) {
    pathIt->second.editor = "text";
    pathIt->second.description =
        "Output OBJ path used when exporting line sets.";
  }
  return schema;
}

bool node_writelines::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  outputs["ok"] = 0.0;
  try {
    auto linesIt = inputs.find("lines");
    if (linesIt == inputs.end()) {
      errorMessage =
          "Write Lines node error: input lines is missing or invalid";
      return false;
    }
    const LineSet *lines = NodeUtils::getValuePtr<LineSet>(linesIt->second);
    if (!lines) {
      errorMessage =
          "Write Lines node error: input lines is missing or invalid";
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
      errorMessage = "Write Lines node error: path is empty";
      return false;
    }

    for (const auto &seg : lines->segments) {
      if (seg[0] < 0 || seg[1] < 0 ||
          seg[0] >= static_cast<int>(lines->points.size()) ||
          seg[1] >= static_cast<int>(lines->points.size())) {
        errorMessage =
            "Write Lines node error: segment index out of points range";
        return false;
      }
    }

    std::ofstream file(path, std::ios::out | std::ios::trunc);
    if (!file.is_open()) {
      errorMessage = "Write Lines node error: cannot open file: " + path;
      return false;
    }

    file << "# Exported by NodeGraphProcessor\n";
    for (const auto &p : lines->points) {
      file << "v " << p[0] << " " << p[1] << " " << p[2] << "\n";
    }
    for (const auto &seg : lines->segments) {
      file << "l " << (seg[0] + 1) << " " << (seg[1] + 1) << "\n";
    }
    if (!file.good()) {
      errorMessage = "Write Lines node error: write failed: " + path;
      return false;
    }

    outputs["ok"] = 1.0;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Write Lines node error: ") + e.what();
    return false;
  }
}

namespace {
struct lines_any_to_json_registrar {
  lines_any_to_json_registrar() {
    NodeUtils::registerAnyToJson<LineSet>([](const std::any &value, json &out) {
      const auto &lines = std::any_cast<const LineSet &>(value);
      out = json::object();
      out["points"] = json::array();
      out["segments"] = json::array();
      for (const auto &p : lines.points) {
        out["points"].push_back({p[0], p[1], p[2]});
      }
      for (const auto &seg : lines.segments) {
        out["segments"].push_back({seg[0], seg[1]});
      }
      out["directed"] = lines.directed;
      out["pointCount"] = lines.points.size();
      out["segmentCount"] = lines.segments.size();
      return true;
    });
    NodeUtils::registerAnyToJson<std::shared_ptr<LineSet>>(
        [](const std::any &value, json &out) {
          const auto &linesPtr =
              std::any_cast<const std::shared_ptr<LineSet> &>(value);
          out = json::object();
          out["points"] = json::array();
          out["segments"] = json::array();
          out["directed"] = linesPtr ? linesPtr->directed : false;
          if (!linesPtr) {
            out["pointCount"] = 0;
            out["segmentCount"] = 0;
            return true;
          }
          for (const auto &p : linesPtr->points) {
            out["points"].push_back({p[0], p[1], p[2]});
          }
          for (const auto &seg : linesPtr->segments) {
            out["segments"].push_back({seg[0], seg[1]});
          }
          out["pointCount"] = linesPtr->points.size();
          out["segmentCount"] = linesPtr->segments.size();
          return true;
        });
  }
};

lines_any_to_json_registrar lines_any_to_json_registrar_instance;
NodeRegistrar<node_lines> node_lines_registrar;
NodeRegistrar<node_loadlines> node_loadlines_registrar;
NodeRegistrar<node_writelines> node_writelines_registrar;
} // namespace
