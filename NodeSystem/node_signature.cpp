#include "node_signature.h"

#include "node_geometry.h"
#include "node_lines.h"
#include "node_mesh.h"
#include "node_points.h"

#include <array>
#include <cstdint>
#include <memory>
#include <type_traits>
#include <vector>

namespace {

std::size_t hashCombine(std::size_t seed, std::size_t value) {
  return seed ^ (value + 0x9e3779b97f4a7c15ULL + (seed << 6) + (seed >> 2));
}

std::size_t hashString(const std::string &s) {
  return std::hash<std::string>{}(s);
}

template <typename T> std::size_t hashPod(const T &v) {
  static_assert(std::is_trivially_copyable<T>::value,
                "hashPod requires trivially copyable type");
  std::size_t h = 1469598103934665603ull;
  const auto *bytes = reinterpret_cast<const unsigned char *>(&v);
  for (size_t i = 0; i < sizeof(T); ++i) {
    h ^= static_cast<std::size_t>(bytes[i]);
    h *= 1099511628211ull;
  }
  return h;
}

template <typename T> std::size_t hashVectorPod(const std::vector<T> &vec) {
  std::size_t h = hashPod(static_cast<std::uint64_t>(vec.size()));
  for (const auto &v : vec) {
    h = hashCombine(h, hashPod(v));
  }
  return h;
}

std::size_t hashStringVector(const std::vector<std::string> &vec) {
  std::size_t h = hashPod(static_cast<std::uint64_t>(vec.size()));
  for (const auto &s : vec) {
    h = hashCombine(h, hashString(s));
  }
  return h;
}

template <typename T, std::size_t N>
std::size_t hashArrayPod(const std::array<T, N> &arr) {
  std::size_t h = hashPod(static_cast<std::uint64_t>(N));
  for (const auto &v : arr) {
    h = hashCombine(h, hashPod(v));
  }
  return h;
}

template <typename T, std::size_t N>
std::size_t hashVectorArrayPod(const std::vector<std::array<T, N>> &vec) {
  std::size_t h = hashPod(static_cast<std::uint64_t>(vec.size()));
  for (const auto &item : vec) {
    h = hashCombine(h, hashArrayPod(item));
  }
  return h;
}

std::size_t hashMatrixDouble(const std::vector<std::vector<double>> &mat) {
  std::size_t h = hashPod(static_cast<std::uint64_t>(mat.size()));
  for (const auto &row : mat) {
    h = hashCombine(h, hashVectorPod(row));
  }
  return h;
}

std::size_t hashMesh(const Mesh &mesh) {
  std::size_t h = hashVectorArrayPod(mesh.vertices);
  h = hashCombine(h, hashVectorArrayPod(mesh.triangles));
  h = hashCombine(h, hashVectorArrayPod(mesh.texcoords));
  h = hashCombine(h, hashVectorArrayPod(mesh.triangleTexcoords));
  h = hashCombine(h, hashVectorArrayPod(mesh.colors));
  h = hashCombine(h, hashString(mesh.colorMap));
  h = hashCombine(h, hashString(mesh.texturePath));
  return h;
}

std::size_t hashPointCloud(const PointCloud &pc) {
  return hashVectorArrayPod(pc.points);
}

std::size_t hashLineSet(const LineSet &lines) {
  std::size_t h = hashVectorArrayPod(lines.points);
  h = hashCombine(h, hashVectorArrayPod(lines.segments));
  h = hashCombine(h, hashPod(static_cast<unsigned char>(lines.directed ? 1 : 0)));
  return h;
}

std::size_t hashGeometryObject(const GeometryData::Object &obj) {
  std::size_t h = hashString(obj.type);
  h = hashCombine(h, hashVectorPod(obj.positions));
  h = hashCombine(h, hashVectorPod(obj.colors));
  h = hashCombine(h, hashVectorPod(obj.texcoords));
  h = hashCombine(h, hashVectorPod(obj.triTexcoordIndices));
  h = hashCombine(h, hashVectorPod(obj.triIndices));
  h = hashCombine(h, hashVectorPod(obj.lineIndices));
  h = hashCombine(h, hashVectorPod(obj.pointIndices));
  h = hashCombine(h, hashVectorPod(obj.vectorLineFlags));
  h = hashCombine(h, hashString(obj.texturePath));
  h = hashCombine(h, hashString(obj.colorMap));
  return h;
}

std::size_t hashGeometryData(const GeometryData &geom) {
  std::size_t h = hashPod(static_cast<std::uint64_t>(geom.objects.size()));
  for (const auto &obj : geom.objects) {
    h = hashCombine(h, hashGeometryObject(obj));
  }
  h = hashCombine(h, hashVectorPod(geom.positions));
  h = hashCombine(h, hashVectorPod(geom.colors));
  h = hashCombine(h, hashVectorPod(geom.texcoords));
  h = hashCombine(h, hashVectorPod(geom.triTexcoordIndices));
  h = hashCombine(h, hashVectorPod(geom.triIndices));
  h = hashCombine(h, hashVectorPod(geom.lineIndices));
  h = hashCombine(h, hashVectorPod(geom.pointIndices));
  h = hashCombine(h, hashVectorPod(geom.vectorLineFlags));
  h = hashCombine(h, hashString(geom.texturePath));
  return h;
}

std::size_t hashGeometryViewPayload(const GeometryViewPayload &payload) {
  std::size_t h = hashString(payload.viewerType);
  h = hashCombine(h, hashString(payload.meshId));
  h = hashCombine(h, hashPod(payload.version));
  h = hashCombine(h, hashString(payload.dataFormat));
  h = hashCombine(h, hashPod(static_cast<std::uint64_t>(payload.objects.size())));
  for (const auto &obj : payload.objects) {
    h = hashCombine(h, hashGeometryObject(obj));
  }
  h = hashCombine(h, hashVectorPod(payload.positions));
  h = hashCombine(h, hashVectorPod(payload.colors));
  h = hashCombine(h, hashVectorPod(payload.texcoords));
  h = hashCombine(h, hashVectorPod(payload.triTexcoordIndices));
  h = hashCombine(h, hashVectorPod(payload.triIndices));
  h = hashCombine(h, hashVectorPod(payload.lineIndices));
  h = hashCombine(h, hashVectorPod(payload.pointIndices));
  h = hashCombine(h, hashVectorPod(payload.vectorLineFlags));
  h = hashCombine(h, hashString(payload.texturePath));
  h = hashCombine(h, hashArrayPod(payload.lightDirection));
  h = hashCombine(h, hashPod(payload.lightIntensity));
  h = hashCombine(h, hashArrayPod(payload.boundsMin));
  h = hashCombine(h, hashArrayPod(payload.boundsMax));
  return h;
}

std::size_t hashAnyValue(const std::any &value) {
  if (value.type() == typeid(int)) {
    return hashPod(std::any_cast<int>(value));
  }
  if (value.type() == typeid(bool)) {
    return hashPod(
        static_cast<unsigned char>(std::any_cast<bool>(value) ? 1 : 0));
  }
  if (value.type() == typeid(double)) {
    return hashPod(std::any_cast<double>(value));
  }
  if (value.type() == typeid(float)) {
    return hashPod(std::any_cast<float>(value));
  }
  if (value.type() == typeid(std::string)) {
    return hashString(std::any_cast<std::string>(value));
  }
  if (value.type() == typeid(std::vector<int>)) {
    return hashVectorPod(std::any_cast<const std::vector<int> &>(value));
  }
  if (value.type() == typeid(std::vector<double>)) {
    return hashVectorPod(std::any_cast<const std::vector<double> &>(value));
  }
  if (value.type() == typeid(std::vector<float>)) {
    return hashVectorPod(std::any_cast<const std::vector<float> &>(value));
  }
  if (value.type() == typeid(std::vector<std::string>)) {
    return hashStringVector(
        std::any_cast<const std::vector<std::string> &>(value));
  }
  if (value.type() == typeid(std::vector<std::vector<double>>)) {
    return hashMatrixDouble(
        std::any_cast<const std::vector<std::vector<double>> &>(value));
  }
  if (value.type() == typeid(json)) {
    return hashString(std::any_cast<const json &>(value).dump());
  }

  if (value.type() == typeid(std::shared_ptr<Mesh>)) {
    const auto &ptr = std::any_cast<const std::shared_ptr<Mesh> &>(value);
    return ptr ? hashMesh(*ptr) : hashString("mesh:null");
  }
  if (value.type() == typeid(std::shared_ptr<PointCloud>)) {
    const auto &ptr = std::any_cast<const std::shared_ptr<PointCloud> &>(value);
    return ptr ? hashPointCloud(*ptr) : hashString("pointcloud:null");
  }
  if (value.type() == typeid(std::shared_ptr<LineSet>)) {
    const auto &ptr = std::any_cast<const std::shared_ptr<LineSet> &>(value);
    return ptr ? hashLineSet(*ptr) : hashString("lineset:null");
  }
  if (value.type() == typeid(std::shared_ptr<GeometryData>)) {
    const auto &ptr =
        std::any_cast<const std::shared_ptr<GeometryData> &>(value);
    return ptr ? hashGeometryData(*ptr) : hashString("geometrydata:null");
  }
  if (value.type() == typeid(std::shared_ptr<GeometryViewPayload>)) {
    const auto &ptr =
        std::any_cast<const std::shared_ptr<GeometryViewPayload> &>(value);
    return ptr ? hashGeometryViewPayload(*ptr)
               : hashString("geometryviewpayload:null");
  }

  json encoded;
  if (NodeUtils::anyToJson(value, encoded)) {
    return hashString(encoded.dump());
  }

  return hashString(std::string("type:") + value.type().name());
}

} // namespace

std::size_t
buildNodeSignature(const NodeBase &node,
                   const std::map<std::string, std::any> &inputs,
                   const std::map<std::string, std::any> &properties) {
  std::size_t sig = hashString(node.getType());
  for (const auto &[k, v] : inputs) {
    sig = hashCombine(sig, hashString(k));
    sig = hashCombine(sig, hashAnyValue(v));
  }
  for (const auto &[k, v] : properties) {
    sig = hashCombine(sig, hashString(k));
    sig = hashCombine(sig, hashAnyValue(v));
  }
  return sig;
}
