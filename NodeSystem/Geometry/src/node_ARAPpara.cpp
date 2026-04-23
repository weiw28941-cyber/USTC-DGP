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
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace {

struct NeighborEdge {
  int neighbor = -1;
  double weight = 0.0;
  std::array<double, 2> rest2d{0.0, 0.0};
};

std::array<double, 3> cross3(const std::array<double, 3> &a,
                             const std::array<double, 3> &b) {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]};
}

double dot3(const std::array<double, 3> &a, const std::array<double, 3> &b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

double norm3(const std::array<double, 3> &v) { return std::sqrt(dot3(v, v)); }

std::array<double, 3> normalize3(const std::array<double, 3> &v) {
  const double n = norm3(v);
  if (n <= 1e-14) {
    return {0.0, 0.0, 1.0};
  }
  return {v[0] / n, v[1] / n, v[2] / n};
}

double cotangent(const std::array<double, 3> &a, const std::array<double, 3> &b,
                 const std::array<double, 3> &c) {
  const std::array<double, 3> u{b[0] - a[0], b[1] - a[1], b[2] - a[2]};
  const std::array<double, 3> v{c[0] - a[0], c[1] - a[1], c[2] - a[2]};
  const std::array<double, 3> cr = cross3(u, v);
  const double area2 = norm3(cr);
  if (area2 <= 1e-14) {
    return 0.0;
  }
  return dot3(u, v) / area2;
}

std::uint64_t edgeKey(int a, int b) {
  const int lo = std::min(a, b);
  const int hi = std::max(a, b);
  return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(lo)) << 32) |
         static_cast<std::uint32_t>(hi);
}

void addWeightedEdge(std::unordered_map<std::uint64_t, double> &weights, int a,
                     int b, double w) {
  if (a == b) {
    return;
  }
  const std::uint64_t k = edgeKey(a, b);
  weights[k] += w;
}

void addBoundaryAdj(std::vector<std::vector<int>> &adj, int a, int b) {
  if (a < 0 || b < 0 || a >= static_cast<int>(adj.size()) ||
      b >= static_cast<int>(adj.size()) || a == b) {
    return;
  }
  adj[a].push_back(b);
  adj[b].push_back(a);
}

std::vector<int> buildLargestBoundaryLoop(const std::vector<std::vector<int>> &adj) {
  const int n = static_cast<int>(adj.size());
  std::vector<char> globallyVisited(n, 0);
  std::vector<int> bestLoop;

  for (int start = 0; start < n; ++start) {
    if (adj[start].empty() || globallyVisited[start]) {
      continue;
    }

    std::vector<int> component;
    std::vector<int> stack{start};
    globallyVisited[start] = 1;
    while (!stack.empty()) {
      const int v = stack.back();
      stack.pop_back();
      component.push_back(v);
      for (int nb : adj[v]) {
        if (!globallyVisited[nb]) {
          globallyVisited[nb] = 1;
          stack.push_back(nb);
        }
      }
    }

    if (component.empty()) {
      continue;
    }

    int s = component.front();
    for (int v : component) {
      if (adj[v].size() == 1) {
        s = v;
        break;
      }
    }

    std::vector<int> path;
    std::unordered_set<int> localVisited;
    localVisited.reserve(component.size() * 2 + 1);
    int prev = -1;
    int cur = s;
    bool closed = false;
    while (true) {
      path.push_back(cur);
      localVisited.insert(cur);
      int next = -1;
      for (int nb : adj[cur]) {
        if (nb == prev) {
          continue;
        }
        next = nb;
        if (localVisited.find(nb) == localVisited.end()) {
          break;
        }
      }

      if (next < 0) {
        break;
      }
      if (next == s) {
        closed = true;
        break;
      }
      if (localVisited.find(next) != localVisited.end()) {
        break;
      }
      prev = cur;
      cur = next;
    }

    if (!closed || path.size() < 3) {
      continue;
    }
    if (path.size() > bestLoop.size()) {
      bestLoop = std::move(path);
    }
  }
  return bestLoop;
}

