#include "node_geometry.h"
#include <algorithm>
#include <limits>
#include <memory>
#include <sstream>
#include <type_traits>
#include <utility>

namespace {
GeometryData makeDefaultGeometry() {
  GeometryData g;
  const Mesh box = [] {
    Mesh mesh;
    const double h = 1.0;
    mesh.vertices = {
        {-h, -h, -h}, {h, -h, -h}, {h, h, -h}, {-h, h, -h},
        {-h, -h, h},  {h, -h, h},  {h, h, h},  {-h, h, h},
    };
    // Keep default box winding consistent with outward-facing normals.
    mesh.triangles = {
        {0, 2, 1}, {0, 3, 2}, {4, 5, 6}, {4, 6, 7}, {0, 5, 4}, {0, 1, 5},
        {3, 6, 2}, {3, 7, 6}, {1, 6, 5}, {1, 2, 6}, {0, 7, 3}, {0, 4, 7},
    };
    return mesh;
  }();
  g.positions.reserve(box.vertices.size() * 3);
  for (const auto &v : box.vertices) {
    g.positions.push_back(static_cast<float>(v[0]));
    g.positions.push_back(static_cast<float>(v[1]));
    g.positions.push_back(static_cast<float>(v[2]));
    g.colors.push_back(0.82f);
    g.colors.push_back(0.84f);
    g.colors.push_back(0.88f);
    g.texcoords.push_back(0.0f);
    g.texcoords.push_back(0.0f);
  }
  g.triIndices.reserve(box.triangles.size() * 3);
  for (const auto &t : box.triangles) {
    g.triIndices.push_back(t[0]);
    g.triIndices.push_back(t[1]);
    g.triIndices.push_back(t[2]);
    g.triTexcoordIndices.push_back(t[0]);
    g.triTexcoordIndices.push_back(t[1]);
    g.triTexcoordIndices.push_back(t[2]);
  }
  g.vectorLineFlags.assign(g.lineIndices.size() / 2, 0);
  g.texturePath = "builtin://checkerboard";
  return g;
}

std::uint64_t fnv1aHashBytes(std::uint64_t hash, const unsigned char *data,
                             size_t len) {
  constexpr std::uint64_t kPrime = 1099511628211ull;
  for (size_t i = 0; i < len; ++i) {
    hash ^= static_cast<std::uint64_t>(data[i]);
    hash *= kPrime;
  }
  return hash;
}

template <typename T> std::uint64_t hashScalar(std::uint64_t hash, T value) {
  static_assert(std::is_trivially_copyable<T>::value,
                "hashScalar requires trivially copyable type");
  return fnv1aHashBytes(hash, reinterpret_cast<const unsigned char *>(&value),
                        sizeof(T));
}

std::string hashToHex(std::uint64_t value) {
  std::ostringstream oss;
  oss << std::hex << value;
  return oss.str();
}

std::uint64_t computeGeometryHash(const GeometryData &geometry) {
  std::uint64_t hash = 1469598103934665603ull;
  hash =
      hashScalar(hash, static_cast<std::uint64_t>(geometry.positions.size()));
  for (float v : geometry.positions)
    hash = hashScalar(hash, v);
  hash = hashScalar(hash, static_cast<std::uint64_t>(geometry.colors.size()));
  for (float v : geometry.colors)
    hash = hashScalar(hash, v);
  hash =
      hashScalar(hash, static_cast<std::uint64_t>(geometry.texcoords.size()));
  for (float v : geometry.texcoords)
    hash = hashScalar(hash, v);
  hash = hashScalar(
      hash, static_cast<std::uint64_t>(geometry.triTexcoordIndices.size()));
  for (int i : geometry.triTexcoordIndices)
    hash = hashScalar(hash, i);
  hash =
      hashScalar(hash, static_cast<std::uint64_t>(geometry.triIndices.size()));
  for (int i : geometry.triIndices)
    hash = hashScalar(hash, i);
  hash =
      hashScalar(hash, static_cast<std::uint64_t>(geometry.lineIndices.size()));
  for (int i : geometry.lineIndices)
    hash = hashScalar(hash, i);
  hash = hashScalar(hash,
                    static_cast<std::uint64_t>(geometry.pointIndices.size()));
  for (int i : geometry.pointIndices)
    hash = hashScalar(hash, i);
  hash = hashScalar(
      hash, static_cast<std::uint64_t>(geometry.vectorLineFlags.size()));
  for (int i : geometry.vectorLineFlags)
    hash = hashScalar(hash, i);
  hash =
      hashScalar(hash, static_cast<std::uint64_t>(geometry.texturePath.size()));
  hash = fnv1aHashBytes(
      hash,
      reinterpret_cast<const unsigned char *>(geometry.texturePath.data()),
      geometry.texturePath.size());
  hash = hashScalar(hash, static_cast<std::uint64_t>(geometry.objects.size()));
  return hash;
}

void computeGeometryBounds(const GeometryData &geometry,
                           std::array<double, 3> &boundsMin,
                           std::array<double, 3> &boundsMax) {
  if (geometry.positions.empty()) {
    boundsMin = {-1.0, -1.0, -1.0};
    boundsMax = {1.0, 1.0, 1.0};
    return;
  }
  boundsMin = {std::numeric_limits<double>::max(),
               std::numeric_limits<double>::max(),
               std::numeric_limits<double>::max()};
  boundsMax = {std::numeric_limits<double>::lowest(),
               std::numeric_limits<double>::lowest(),
               std::numeric_limits<double>::lowest()};
  for (size_t i = 0; i + 2 < geometry.positions.size(); i += 3) {
    const double x = geometry.positions[i];
    const double y = geometry.positions[i + 1];
    const double z = geometry.positions[i + 2];
    boundsMin[0] = std::min(boundsMin[0], x);
    boundsMin[1] = std::min(boundsMin[1], y);
    boundsMin[2] = std::min(boundsMin[2], z);
    boundsMax[0] = std::max(boundsMax[0], x);
    boundsMax[1] = std::max(boundsMax[1], y);
    boundsMax[2] = std::max(boundsMax[2], z);
  }
}

void appendGeometryStreamMetadata(json &out, const GeometryData &geometry) {
  const std::uint64_t hash = computeGeometryHash(geometry);
  std::array<double, 3> boundsMin;
  std::array<double, 3> boundsMax;
  computeGeometryBounds(geometry, boundsMin, boundsMax);
  out["viewerType"] = "geometry";
  out["meshId"] = "geom_" + hashToHex(hash);
  out["version"] = hash;
  out["dataFormat"] = "packed_g1";
  out["vertexCount"] = geometry.positions.size() / 3;
  out["triangleCount"] = geometry.triIndices.size() / 3;
  out["lineCount"] = geometry.lineIndices.size() / 2;
  out["pointCount"] = geometry.pointIndices.size();
  out["boundsMin"] = {boundsMin[0], boundsMin[1], boundsMin[2]};
  out["boundsMax"] = {boundsMax[0], boundsMax[1], boundsMax[2]};
}

json anyToJsonObjectSafe(const std::any &value) {
  if (value.type() == typeid(json)) {
    try {
      const auto &j = std::any_cast<const json &>(value);
      if (j.is_object()) {
        return j;
      }
    } catch (...) {
    }
  }
  json out = json::object();
  if (NodeUtils::anyToJson(value, out)) {
    if (out.is_object()) {
      return out;
    }
    if (out.is_string()) {
      try {
        const json parsed = json::parse(out.get<std::string>());
        if (parsed.is_object()) {
          return parsed;
        }
      } catch (...) {
      }
    }
  }
  if (value.type() == typeid(std::string)) {
    try {
      const json parsed = json::parse(std::any_cast<std::string>(value));
      if (parsed.is_object()) {
        return parsed;
      }
    } catch (...) {
    }
  }
  return json::object();
}
} // namespace

