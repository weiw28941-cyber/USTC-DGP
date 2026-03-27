#include "node_mesh.h"
#include "node_texture.h"
#include <cmath>
#include <fstream>
#include <memory>
#include <sstream>
#include <utility>

namespace {
std::string ensureTexturePathOrChecker(const std::string &path) {
  const auto begin = path.find_first_not_of(" \t\r\n");
  if (begin == std::string::npos) {
    return "builtin://checkerboard";
  }
  const auto end = path.find_last_not_of(" \t\r\n");
  return path.substr(begin, end - begin + 1);
}

Mesh makeBoxMesh(double halfExtent, const std::string &colorMap,
                 const std::string &texturePath) {
  Mesh mesh;
  mesh.vertices = {
      {-halfExtent, -halfExtent, -halfExtent},
      {halfExtent, -halfExtent, -halfExtent},
      {halfExtent, halfExtent, -halfExtent},
      {-halfExtent, halfExtent, -halfExtent},
      {-halfExtent, -halfExtent, halfExtent},
      {halfExtent, -halfExtent, halfExtent},
      {halfExtent, halfExtent, halfExtent},
      {-halfExtent, halfExtent, halfExtent},
  };
  mesh.triangles = {
      {0, 1, 2}, {0, 2, 3}, {4, 6, 5}, {4, 7, 6}, {0, 4, 5}, {0, 5, 1},
      {3, 2, 6}, {3, 6, 7}, {1, 5, 6}, {1, 6, 2}, {0, 3, 7}, {0, 7, 4},
  };
  mesh.texcoords = {
      {0.0, 0.0}, {1.0, 0.0}, {1.0, 1.0}, {0.0, 1.0},
      {0.0, 0.0}, {1.0, 0.0}, {1.0, 1.0}, {0.0, 1.0},
  };
  mesh.triangleTexcoords = mesh.triangles;
  mesh.colorMap = colorMap;
  mesh.texturePath = ensureTexturePathOrChecker(texturePath);

  mesh.colors.reserve(mesh.vertices.size());
  for (const auto &v : mesh.vertices) {
    if (colorMap == "height") {
      const double t = (v[2] + halfExtent) / (2.0 * halfExtent + 1e-12);
      mesh.colors.push_back({t, 0.25, 1.0 - t});
    } else if (colorMap == "normal") {
      const double nx = (v[0] / (halfExtent + 1e-12) + 1.0) * 0.5;
      const double ny = (v[1] / (halfExtent + 1e-12) + 1.0) * 0.5;
      const double nz = (v[2] / (halfExtent + 1e-12) + 1.0) * 0.5;
      mesh.colors.push_back({nx, ny, nz});
    } else {
      mesh.colors.push_back({0.85, 0.85, 0.85});
    }
  }
  return mesh;
}

std::string trim(const std::string &s) {
  const auto begin = s.find_first_not_of(" \t\r\n");
  if (begin == std::string::npos) {
    return "";
  }
  const auto end = s.find_last_not_of(" \t\r\n");
  return s.substr(begin, end - begin + 1);
}

bool parseFaceToken(const std::string &token, int &vIdx, int &vtIdx) {
  vIdx = 0;
  vtIdx = 0;
  const auto firstSlash = token.find('/');
  if (firstSlash == std::string::npos) {
    try {
      vIdx = std::stoi(token);
      return true;
    } catch (...) {
      return false;
    }
  }

  const std::string vText = token.substr(0, firstSlash);
  if (vText.empty()) {
    return false;
  }
  try {
    vIdx = std::stoi(vText);
  } catch (...) {
    return false;
  }

  const auto secondSlash = token.find('/', firstSlash + 1);
  const std::string vtText =
      token.substr(firstSlash + 1, secondSlash - (firstSlash + 1));
  if (!vtText.empty()) {
    try {
      vtIdx = std::stoi(vtText);
    } catch (...) {
      return false;
    }
  }
  return true;
}
} // namespace