void normalizeUv(std::vector<std::vector<double>> &uv) {
  if (uv.empty()) {
    return;
  }
  double minU = std::numeric_limits<double>::infinity();
  double maxU = -std::numeric_limits<double>::infinity();
  double minV = std::numeric_limits<double>::infinity();
  double maxV = -std::numeric_limits<double>::infinity();
  for (const auto &p : uv) {
    if (p.size() < 2) {
      continue;
    }
    minU = std::min(minU, p[0]);
    maxU = std::max(maxU, p[0]);
    minV = std::min(minV, p[1]);
    maxV = std::max(maxV, p[1]);
  }
  const double spanU = maxU - minU;
  const double spanV = maxV - minV;
  const double scale = std::max(spanU, spanV);
  if (!(scale > 1e-14)) {
    return;
  }
  for (auto &p : uv) {
    if (p.size() < 2) {
      continue;
    }
    p[0] = (p[0] - minU) / scale;
    p[1] = (p[1] - minV) / scale;
  }
}

void fallbackPlanarProjection(const Mesh &mesh,
                              std::vector<std::vector<double>> &uv) {
  const size_t n = mesh.vertices.size();
  uv.assign(n, std::vector<double>(2, 0.0));
  if (n == 0) {
    return;
  }

  double minX = std::numeric_limits<double>::infinity();
  double maxX = -std::numeric_limits<double>::infinity();
  double minY = std::numeric_limits<double>::infinity();
  double maxY = -std::numeric_limits<double>::infinity();
  double minZ = std::numeric_limits<double>::infinity();
  double maxZ = -std::numeric_limits<double>::infinity();
  for (const auto &v : mesh.vertices) {
    minX = std::min(minX, v[0]);
    maxX = std::max(maxX, v[0]);
    minY = std::min(minY, v[1]);
    maxY = std::max(maxY, v[1]);
    minZ = std::min(minZ, v[2]);
    maxZ = std::max(maxZ, v[2]);
  }
  const double sx = maxX - minX;
  const double sy = maxY - minY;
  const double sz = maxZ - minZ;

  int a0 = 0;
  int a1 = 1;
  if (sx < sy && sx < sz) {
    a0 = 1;
    a1 = 2;
  } else if (sy < sx && sy < sz) {
    a0 = 0;
    a1 = 2;
  }

  for (size_t i = 0; i < n; ++i) {
    uv[i][0] = mesh.vertices[i][a0];
    uv[i][1] = mesh.vertices[i][a1];
  }
  normalizeUv(uv);
}

} // namespace

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

    std::vector<std::vector<double>> uv(vertexCount, std::vector<double>(2, 0.0));

    if (mesh->triangles.empty()) {
      fallbackPlanarProjection(*mesh, uv);
      outputs["uv"] = std::move(uv);
      return true;
    }

    // Build cotangent-weighted topology and boundary edges.
    std::unordered_map<std::uint64_t, double> edgeWeights;
    std::unordered_map<std::uint64_t, int> edgeCounts;
    edgeWeights.reserve(mesh->triangles.size() * 3);
    edgeCounts.reserve(mesh->triangles.size() * 3);

    std::vector<std::array<double, 3>> vertexNormals(
        vertexCount, std::array<double, 3>{0.0, 0.0, 0.0});
    size_t validFaceCount = 0;

    for (const auto &tri : mesh->triangles) {
      const int a = tri[0];
      const int b = tri[1];
      const int c = tri[2];
      if (a < 0 || b < 0 || c < 0 || a >= static_cast<int>(vertexCount) ||
          b >= static_cast<int>(vertexCount) || c >= static_cast<int>(vertexCount) ||
          a == b || b == c || a == c) {
        continue;
      }
      ++validFaceCount;
      const auto &va = mesh->vertices[a];
      const auto &vb = mesh->vertices[b];
      const auto &vc = mesh->vertices[c];

      const std::array<double, 3> e1{vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]};
      const std::array<double, 3> e2{vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]};
      const std::array<double, 3> fn = cross3(e1, e2);
      for (const int v : {a, b, c}) {
        vertexNormals[v][0] += fn[0];
        vertexNormals[v][1] += fn[1];
        vertexNormals[v][2] += fn[2];
      }

      const double cotA = cotangent(va, vb, vc);
      const double cotB = cotangent(vb, vc, va);
      const double cotC = cotangent(vc, va, vb);

      addWeightedEdge(edgeWeights, b, c, 0.5 * cotA);
      addWeightedEdge(edgeWeights, c, a, 0.5 * cotB);
      addWeightedEdge(edgeWeights, a, b, 0.5 * cotC);

      edgeCounts[edgeKey(a, b)] += 1;
      edgeCounts[edgeKey(b, c)] += 1;
      edgeCounts[edgeKey(c, a)] += 1;
    }

    if (validFaceCount == 0 || edgeWeights.empty()) {
      fallbackPlanarProjection(*mesh, uv);
      outputs["uv"] = std::move(uv);
      return true;
    }

    // Build neighborhood and per-vertex tangent basis.
    std::vector<std::array<double, 3>> tangentU(vertexCount);
    std::vector<std::array<double, 3>> tangentV(vertexCount);
    for (size_t i = 0; i < vertexCount; ++i) {
      const std::array<double, 3> n = normalize3(vertexNormals[i]);
      const std::array<double, 3> axis =
          (std::abs(n[2]) < 0.9) ? std::array<double, 3>{0.0, 0.0, 1.0}
                                 : std::array<double, 3>{0.0, 1.0, 0.0};
      tangentU[i] = normalize3(cross3(axis, n));
      tangentV[i] = normalize3(cross3(n, tangentU[i]));
    }

    std::vector<std::unordered_map<int, double>> weightMap(vertexCount);
    std::vector<std::vector<int>> boundaryAdj(vertexCount);

    for (const auto &entry : edgeWeights) {
      const std::uint64_t k = entry.first;
      const int i = static_cast<int>(k >> 32);
      const int j = static_cast<int>(k & 0xffffffffu);
      double w = entry.second;
      if (!std::isfinite(w)) {
        continue;
      }
      w = std::max(1e-6, std::abs(w));
      weightMap[i][j] += w;
      weightMap[j][i] += w;
    }

    for (const auto &entry : edgeCounts) {
      if (entry.second != 1) {
        continue;
      }
      const std::uint64_t k = entry.first;
      const int i = static_cast<int>(k >> 32);
      const int j = static_cast<int>(k & 0xffffffffu);
      addBoundaryAdj(boundaryAdj, i, j);
    }

    std::vector<std::vector<NeighborEdge>> neighbors(vertexCount);
    for (size_t i = 0; i < vertexCount; ++i) {
      neighbors[i].reserve(weightMap[i].size());
      for (const auto &it : weightMap[i]) {
        const int j = it.first;
        const double w = it.second;
        const auto &pi = mesh->vertices[i];
        const auto &pj = mesh->vertices[j];
        const std::array<double, 3> d{pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2]};
        const double x = dot3(d, tangentU[i]);
        const double y = dot3(d, tangentV[i]);
        neighbors[i].push_back({j, w, {x, y}});
      }
    }

    // Initialize boundary on unit circle (largest loop), then relax interior.
    std::vector<int> boundaryLoop = buildLargestBoundaryLoop(boundaryAdj);
    std::vector<char> fixed(vertexCount, 0);
    if (boundaryLoop.size() >= 3) {
      std::vector<double> prefix(boundaryLoop.size() + 1, 0.0);
      for (size_t k = 1; k <= boundaryLoop.size(); ++k) {
        const int a = boundaryLoop[k - 1];
        const int b = boundaryLoop[k % boundaryLoop.size()];
        const auto &pa = mesh->vertices[a];
        const auto &pb = mesh->vertices[b];
        const double dx = pb[0] - pa[0];
        const double dy = pb[1] - pa[1];
        const double dz = pb[2] - pa[2];
        prefix[k] = prefix[k - 1] + std::sqrt(dx * dx + dy * dy + dz * dz);
      }
      const double totalLen = std::max(prefix.back(), 1e-12);
      for (size_t k = 0; k < boundaryLoop.size(); ++k) {
        const int vi = boundaryLoop[k];
        const double t = prefix[k] / totalLen;
        const double angle = 6.28318530717958647692 * t;
        uv[vi][0] = std::cos(angle);
        uv[vi][1] = std::sin(angle);
        fixed[vi] = 1;
      }
    } else {
      fallbackPlanarProjection(*mesh, uv);
      outputs["uv"] = std::move(uv);
      return true;
    }

    std::vector<std::vector<double>> nextUv = uv;
    for (int it = 0; it < 80; ++it) {
      for (size_t i = 0; i < vertexCount; ++i) {
        if (fixed[i] || neighbors[i].empty()) {
          continue;
        }
        double sumW = 0.0;
        double u = 0.0;
        double v = 0.0;
        for (const auto &e : neighbors[i]) {
          sumW += e.weight;
          u += e.weight * uv[e.neighbor][0];
          v += e.weight * uv[e.neighbor][1];
        }
        if (sumW > 1e-14) {
          nextUv[i][0] = u / sumW;
          nextUv[i][1] = v / sumW;
        }
      }
      uv.swap(nextUv);
    }

    // ARAP local-global iterations.
    std::vector<std::array<double, 4>> rotations(
        vertexCount, std::array<double, 4>{1.0, 0.0, 0.0, 1.0});
    for (int outer = 0; outer < 20; ++outer) {
      // Local step: best-fit rotation per vertex.
      for (size_t i = 0; i < vertexCount; ++i) {
        if (neighbors[i].empty()) {
          rotations[i] = {1.0, 0.0, 0.0, 1.0};
          continue;
        }
        double c00 = 0.0;
        double c01 = 0.0;
        double c10 = 0.0;
        double c11 = 0.0;
        for (const auto &e : neighbors[i]) {
          const double du = uv[i][0] - uv[e.neighbor][0];
          const double dv = uv[i][1] - uv[e.neighbor][1];
          const double qx = e.rest2d[0];
          const double qy = e.rest2d[1];
          const double w = e.weight;
          c00 += w * du * qx;
          c01 += w * du * qy;
          c10 += w * dv * qx;
          c11 += w * dv * qy;
        }
        const double x = c00 + c11;
        const double y = c10 - c01;
        const double n = std::sqrt(x * x + y * y);
        if (n <= 1e-14) {
          rotations[i] = {1.0, 0.0, 0.0, 1.0};
        } else {
          const double cs = x / n;
          const double sn = y / n;
          rotations[i] = {cs, -sn, sn, cs};
        }
      }

      // Global step: solve with weighted Laplacian using Jacobi iterations.
      for (int inner = 0; inner < 25; ++inner) {
        for (size_t i = 0; i < vertexCount; ++i) {
          if (fixed[i] || neighbors[i].empty()) {
            continue;
          }
          double sumW = 0.0;
          double rhsU = 0.0;
          double rhsV = 0.0;
          double neiU = 0.0;
          double neiV = 0.0;
          const auto &r = rotations[i];
          for (const auto &e : neighbors[i]) {
            const double w = e.weight;
            sumW += w;
            neiU += w * uv[e.neighbor][0];
            neiV += w * uv[e.neighbor][1];
            const double qx = e.rest2d[0];
            const double qy = e.rest2d[1];
            rhsU += w * (r[0] * qx + r[1] * qy);
            rhsV += w * (r[2] * qx + r[3] * qy);
          }
          if (sumW > 1e-14) {
            nextUv[i][0] = (neiU + rhsU) / sumW;
            nextUv[i][1] = (neiV + rhsV) / sumW;
          }
        }
        uv.swap(nextUv);
      }
    }

    normalizeUv(uv);

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