std::string node_geometry::getType() const { return "geometry"; }
std::string node_geometry::getName() const { return "Geometry"; }
std::string node_geometry::getCategory() const { return "Data"; }
std::string node_geometry::getDescription() const {
  return "Union of colored points/lines/faces and textured mesh";
}

std::vector<Socket> node_geometry::getInputs() const {
  int pointsCount = 1;
  int linesCount = 1;
  int meshCount = 1;

  auto valuesIt = properties_.find("values");
  if (valuesIt != properties_.end()) {
    if (valuesIt->second.type() == typeid(std::vector<double>)) {
      const auto values = std::any_cast<std::vector<double>>(valuesIt->second);
      if (!values.empty()) {
        pointsCount = std::max(0, static_cast<int>(values[0]));
      }
      if (values.size() > 1) {
        linesCount = std::max(0, static_cast<int>(values[1]));
      }
      if (values.size() > 2) {
        meshCount = std::max(0, static_cast<int>(values[2]));
      }
    } else if (valuesIt->second.type() == typeid(std::vector<int>)) {
      const auto values = std::any_cast<std::vector<int>>(valuesIt->second);
      if (!values.empty()) {
        pointsCount = std::max(0, values[0]);
      }
      if (values.size() > 1) {
        linesCount = std::max(0, values[1]);
      }
      if (values.size() > 2) {
        meshCount = std::max(0, values[2]);
      }
    }
  } else {
    auto pointsIt = properties_.find("pointsCount");
    if (pointsIt != properties_.end()) {
      pointsCount = std::max(0, NodeUtils::getValue<int>(pointsIt->second, 1));
    }
    auto linesIt = properties_.find("linesCount");
    if (linesIt != properties_.end()) {
      linesCount = std::max(0, NodeUtils::getValue<int>(linesIt->second, 1));
    }
    auto meshIt = properties_.find("meshCount");
    if (meshIt != properties_.end()) {
      meshCount = std::max(0, NodeUtils::getValue<int>(meshIt->second, 1));
    }
  }

  std::vector<Socket> sockets;
  sockets.push_back(
      {"geometry", "Geometry", DataType::CUSTOM, GeometryData{}, "geometry"});
  for (int i = 0; i < pointsCount; ++i) {
    const std::string id = (i == 0) ? "points" : ("points" + std::to_string(i));
    const std::string label =
        (i == 0) ? "Points" : ("Points " + std::to_string(i));
    sockets.push_back({id, label, DataType::CUSTOM, PointCloud{}, "points"});
  }
  for (int i = 0; i < linesCount; ++i) {
    const std::string id = (i == 0) ? "lines" : ("lines" + std::to_string(i));
    const std::string label =
        (i == 0) ? "Lines" : ("Lines " + std::to_string(i));
    sockets.push_back({id, label, DataType::CUSTOM, LineSet{}, "lines"});
  }
  for (int i = 0; i < meshCount; ++i) {
    const std::string id = (i == 0) ? "mesh" : ("mesh" + std::to_string(i));
    const std::string label = (i == 0) ? "Mesh" : ("Mesh " + std::to_string(i));
    sockets.push_back({id, label, DataType::CUSTOM, Mesh{}, "mesh"});
  }
  sockets.push_back({"points_color", "Points Color", DataType::VECTOR,
                     std::vector<double>{0.97, 0.55, 0.16}});
  sockets.push_back({"lines_color", "Lines Color", DataType::VECTOR,
                     std::vector<double>{0.12, 0.14, 0.18}});
  sockets.push_back({"faces_color", "Faces Color", DataType::VECTOR,
                     std::vector<double>{0.82, 0.84, 0.88}});
  return sockets;
}