std::string node_mesh::getType() const { return "mesh"; }
std::string node_mesh::getName() const { return "Mesh"; }
std::string node_mesh::getCategory() const { return "Data"; }
std::string node_mesh::getDescription() const {
  return "Triangle mesh with colormap, UV and texture path";
}
std::vector<Socket> node_mesh::getInputs() const {
  return {
      {"vertices", "Vertices(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
      {"indices", "Indices(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
      {"colors", "Colors(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
      {"uv", "UV(Nx2)", DataType::MATRIX, std::vector<std::vector<double>>{}},
      {"texture", "Texture", DataType::CUSTOM, TextureData{}, "texture"}};
}

std::vector<Socket> node_mesh::getOutputs() const {
  return {{"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"}};
}

std::map<std::string, std::any> node_mesh::getProperties() const {
  std::map<std::string, std::any> props = {{"size", 1.0},
                                           {"operation", std::string("solid")}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

std::map<std::string, std::vector<std::string>>
node_mesh::getPropertyOptions() const {
  return {{"operation", {"solid", "height", "normal"}}};
}

NodeSchema node_mesh::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#3182ce";
  auto sizeIt = schema.properties.find("size");
  if (sizeIt != schema.properties.end()) {
    sizeIt->second.type = "number";
    sizeIt->second.editor = "number";
    sizeIt->second.description = "Fallback primitive size used when no "
                                 "vertex/index matrices are connected.";
  }
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Coloring mode used for the generated fallback mesh.";
  }
  return schema;
}

bool node_mesh::execute(const std::map<std::string, std::any> &inputs,
                        std::map<std::string, std::any> &outputs,
                        const std::map<std::string, std::any> &properties) {
  try {
    const auto sizeIt = properties.find("size");
    const double size = (sizeIt != properties.end())
                            ? NodeUtils::getValue<double>(sizeIt->second, 1.0)
                            : 1.0;
    std::string colorMap = "solid";
    auto opIt = properties.find("operation");
    if (opIt != properties.end()) {
      colorMap = NodeUtils::getValue<std::string>(opIt->second, "solid");
    }

    std::string texturePath;
    auto texInputIt = inputs.find("texture");
    if (texInputIt != inputs.end() &&
        texInputIt->second.type() == typeid(TextureData)) {
      const TextureData tex = std::any_cast<TextureData>(texInputIt->second);
      texturePath = tex.path;
    }

    texturePath = ensureTexturePathOrChecker(texturePath);
    Mesh mesh = makeBoxMesh(size, colorMap, texturePath);

    auto verticesIt = inputs.find("vertices");
    auto indicesIt = inputs.find("indices");
    if (verticesIt != inputs.end() && indicesIt != inputs.end()) {
      const auto verticesMat =
          NodeUtils::getValue<std::vector<std::vector<double>>>(
              verticesIt->second, {});
      const auto idxMat = NodeUtils::getValue<std::vector<std::vector<double>>>(
          indicesIt->second, {});
      if (verticesMat.empty()) {
        errorMessage = "Mesh node error: vertices matrix is empty";
        return false;
      }
      if (idxMat.empty()) {
        errorMessage = "Mesh node error: indices matrix is empty";
        return false;
      }

      mesh = Mesh{};
      mesh.colorMap = colorMap;
      mesh.texturePath = texturePath;
      mesh.vertices.reserve(verticesMat.size());
      for (const auto &row : verticesMat) {
        if (row.size() != 3) {
          errorMessage = "Mesh node error: vertices matrix must be N x 3";
          return false;
        }
        mesh.vertices.push_back({row[0], row[1], row[2]});
      }
      mesh.triangles.reserve(idxMat.size());
      for (const auto &row : idxMat) {
        if (row.size() != 3) {
          errorMessage = "Mesh node error: indices matrix must be N x 3";
          return false;
        }
        const int a = static_cast<int>(std::round(row[0]));
        const int b = static_cast<int>(std::round(row[1]));
        const int c = static_cast<int>(std::round(row[2]));
        if (std::fabs(row[0] - a) > 1e-9 || std::fabs(row[1] - b) > 1e-9 ||
            std::fabs(row[2] - c) > 1e-9) {
          errorMessage = "Mesh node error: indices must be integers";
          return false;
        }
        if (a < 0 || b < 0 || c < 0 ||
            a >= static_cast<int>(mesh.vertices.size()) ||
            b >= static_cast<int>(mesh.vertices.size()) ||
            c >= static_cast<int>(mesh.vertices.size())) {
          errorMessage = "Mesh node error: indices out of vertex range";
          return false;
        }
        mesh.triangles.push_back({a, b, c});
      }
    }

    auto colorIt = inputs.find("colors");
    if (colorIt != inputs.end()) {
      const auto colorMat =
          NodeUtils::getValue<std::vector<std::vector<double>>>(colorIt->second,
                                                                {});
      if (!colorMat.empty()) {
        if (colorMat.size() != mesh.vertices.size()) {
          errorMessage =
              "Mesh node error: color row count must match vertex count";
          return false;
        }
        mesh.colors.clear();
        mesh.colors.reserve(colorMat.size());
        for (const auto &row : colorMat) {
          if (row.size() < 3) {
            errorMessage =
                "Mesh node error: colors matrix must be N x 3 (or N x 4)";
            return false;
          }
          mesh.colors.push_back({row[0], row[1], row[2]});
        }
      }
    }

    auto uvIt = inputs.find("uv");
    if (uvIt != inputs.end()) {
      const auto uvMat = NodeUtils::getValue<std::vector<std::vector<double>>>(
          uvIt->second, {});
      if (!uvMat.empty()) {
        if (uvMat.size() != mesh.vertices.size()) {
          errorMessage =
              "Mesh node error: uv row count must match vertex count";
          return false;
        }
        mesh.texcoords.clear();
        mesh.texcoords.reserve(uvMat.size());
        for (const auto &row : uvMat) {
          if (row.size() != 2) {
            errorMessage = "Mesh node error: uv matrix must be N x 2";
            return false;
          }
          mesh.texcoords.push_back({row[0], row[1]});
        }
        mesh.triangleTexcoords = mesh.triangles;
      }
    }

    outputs["mesh"] = std::make_shared<Mesh>(std::move(mesh));
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Mesh node error: ") + e.what();
    return false;
  }
}

std::string node_loadmesh::getType() const { return "load_mesh"; }
std::string node_loadmesh::getName() const { return "Load Mesh"; }
std::string node_loadmesh::getCategory() const { return "Method"; }
std::string node_loadmesh::getDescription() const {
  return "Load mesh from file path";
}

std::vector<Socket> node_loadmesh::getInputs() const {
  return {{"path", "Path", DataType::STRING, std::string("")}};
}

std::vector<Socket> node_loadmesh::getOutputs() const {
  return {{"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"}};
}

std::map<std::string, std::any> node_loadmesh::getProperties() const {
  std::map<std::string, std::any> props = {{"path", std::string("")}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_loadmesh::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  auto pathIt = schema.properties.find("path");
  if (pathIt != schema.properties.end()) {
    pathIt->second.editor = "text";
    pathIt->second.description = "Path to the mesh file loaded by this node.";
  }
  return schema;
}

bool node_loadmesh::execute(const std::map<std::string, std::any> &inputs,
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
      errorMessage = "Load Mesh node error: path is empty";
      return false;
    }

    std::ifstream file(path);
    if (!file.is_open()) {
      errorMessage = "Load Mesh node error: cannot open file: " + path;
      return false;
    }

    Mesh mesh;
    std::vector<std::array<double, 2>> vtPool;
    std::string line;
    while (std::getline(file, line)) {
      line = trim(line);
      if (line.empty() || line[0] == '#') {
        if (line.rfind("# texture_path ", 0) == 0) {
          mesh.texturePath = trim(line.substr(15));
        } else if (line.rfind("# colormap ", 0) == 0) {
          mesh.colorMap = trim(line.substr(11));
        }
        continue;
      }
      if (line.rfind("v ", 0) == 0) {
        std::istringstream iss(line.substr(2));
        double x = 0.0, y = 0.0, z = 0.0;
        if (!(iss >> x >> y >> z)) {
          errorMessage = "Load Mesh node error: invalid vertex line";
          return false;
        }
        mesh.vertices.push_back({x, y, z});
      } else if (line.rfind("vt ", 0) == 0) {
        std::istringstream iss(line.substr(3));
        double u = 0.0, v = 0.0;
        if (!(iss >> u >> v)) {
          errorMessage = "Load Mesh node error: invalid texcoord line";
          return false;
        }
        vtPool.push_back({u, v});
      } else if (line.rfind("f ", 0) == 0) {
        std::istringstream iss(line.substr(2));
        std::vector<int> faceV;
        std::vector<int> faceVt;
        std::string token;
        while (iss >> token) {
          int vIdx = 0;
          int vtIdx = 0;
          if (!parseFaceToken(token, vIdx, vtIdx)) {
            errorMessage = "Load Mesh node error: invalid face token";
            return false;
          }
          if (vIdx == 0) {
            errorMessage = "Load Mesh node error: OBJ index 0 is invalid";
            return false;
          }
          if (vIdx < 0) {
            vIdx = static_cast<int>(mesh.vertices.size()) + vIdx + 1;
          }
          if (vIdx <= 0 || vIdx > static_cast<int>(mesh.vertices.size())) {
            errorMessage = "Load Mesh node error: face index out of range";
            return false;
          }
          faceV.push_back(vIdx - 1);

          if (vtIdx != 0) {
            if (vtIdx < 0) {
              vtIdx = static_cast<int>(vtPool.size()) + vtIdx + 1;
            }
            if (vtIdx <= 0 || vtIdx > static_cast<int>(vtPool.size())) {
              errorMessage =
                  "Load Mesh node error: texcoord index out of range";
              return false;
            }
            faceVt.push_back(vtIdx - 1);
          } else {
            faceVt.push_back(-1);
          }
        }
        if (faceV.size() < 3) {
          continue;
        }
        for (size_t i = 1; i + 1 < faceV.size(); ++i) {
          mesh.triangles.push_back({faceV[0], faceV[i], faceV[i + 1]});
          if (faceVt[0] >= 0 && faceVt[i] >= 0 && faceVt[i + 1] >= 0) {
            mesh.triangleTexcoords.push_back(
                {faceVt[0], faceVt[i], faceVt[i + 1]});
          }
        }
      }
    }

    if (mesh.vertices.empty()) {
      errorMessage = "Load Mesh node error: no vertices loaded";
      return false;
    }
    if (!mesh.triangleTexcoords.empty()) {
      mesh.texcoords = vtPool;
    }
    if (mesh.colorMap.empty()) {
      mesh.colorMap = "solid";
    }
    mesh.texturePath = ensureTexturePathOrChecker(mesh.texturePath);
    outputs["mesh"] = std::make_shared<Mesh>(std::move(mesh));
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Load Mesh node error: ") + e.what();
    return false;
  }
}

std::string node_writemesh::getType() const { return "write_mesh"; }
std::string node_writemesh::getName() const { return "Write Mesh"; }
std::string node_writemesh::getCategory() const { return "Method"; }
std::string node_writemesh::getDescription() const {
  return "Write mesh to OBJ file path";
}

std::vector<Socket> node_writemesh::getInputs() const {
  return {{"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"},
          {"path", "Path", DataType::STRING, std::string("")}};
}

std::vector<Socket> node_writemesh::getOutputs() const {
  return {{"ok", "OK", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> node_writemesh::getProperties() const {
  std::map<std::string, std::any> props = {{"path", std::string("")}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema node_writemesh::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  auto pathIt = schema.properties.find("path");
  if (pathIt != schema.properties.end()) {
    pathIt->second.editor = "text";
    pathIt->second.description =
        "Output OBJ path used when exporting the mesh.";
  }
  return schema;
}

bool node_writemesh::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  outputs["ok"] = 0.0;
  try {
    auto meshIt = inputs.find("mesh");
    if (meshIt == inputs.end()) {
      errorMessage = "Write Mesh node error: input mesh is missing or invalid";
      return false;
    }
    const Mesh *mesh = NodeUtils::getValuePtr<Mesh>(meshIt->second);
    if (!mesh) {
      errorMessage = "Write Mesh node error: input mesh is missing or invalid";
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
      errorMessage = "Write Mesh node error: path is empty";
      return false;
    }

    for (const auto &tri : mesh->triangles) {
      for (int idx : tri) {
        if (idx < 0 || idx >= static_cast<int>(mesh->vertices.size())) {
          errorMessage =
              "Write Mesh node error: triangle index out of vertex range";
          return false;
        }
      }
    }

    std::ofstream file(path, std::ios::out | std::ios::trunc);
    if (!file.is_open()) {
      errorMessage = "Write Mesh node error: cannot open file: " + path;
      return false;
    }
    file << "# Exported by NodeGraphProcessor\n";
    if (!mesh->texturePath.empty()) {
      file << "# texture_path " << mesh->texturePath << "\n";
    }
    if (!mesh->colorMap.empty()) {
      file << "# colormap " << mesh->colorMap << "\n";
    }
    for (const auto &v : mesh->vertices) {
      file << "v " << v[0] << " " << v[1] << " " << v[2] << "\n";
    }
    const bool hasFaceUV =
        (!mesh->texcoords.empty() &&
         mesh->triangleTexcoords.size() == mesh->triangles.size());
    if (hasFaceUV) {
      for (const auto &uv : mesh->texcoords) {
        file << "vt " << uv[0] << " " << uv[1] << "\n";
      }
    }
    for (size_t i = 0; i < mesh->triangles.size(); ++i) {
      const auto &tri = mesh->triangles[i];
      if (hasFaceUV) {
        const auto &tuv = mesh->triangleTexcoords[i];
        if (tuv[0] < 0 || tuv[1] < 0 || tuv[2] < 0 ||
            tuv[0] >= static_cast<int>(mesh->texcoords.size()) ||
            tuv[1] >= static_cast<int>(mesh->texcoords.size()) ||
            tuv[2] >= static_cast<int>(mesh->texcoords.size())) {
          errorMessage = "Write Mesh node error: texcoord index out of range";
          return false;
        }
        file << "f " << (tri[0] + 1) << "/" << (tuv[0] + 1) << " "
             << (tri[1] + 1) << "/" << (tuv[1] + 1) << " " << (tri[2] + 1)
             << "/" << (tuv[2] + 1) << "\n";
      } else {
        file << "f " << (tri[0] + 1) << " " << (tri[1] + 1) << " "
             << (tri[2] + 1) << "\n";
      }
    }
    if (!file.good()) {
      errorMessage = "Write Mesh node error: write failed: " + path;
      return false;
    }

    outputs["ok"] = 1.0;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Write Mesh node error: ") + e.what();
    return false;
  }
}

std::string node_mesh_attributes::getType() const { return "mesh_attributes"; }
std::string node_mesh_attributes::getName() const { return "Mesh Attributes"; }
std::string node_mesh_attributes::getCategory() const { return "Method"; }
std::string node_mesh_attributes::getDescription() const {
  return "Split mesh into vertices/indices/colors/uv/texture";
}

std::vector<Socket> node_mesh_attributes::getInputs() const {
  return {{"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"}};
}

std::vector<Socket> node_mesh_attributes::getOutputs() const {
  return {
      {"vertices", "Vertices(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
      {"indices", "Indices(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
      {"colors", "Colors(Nx3)", DataType::MATRIX,
       std::vector<std::vector<double>>{}},
      {"uv", "UV(Nx2)", DataType::MATRIX, std::vector<std::vector<double>>{}},
      {"texture", "Texture", DataType::CUSTOM, TextureData{}, "texture"}};
}

std::map<std::string, std::any> node_mesh_attributes::getProperties() const {
  return {};
}

NodeSchema node_mesh_attributes::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  return schema;
}

bool node_mesh_attributes::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> & /*properties*/) {
  try {
    auto meshIt = inputs.find("mesh");
    if (meshIt == inputs.end()) {
      errorMessage =
          "Mesh Attributes node error: input mesh is missing or invalid";
      return false;
    }
    const Mesh *mesh = NodeUtils::getValuePtr<Mesh>(meshIt->second);
    if (!mesh) {
      errorMessage =
          "Mesh Attributes node error: input mesh is missing or invalid";
      return false;
    }

    std::vector<std::vector<double>> vertices;
    vertices.reserve(mesh->vertices.size());
    for (const auto &v : mesh->vertices) {
      vertices.push_back({v[0], v[1], v[2]});
    }

    std::vector<std::vector<double>> indices;
    indices.reserve(mesh->triangles.size());
    for (const auto &tri : mesh->triangles) {
      indices.push_back({static_cast<double>(tri[0]),
                         static_cast<double>(tri[1]),
                         static_cast<double>(tri[2])});
    }

    std::vector<std::vector<double>> colors;
    colors.reserve(mesh->vertices.size());
    if (mesh->colors.size() == mesh->vertices.size()) {
      for (const auto &c : mesh->colors) {
        colors.push_back({c[0], c[1], c[2]});
      }
    } else {
      for (size_t i = 0; i < mesh->vertices.size(); ++i) {
        colors.push_back({0.85, 0.85, 0.85});
      }
    }

    std::vector<std::vector<double>> uv;
    uv.reserve(mesh->vertices.size());
    if (mesh->texcoords.size() == mesh->vertices.size()) {
      for (const auto &t : mesh->texcoords) {
        uv.push_back({t[0], t[1]});
      }
    } else if (!mesh->triangleTexcoords.empty() &&
               mesh->triangleTexcoords.size() == mesh->triangles.size() &&
               !mesh->texcoords.empty()) {
      // Remap face-varying UVs to per-vertex UV output (Nx2).
      uv.assign(mesh->vertices.size(), {0.0, 0.0});
      std::vector<char> assigned(mesh->vertices.size(), 0);
      for (size_t fi = 0; fi < mesh->triangles.size(); ++fi) {
        const auto &tri = mesh->triangles[fi];
        const auto &tuv = mesh->triangleTexcoords[fi];
        for (int k = 0; k < 3; ++k) {
          const int vi = tri[k];
          const int ti = tuv[k];
          if (vi < 0 || vi >= static_cast<int>(mesh->vertices.size())) {
            continue;
          }
          if (ti < 0 || ti >= static_cast<int>(mesh->texcoords.size())) {
            continue;
          }
          if (!assigned[vi]) {
            uv[vi] = {mesh->texcoords[ti][0], mesh->texcoords[ti][1]};
            assigned[vi] = 1;
          }
        }
      }
    } else {
      for (size_t i = 0; i < mesh->vertices.size(); ++i) {
        uv.push_back({0.0, 0.0});
      }
    }

    TextureData texture;
    texture.path = mesh->texturePath.empty() ? "builtin://checkerboard"
                                             : mesh->texturePath;
    texture.useBuiltinChecker = (texture.path == "builtin://checkerboard");
    texture.materialMatrix = {{1.0, 0.0, 0.0, 0.0},
                              {0.0, 1.0, 0.0, 0.0},
                              {0.0, 0.0, 1.0, 0.0},
                              {0.0, 0.0, 0.0, 1.0}};

    outputs["vertices"] = vertices;
    outputs["indices"] = indices;
    outputs["colors"] = colors;
    outputs["uv"] = uv;
    outputs["texture"] = texture;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Mesh Attributes node error: ") + e.what();
    return false;
  }
}

namespace {
struct mesh_any_to_json_registrar {
  mesh_any_to_json_registrar() {
    NodeUtils::registerAnyToJson<Mesh>([](const std::any &value, json &out) {
      const auto &mesh = std::any_cast<const Mesh &>(value);
      out = json::object();
      out["vertices"] = json::array();
      out["triangles"] = json::array();
      out["texcoords"] = json::array();
      out["triangleTexcoords"] = json::array();
      out["colors"] = json::array();
      for (const auto &v : mesh.vertices) {
        out["vertices"].push_back({v[0], v[1], v[2]});
      }
      for (const auto &t : mesh.triangles) {
        out["triangles"].push_back({t[0], t[1], t[2]});
      }
      for (const auto &uv : mesh.texcoords) {
        out["texcoords"].push_back({uv[0], uv[1]});
      }
      for (const auto &tuv : mesh.triangleTexcoords) {
        out["triangleTexcoords"].push_back({tuv[0], tuv[1], tuv[2]});
      }
      for (const auto &c : mesh.colors) {
        out["colors"].push_back({c[0], c[1], c[2]});
      }
      out["colorMap"] = mesh.colorMap;
      out["texturePath"] = mesh.texturePath;
      return true;
    });
    NodeUtils::registerAnyToJson<std::shared_ptr<Mesh>>(
        [](const std::any &value, json &out) {
          const auto &meshPtr =
              std::any_cast<const std::shared_ptr<Mesh> &>(value);
          if (!meshPtr) {
            out = json::object();
            out["vertices"] = json::array();
            out["triangles"] = json::array();
            out["texcoords"] = json::array();
            out["triangleTexcoords"] = json::array();
            out["colors"] = json::array();
            out["colorMap"] = "";
            out["texturePath"] = "";
            return true;
          }
          const auto &mesh = *meshPtr;
          out = json::object();
          out["vertices"] = json::array();
          out["triangles"] = json::array();
          out["texcoords"] = json::array();
          out["triangleTexcoords"] = json::array();
          out["colors"] = json::array();
          for (const auto &v : mesh.vertices) {
            out["vertices"].push_back({v[0], v[1], v[2]});
          }
          for (const auto &t : mesh.triangles) {
            out["triangles"].push_back({t[0], t[1], t[2]});
          }
          for (const auto &uv : mesh.texcoords) {
            out["texcoords"].push_back({uv[0], uv[1]});
          }
          for (const auto &tuv : mesh.triangleTexcoords) {
            out["triangleTexcoords"].push_back({tuv[0], tuv[1], tuv[2]});
          }
          for (const auto &c : mesh.colors) {
            out["colors"].push_back({c[0], c[1], c[2]});
          }
          out["colorMap"] = mesh.colorMap;
          out["texturePath"] = mesh.texturePath;
          return true;
        });
  }
};

mesh_any_to_json_registrar mesh_any_to_json_registrar_instance;
NodeRegistrar<node_mesh> node_mesh_registrar;
NodeRegistrar<node_loadmesh> node_loadmesh_registrar;
NodeRegistrar<node_writemesh> node_writemesh_registrar;
NodeRegistrar<node_mesh_attributes> node_mesh_attributes_registrar;
} // namespace