std::vector<Socket> node_geometry::getOutputs() const {
  return {
      {"geometry", "Geometry", DataType::CUSTOM, GeometryData{}, "geometry"}};
}

std::map<std::string, std::any> node_geometry::getProperties() const {
  std::map<std::string, std::any> props = {
      {"pointsCount", 1},
      {"linesCount", 1},
      {"meshCount", 1},
      {"values", std::vector<double>{1, 1, 1}}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_geometry::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#3182ce";
  auto valuesIt = schema.properties.find("values");
  if (valuesIt != schema.properties.end()) {
    valuesIt->second.editor = "text";
    valuesIt->second.description =
        "Input bucket counts for points, lines, and meshes.";
  }
  auto pointsIt = schema.properties.find("pointsCount");
  if (pointsIt != schema.properties.end()) {
    pointsIt->second.type = "number";
    pointsIt->second.editor = "number";
    pointsIt->second.description = "Number of point cloud inputs exposed.";
  }
  auto linesIt = schema.properties.find("linesCount");
  if (linesIt != schema.properties.end()) {
    linesIt->second.type = "number";
    linesIt->second.editor = "number";
    linesIt->second.description = "Number of line-set inputs exposed.";
  }
  auto meshIt = schema.properties.find("meshCount");
  if (meshIt != schema.properties.end()) {
    meshIt->second.type = "number";
    meshIt->second.editor = "number";
    meshIt->second.description = "Number of mesh inputs exposed.";
  }
  return schema;
}

bool node_geometry::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> & /*properties*/) {
  try {
    GeometryData geometry;

    auto parseColor = [](const std::any &value,
                         const std::array<float, 3> &fallback) {
      std::array<float, 3> c = fallback;
      if (value.type() == typeid(std::vector<double>)) {
        const auto raw = std::any_cast<std::vector<double>>(value);
        if (raw.size() >= 3) {
          c = {static_cast<float>(raw[0]), static_cast<float>(raw[1]),
               static_cast<float>(raw[2])};
        }
      } else if (value.type() == typeid(std::vector<int>)) {
        const auto raw = std::any_cast<std::vector<int>>(value);
        if (raw.size() >= 3) {
          c = {static_cast<float>(raw[0]), static_cast<float>(raw[1]),
               static_cast<float>(raw[2])};
        }
      }
      return c;
    };

    auto appendVertex = [](GeometryData &g, double x, double y, double z,
                           const std::array<float, 3> &color,
                           const std::array<float, 2> &uv) {
      g.positions.push_back(static_cast<float>(x));
      g.positions.push_back(static_cast<float>(y));
      g.positions.push_back(static_cast<float>(z));
      g.colors.push_back(color[0]);
      g.colors.push_back(color[1]);
      g.colors.push_back(color[2]);
      g.texcoords.push_back(uv[0]);
      g.texcoords.push_back(uv[1]);
      return static_cast<int>(g.positions.size() / 3 - 1);
    };

    const std::array<float, 3> pointColor = parseColor(
        inputs.count("points_color") ? inputs.at("points_color") : std::any{},
        {0.97f, 0.55f, 0.16f});
    const std::array<float, 3> lineColor = parseColor(
        inputs.count("lines_color") ? inputs.at("lines_color") : std::any{},
        {0.12f, 0.14f, 0.18f});
    const std::array<float, 3> faceColor = parseColor(
        inputs.count("faces_color") ? inputs.at("faces_color") : std::any{},
        {0.82f, 0.84f, 0.88f});

    auto gIt = inputs.find("geometry");
    if (gIt != inputs.end()) {
      if (const GeometryData *g =
              NodeUtils::getValuePtr<GeometryData>(gIt->second)) {
        geometry = *g;
      }
      const size_t vCount = geometry.positions.size() / 3;
      if (geometry.colors.size() != vCount * 3) {
        geometry.colors.assign(vCount * 3, 0.82f);
      }
      if (geometry.texcoords.size() != vCount * 2) {
        geometry.texcoords.assign(vCount * 2, 0.0f);
      }
      if (geometry.triTexcoordIndices.size() != geometry.triIndices.size()) {
        geometry.triTexcoordIndices.clear();
      }
      if (geometry.vectorLineFlags.size() != geometry.lineIndices.size() / 2) {
        geometry.vectorLineFlags.assign(geometry.lineIndices.size() / 2, 0);
      }
    }

    for (const auto &[key, value] : inputs) {
      if (key.rfind("mesh", 0) == 0) {
        const Mesh *mesh = NodeUtils::getValuePtr<Mesh>(value);
        if (!mesh)
          continue;
        GeometryData::Object object;
        object.type = "mesh";
        object.texturePath = mesh->texturePath.empty()
                                 ? "builtin://checkerboard"
                                 : mesh->texturePath;
        object.colorMap = mesh->colorMap;
        const int base = static_cast<int>(geometry.positions.size() / 3);
        const int uvBase = static_cast<int>(geometry.texcoords.size() / 2);
        const bool hasColor = mesh->colors.size() == mesh->vertices.size();
        const bool hasUV = mesh->texcoords.size() == mesh->vertices.size();
        for (size_t i = 0; i < mesh->vertices.size(); ++i) {
          const auto &v = mesh->vertices[i];
          std::array<float, 3> color = faceColor;
          if (hasColor) {
            color = {static_cast<float>(mesh->colors[i][0]),
                     static_cast<float>(mesh->colors[i][1]),
                     static_cast<float>(mesh->colors[i][2])};
          }
          std::array<float, 2> uv = {0.0f, 0.0f};
          if (hasUV) {
            uv = {static_cast<float>(mesh->texcoords[i][0]),
                  static_cast<float>(mesh->texcoords[i][1])};
          }
          appendVertex(geometry, v[0], v[1], v[2], color, uv);
          object.positions.push_back(static_cast<float>(v[0]));
          object.positions.push_back(static_cast<float>(v[1]));
          object.positions.push_back(static_cast<float>(v[2]));
          object.colors.push_back(color[0]);
          object.colors.push_back(color[1]);
          object.colors.push_back(color[2]);
          object.texcoords.push_back(uv[0]);
          object.texcoords.push_back(uv[1]);
        }
        for (size_t ti = 0; ti < mesh->triangles.size(); ++ti) {
          const auto &t = mesh->triangles[ti];
          geometry.triIndices.push_back(base + t[0]);
          geometry.triIndices.push_back(base + t[1]);
          geometry.triIndices.push_back(base + t[2]);
          object.triIndices.push_back(t[0]);
          object.triIndices.push_back(t[1]);
          object.triIndices.push_back(t[2]);
          if (!mesh->triangleTexcoords.empty() &&
              mesh->triangleTexcoords.size() == mesh->triangles.size()) {
            const auto &tuv = mesh->triangleTexcoords[ti];
            geometry.triTexcoordIndices.push_back(uvBase + tuv[0]);
            geometry.triTexcoordIndices.push_back(uvBase + tuv[1]);
            geometry.triTexcoordIndices.push_back(uvBase + tuv[2]);
            object.triTexcoordIndices.push_back(tuv[0]);
            object.triTexcoordIndices.push_back(tuv[1]);
            object.triTexcoordIndices.push_back(tuv[2]);
          } else {
            geometry.triTexcoordIndices.push_back(base + t[0]);
            geometry.triTexcoordIndices.push_back(base + t[1]);
            geometry.triTexcoordIndices.push_back(base + t[2]);
            object.triTexcoordIndices.push_back(t[0]);
            object.triTexcoordIndices.push_back(t[1]);
            object.triTexcoordIndices.push_back(t[2]);
          }
        }
        if (!mesh->texturePath.empty()) {
          geometry.texturePath = mesh->texturePath;
        }
        geometry.objects.push_back(std::move(object));
        continue;
      }

      if (key.rfind("points", 0) == 0) {
        const PointCloud *points = NodeUtils::getValuePtr<PointCloud>(value);
        if (!points)
          continue;
        GeometryData::Object object;
        object.type = "points";
        object.colorMap = "points_color";
        const bool hasPointColors =
            points->colors.size() == points->vertices.size();
        for (size_t i = 0; i < points->vertices.size(); ++i) {
          const auto &p = points->vertices[i];
          std::array<float, 3> color = pointColor;
          if (hasPointColors) {
            color = {static_cast<float>(points->colors[i][0]),
                     static_cast<float>(points->colors[i][1]),
                     static_cast<float>(points->colors[i][2])};
          }
          const int idx =
              appendVertex(geometry, p[0], p[1], p[2], color, {0.0f, 0.0f});
          geometry.pointIndices.push_back(idx);
          object.positions.push_back(static_cast<float>(p[0]));
          object.positions.push_back(static_cast<float>(p[1]));
          object.positions.push_back(static_cast<float>(p[2]));
          object.colors.push_back(color[0]);
          object.colors.push_back(color[1]);
          object.colors.push_back(color[2]);
          object.texcoords.push_back(0.0f);
          object.texcoords.push_back(0.0f);
          object.pointIndices.push_back(
              static_cast<int>(object.positions.size() / 3 - 1));
        }
        if (!object.positions.empty()) {
          geometry.objects.push_back(std::move(object));
        }
        continue;
      }

      if (key.rfind("lines", 0) == 0) {
        const LineSet *lines = NodeUtils::getValuePtr<LineSet>(value);
        if (!lines)
          continue;
        GeometryData::Object object;
        object.type = "lines";
        object.colorMap = lines->directed ? "directed" : "undirected";
        const int base = static_cast<int>(geometry.positions.size() / 3);
        for (const auto &p : lines->points) {
          appendVertex(geometry, p[0], p[1], p[2], lineColor, {0.0f, 0.0f});
          object.positions.push_back(static_cast<float>(p[0]));
          object.positions.push_back(static_cast<float>(p[1]));
          object.positions.push_back(static_cast<float>(p[2]));
          object.colors.push_back(lineColor[0]);
          object.colors.push_back(lineColor[1]);
          object.colors.push_back(lineColor[2]);
          object.texcoords.push_back(0.0f);
          object.texcoords.push_back(0.0f);
        }
        for (const auto &seg : lines->segments) {
          const int a = base + seg[0];
          const int b = base + seg[1];
          if (a < base || b < base ||
              a >= static_cast<int>(geometry.positions.size() / 3) ||
              b >= static_cast<int>(geometry.positions.size() / 3)) {
            continue;
          }
          geometry.lineIndices.push_back(a);
          geometry.lineIndices.push_back(b);
          geometry.vectorLineFlags.push_back(lines->directed ? 1 : 0);
          object.lineIndices.push_back(seg[0]);
          object.lineIndices.push_back(seg[1]);
          object.vectorLineFlags.push_back(lines->directed ? 1 : 0);
        }
        if (!object.positions.empty()) {
          geometry.objects.push_back(std::move(object));
        }
      }
    }

    if (geometry.positions.empty()) {
      geometry = makeDefaultGeometry();
    }
    if (geometry.texturePath.empty()) {
      geometry.texturePath = "builtin://checkerboard";
    }

    outputs["geometry"] = std::make_shared<GeometryData>(std::move(geometry));
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Geometry node error: ") + e.what();
    return false;
  }
}

std::string node_geometry_viewer::getType() const { return "geometry_viewer"; }
std::string node_geometry_viewer::getName() const { return "Geometry Viewer"; }
std::string node_geometry_viewer::getCategory() const { return "Interaction"; }
std::string node_geometry_viewer::getDescription() const {
  return "Render geometry object with points/lines/triangles in one pass";
}

std::vector<Socket> node_geometry_viewer::getInputs() const {
  return {
      {"geometry", "Geometry", DataType::CUSTOM, GeometryData{}, "geometry"},
      {"light", "Light Dir", DataType::VECTOR,
       std::vector<double>{0.45, 0.75, 0.55}},
      {"intensity", "Intensity", DataType::NUMBER, 1.2},
  };
}

std::vector<Socket> node_geometry_viewer::getOutputs() const {
  return {{"view", "View", DataType::CUSTOM, GeometryViewPayload{},
           "geometry_view_payload"},
          {"interaction", "Interaction", DataType::MAP, json::object()},
          {"ok", "OK", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> node_geometry_viewer::getProperties() const {
  std::map<std::string, std::any> props = {
      {"light", std::vector<double>{0.45, 0.75, 0.55}},
      {"intensity", 1.2},
      // Keep latest interaction event in properties so stateless exec mode
      // can still reconstruct viewer->interaction socket output.
      {"interaction_event", json::object()}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_geometry_viewer::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2f855a";
  auto lightIt = schema.properties.find("light");
  if (lightIt != schema.properties.end()) {
    lightIt->second.editor = "text";
    lightIt->second.description =
        "Fallback light direction used when no light socket is connected.";
  }
  auto intensityIt = schema.properties.find("intensity");
  if (intensityIt != schema.properties.end()) {
    intensityIt->second.type = "number";
    intensityIt->second.editor = "number";
    intensityIt->second.description =
        "Fallback light intensity used by the geometry viewer.";
  }
  auto interactionIt = schema.properties.find("interaction_event");
  if (interactionIt != schema.properties.end()) {
    interactionIt->second.editor = "readonly";
    interactionIt->second.editable = false;
    interactionIt->second.description =
        "Most recent normalized viewer interaction event.";
  }
  return schema;
}

bool node_geometry_viewer::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  outputs["ok"] = 0.0;
  try {
    GeometryData geometry;
    auto gIt = inputs.find("geometry");
    if (gIt != inputs.end()) {
      if (const GeometryData *g =
              NodeUtils::getValuePtr<GeometryData>(gIt->second)) {
        geometry = *g;
      }
    }
    if (geometry.positions.empty()) {
      geometry = makeDefaultGeometry();
    }

    std::vector<double> lightValues = {0.45, 0.75, 0.55};
    auto lightIt = inputs.find("light");
    if (lightIt != inputs.end()) {
      lightValues = NodeUtils::getValue<std::vector<double>>(lightIt->second,
                                                             lightValues);
    } else {
      auto propLightIt = properties.find("light");
      if (propLightIt != properties.end()) {
        lightValues = NodeUtils::getValue<std::vector<double>>(
            propLightIt->second, lightValues);
      }
    }
    if (lightValues.size() < 3) {
      lightValues.resize(3, 0.0);
    }
    double intensity = 1.2;
    auto intensityIt = inputs.find("intensity");
    if (intensityIt != inputs.end()) {
      intensity = NodeUtils::getValue<double>(intensityIt->second, intensity);
    } else {
      auto propIntensityIt = properties.find("intensity");
      if (propIntensityIt != properties.end()) {
        intensity =
            NodeUtils::getValue<double>(propIntensityIt->second, intensity);
      }
    }
    intensity = std::max(0.0, intensity);

    std::array<double, 3> boundsMin;
    std::array<double, 3> boundsMax;
    computeGeometryBounds(geometry, boundsMin, boundsMax);
    std::uint64_t hash = computeGeometryHash(geometry);

    GeometryViewPayload payload;
    payload.viewerType = "geometry";
    payload.meshId = "geom_" + hashToHex(hash);
    payload.version = hash;
    payload.dataFormat = "packed_g1";
    payload.objects = geometry.objects;
    payload.positions = geometry.positions;
    payload.colors = geometry.colors;
    payload.texcoords = geometry.texcoords;
    payload.triTexcoordIndices = geometry.triTexcoordIndices;
    payload.triIndices = geometry.triIndices;
    payload.lineIndices = geometry.lineIndices;
    payload.pointIndices = geometry.pointIndices;
    payload.vectorLineFlags = geometry.vectorLineFlags;
    payload.texturePath = geometry.texturePath;
    payload.lightDirection = {lightValues[0], lightValues[1], lightValues[2]};
    payload.lightIntensity = intensity;
    payload.boundsMin = boundsMin;
    payload.boundsMax = boundsMax;

    outputs["view"] = std::make_shared<GeometryViewPayload>(std::move(payload));
    auto interactionIt = properties.find("interaction_event");
    if (interactionIt != properties.end()) {
      outputs["interaction"] = anyToJsonObjectSafe(interactionIt->second);
    } else {
      outputs["interaction"] = json::object();
    }
    outputs["ok"] = 1.0;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Geometry Viewer node error: ") + e.what();
    return false;
  }
}

namespace {
struct geometry_any_to_json_registrar {
  geometry_any_to_json_registrar() {
    NodeUtils::registerAnyToJson<GeometryData>(
        [](const std::any &value, json &out) {
          const auto &g = std::any_cast<const GeometryData &>(value);
          json objects = json::array();
          for (const auto &obj : g.objects) {
            json j = json::object();
            j["type"] = obj.type;
            j["positions"] = obj.positions;
            j["colors"] = obj.colors;
            j["texcoords"] = obj.texcoords;
            j["triTexcoordIndices"] = obj.triTexcoordIndices;
            j["triIndices"] = obj.triIndices;
            j["lineIndices"] = obj.lineIndices;
            j["pointIndices"] = obj.pointIndices;
            j["vectorLineFlags"] = obj.vectorLineFlags;
            j["texturePath"] = obj.texturePath;
            j["colorMap"] = obj.colorMap;
            objects.push_back(std::move(j));
          }
          out = json::object();
          out["objects"] = objects;
          out["positions"] = g.positions;
          out["colors"] = g.colors;
          out["texcoords"] = g.texcoords;
          out["triTexcoordIndices"] = g.triTexcoordIndices;
          out["triIndices"] = g.triIndices;
          out["lineIndices"] = g.lineIndices;
          out["pointIndices"] = g.pointIndices;
          out["vectorLineFlags"] = g.vectorLineFlags;
          out["texturePath"] = g.texturePath;
          appendGeometryStreamMetadata(out, g);
          return true;
        });
    NodeUtils::registerAnyToJson<GeometryViewPayload>(
        [](const std::any &value, json &out) {
          const auto &p = std::any_cast<const GeometryViewPayload &>(value);
          json objects = json::array();
          for (const auto &obj : p.objects) {
            json j = json::object();
            j["type"] = obj.type;
            j["positions"] = obj.positions;
            j["colors"] = obj.colors;
            j["texcoords"] = obj.texcoords;
            j["triTexcoordIndices"] = obj.triTexcoordIndices;
            j["triIndices"] = obj.triIndices;
            j["lineIndices"] = obj.lineIndices;
            j["pointIndices"] = obj.pointIndices;
            j["vectorLineFlags"] = obj.vectorLineFlags;
            j["texturePath"] = obj.texturePath;
            j["colorMap"] = obj.colorMap;
            objects.push_back(std::move(j));
          }
          out = json::object();
          out["viewerType"] = p.viewerType;
          out["meshId"] = p.meshId;
          out["version"] = p.version;
          out["dataFormat"] = p.dataFormat;
          out["objects"] = objects;
          out["positions"] = p.positions;
          out["colors"] = p.colors;
          out["texcoords"] = p.texcoords;
          out["triTexcoordIndices"] = p.triTexcoordIndices;
          out["triIndices"] = p.triIndices;
          out["lineIndices"] = p.lineIndices;
          out["pointIndices"] = p.pointIndices;
          out["vectorLineFlags"] = p.vectorLineFlags;
          out["texturePath"] = p.texturePath;
          out["vertexCount"] = p.positions.size() / 3;
          out["triangleCount"] = p.triIndices.size() / 3;
          out["lineCount"] = p.lineIndices.size() / 2;
          out["pointCount"] = p.pointIndices.size();
          out["lightDirection"] = {p.lightDirection[0], p.lightDirection[1],
                                   p.lightDirection[2]};
          out["lightIntensity"] = p.lightIntensity;
          out["boundsMin"] = {p.boundsMin[0], p.boundsMin[1], p.boundsMin[2]};
          out["boundsMax"] = {p.boundsMax[0], p.boundsMax[1], p.boundsMax[2]};
          return true;
        });
    NodeUtils::registerAnyToJson<std::shared_ptr<GeometryData>>(
        [](const std::any &value, json &out) {
          const auto &gPtr =
              std::any_cast<const std::shared_ptr<GeometryData> &>(value);
          if (!gPtr) {
            out = json::object();
            out["objects"] = json::array();
            out["positions"] = json::array();
            out["colors"] = json::array();
            out["texcoords"] = json::array();
            out["triTexcoordIndices"] = json::array();
            out["triIndices"] = json::array();
            out["lineIndices"] = json::array();
            out["pointIndices"] = json::array();
            out["vectorLineFlags"] = json::array();
            out["texturePath"] = "";
            appendGeometryStreamMetadata(out, GeometryData{});
            return true;
          }
          const auto &g = *gPtr;
          json objects = json::array();
          for (const auto &obj : g.objects) {
            json j = json::object();
            j["type"] = obj.type;
            j["positions"] = obj.positions;
            j["colors"] = obj.colors;
            j["texcoords"] = obj.texcoords;
            j["triTexcoordIndices"] = obj.triTexcoordIndices;
            j["triIndices"] = obj.triIndices;
            j["lineIndices"] = obj.lineIndices;
            j["pointIndices"] = obj.pointIndices;
            j["vectorLineFlags"] = obj.vectorLineFlags;
            j["texturePath"] = obj.texturePath;
            j["colorMap"] = obj.colorMap;
            objects.push_back(std::move(j));
          }
          out = json::object();
          out["objects"] = objects;
          out["positions"] = g.positions;
          out["colors"] = g.colors;
          out["texcoords"] = g.texcoords;
          out["triTexcoordIndices"] = g.triTexcoordIndices;
          out["triIndices"] = g.triIndices;
          out["lineIndices"] = g.lineIndices;
          out["pointIndices"] = g.pointIndices;
          out["vectorLineFlags"] = g.vectorLineFlags;
          out["texturePath"] = g.texturePath;
          appendGeometryStreamMetadata(out, g);
          return true;
        });
    NodeUtils::registerAnyToJson<std::shared_ptr<GeometryViewPayload>>(
        [](const std::any &value, json &out) {
          const auto &pPtr =
              std::any_cast<const std::shared_ptr<GeometryViewPayload> &>(
                  value);
          if (!pPtr) {
            out = json::object();
            out["viewerType"] = "geometry";
            out["meshId"] = "";
            out["version"] = 0;
            out["dataFormat"] = "packed_g1";
            out["objects"] = json::array();
            out["positions"] = json::array();
            out["colors"] = json::array();
            out["texcoords"] = json::array();
            out["triTexcoordIndices"] = json::array();
            out["triIndices"] = json::array();
            out["lineIndices"] = json::array();
            out["pointIndices"] = json::array();
            out["vectorLineFlags"] = json::array();
            out["texturePath"] = "builtin://checkerboard";
            out["vertexCount"] = 0;
            out["triangleCount"] = 0;
            out["lineCount"] = 0;
            out["pointCount"] = 0;
            out["lightDirection"] = {0.45, 0.75, 0.55};
            out["lightIntensity"] = 1.2;
            out["boundsMin"] = {-1.0, -1.0, -1.0};
            out["boundsMax"] = {1.0, 1.0, 1.0};
            return true;
          }
          const auto &p = *pPtr;
          json objects = json::array();
          for (const auto &obj : p.objects) {
            json j = json::object();
            j["type"] = obj.type;
            j["positions"] = obj.positions;
            j["colors"] = obj.colors;
            j["texcoords"] = obj.texcoords;
            j["triTexcoordIndices"] = obj.triTexcoordIndices;
            j["triIndices"] = obj.triIndices;
            j["lineIndices"] = obj.lineIndices;
            j["pointIndices"] = obj.pointIndices;
            j["vectorLineFlags"] = obj.vectorLineFlags;
            j["texturePath"] = obj.texturePath;
            j["colorMap"] = obj.colorMap;
            objects.push_back(std::move(j));
          }
          out = json::object();
          out["viewerType"] = p.viewerType;
          out["meshId"] = p.meshId;
          out["version"] = p.version;
          out["dataFormat"] = p.dataFormat;
          out["objects"] = objects;
          out["positions"] = p.positions;
          out["colors"] = p.colors;
          out["texcoords"] = p.texcoords;
          out["triTexcoordIndices"] = p.triTexcoordIndices;
          out["triIndices"] = p.triIndices;
          out["lineIndices"] = p.lineIndices;
          out["pointIndices"] = p.pointIndices;
          out["vectorLineFlags"] = p.vectorLineFlags;
          out["texturePath"] = p.texturePath;
          out["vertexCount"] = p.positions.size() / 3;
          out["triangleCount"] = p.triIndices.size() / 3;
          out["lineCount"] = p.lineIndices.size() / 2;
          out["pointCount"] = p.pointIndices.size();
          out["lightDirection"] = {p.lightDirection[0], p.lightDirection[1],
                                   p.lightDirection[2]};
          out["lightIntensity"] = p.lightIntensity;
          out["boundsMin"] = {p.boundsMin[0], p.boundsMin[1], p.boundsMin[2]};
          out["boundsMax"] = {p.boundsMax[0], p.boundsMax[1], p.boundsMax[2]};
          return true;
        });
  }
};

geometry_any_to_json_registrar geometry_any_to_json_registrar_instance;
NodeRegistrar<node_geometry> node_geometry_registrar;
NodeRegistrar<node_geometry_viewer> node_geometry_viewer_registrar;
} // namespace
