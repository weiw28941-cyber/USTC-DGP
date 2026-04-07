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
#include <vector>
#include <numeric>

namespace {
    using Vec3 = std::array<double, 3>;
    using Matrix3 = std::array<std::array<double, 3>, 3>;

    // Vector operations
    Vec3 subtract(const Vec3& a, const Vec3& b) {
        return { a[0] - b[0], a[1] - b[1], a[2] - b[2] };
    }

    Vec3 add(const Vec3& a, const Vec3& b) {
        return { a[0] + b[0], a[1] + b[1], a[2] + b[2] };
    }

    Vec3 scale(const Vec3& v, double s) {
        return { v[0] * s, v[1] * s, v[2] * s };
    }

    double dotProduct(const Vec3& a, const Vec3& b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    Vec3 crossProduct(const Vec3& a, const Vec3& b) {
        return { a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0] };
    }

    double magnitude(const Vec3& v) {
        return std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    }

    Vec3 normalize(const Vec3& v) {
        double mag = magnitude(v);
        if (mag < 1e-12) return { 0.0, 0.0, 0.0 };
        return { v[0] / mag, v[1] / mag, v[2] / mag };
    }

    // Find K nearest neighbors
    std::vector<size_t> findKNearestNeighbors(
        const std::vector<Vec3>& points,
        size_t pointIdx,
        size_t k) {

        std::vector<std::pair<double, size_t>> distances;
        const Vec3& p = points[pointIdx];

        for (size_t i = 0; i < points.size(); ++i) {
            if (i != pointIdx) {
                Vec3 diff = subtract(points[i], p);
                double dist = dotProduct(diff, diff);
                distances.push_back({ dist, i });
            }
        }

        // Sort by distance and take k nearest
        k = std::min(k, distances.size());
        std::partial_sort(distances.begin(), distances.begin() + k, distances.end());

        std::vector<size_t> neighbors;
        for (size_t i = 0; i < k; ++i) {
            neighbors.push_back(distances[i].second);
        }
        return neighbors;
    }

    // Compute covariance matrix from points
    Matrix3 computeCovarianceMatrix(
        const std::vector<Vec3>& points,
        const std::vector<size_t>& indices) {

        // Compute centroid
        Vec3 centroid = { 0.0, 0.0, 0.0 };
        for (size_t idx : indices) {
            centroid = add(centroid, points[idx]);
        }
        centroid = scale(centroid, 1.0 / indices.size());

        // Compute covariance matrix
        Matrix3 cov = {};
        for (auto& row : cov) {
            for (auto& val : row) {
                val = 0.0;
            }
        }

        for (size_t idx : indices) {
            Vec3 p = subtract(points[idx], centroid);
            for (size_t i = 0; i < 3; ++i) {
                for (size_t j = 0; j < 3; ++j) {
                    cov[i][j] += p[i] * p[j];
                }
            }
        }

        double n = static_cast<double>(indices.size());
        for (size_t i = 0; i < 3; ++i) {
            for (size_t j = 0; j < 3; ++j) {
                cov[i][j] /= n;
            }
        }

        return cov;
    }

    // Power iteration to find principal component (eigenvector for largest eigenvalue)
    Vec3 findPrincipalComponent(const Matrix3& cov) {
        Vec3 v = { 1.0, 0.0, 0.0 };

        for (int iter = 0; iter < 10; ++iter) {
            Vec3 Av = {
                cov[0][0] * v[0] + cov[0][1] * v[1] + cov[0][2] * v[2],
                cov[1][0] * v[0] + cov[1][1] * v[1] + cov[1][2] * v[2],
                cov[2][0] * v[0] + cov[2][1] * v[1] + cov[2][2] * v[2]
            };
            v = normalize(Av);
        }

        return v;
    }

    // Find all three eigenvectors (principal directions)
    struct EigenDecomposition {
        Vec3 eigenvectors[3];  // e0 (largest), e1, e2 (smallest)
        double eigenvalues[3]; // λ0 ≥ λ1 ≥ λ2
    };

    EigenDecomposition computeEigenDecomposition(const Matrix3& cov) {
        EigenDecomposition result;

        // Find largest eigenvector
        result.eigenvectors[0] = findPrincipalComponent(cov);

        // Compute corresponding eigenvalue
        result.eigenvalues[0] = dotProduct(
            result.eigenvectors[0],
            {
                cov[0][0] * result.eigenvectors[0][0] + cov[0][1] * result.eigenvectors[0][1] + cov[0][2] * result.eigenvectors[0][2],
                cov[1][0] * result.eigenvectors[0][0] + cov[1][1] * result.eigenvectors[0][1] + cov[1][2] * result.eigenvectors[0][2],
                cov[2][0] * result.eigenvectors[0][0] + cov[2][1] * result.eigenvectors[0][1] + cov[2][2] * result.eigenvectors[0][2]
            }
        );

        // Find two orthogonal vectors perpendicular to e0
        Vec3 v1 = { 0.0, 0.0, 0.0 };
        if (std::abs(result.eigenvectors[0][0]) < 0.9) {
            v1 = { 1.0, 0.0, 0.0 };
        } else {
            v1 = { 0.0, 1.0, 0.0 };
        }

        // Gram-Schmidt orthogonalization
        double dot_e0_v1 = dotProduct(result.eigenvectors[0], v1);
        v1 = subtract(v1, scale(result.eigenvectors[0], dot_e0_v1));
        v1 = normalize(v1);

        result.eigenvectors[1] = v1;

        // Third eigenvector is cross product
        result.eigenvectors[2] = crossProduct(result.eigenvectors[0], result.eigenvectors[1]);
        result.eigenvectors[2] = normalize(result.eigenvectors[2]);

        // Compute other eigenvalues
        result.eigenvalues[1] = dotProduct(
            result.eigenvectors[1],
            {
                cov[0][0] * result.eigenvectors[1][0] + cov[0][1] * result.eigenvectors[1][1] + cov[0][2] * result.eigenvectors[1][2],
                cov[1][0] * result.eigenvectors[1][0] + cov[1][1] * result.eigenvectors[1][1] + cov[1][2] * result.eigenvectors[1][2],
                cov[2][0] * result.eigenvectors[1][0] + cov[2][1] * result.eigenvectors[1][1] + cov[2][2] * result.eigenvectors[1][2]
            }
        );

        result.eigenvalues[2] = dotProduct(
            result.eigenvectors[2],
            {
                cov[0][0] * result.eigenvectors[2][0] + cov[0][1] * result.eigenvectors[2][1] + cov[0][2] * result.eigenvectors[2][2],
                cov[1][0] * result.eigenvectors[2][0] + cov[1][1] * result.eigenvectors[2][1] + cov[1][2] * result.eigenvectors[2][2],
                cov[2][0] * result.eigenvectors[2][0] + cov[2][1] * result.eigenvectors[2][1] + cov[2][2] * result.eigenvectors[2][2]
            }
        );

        // Sort by eigenvalue magnitude
        std::array<std::pair<double, int>, 3> sorted_eigs = {{
            { std::abs(result.eigenvalues[0]), 0 },
            { std::abs(result.eigenvalues[1]), 1 },
            { std::abs(result.eigenvalues[2]), 2 }
        }};
        std::sort(sorted_eigs.begin(), sorted_eigs.end(), 
                  [](const auto& a, const auto& b) { return a.first > b.first; });

        Vec3 sorted_vecs[3];
        double sorted_vals[3];
        for (size_t i = 0; i < 3; ++i) {
            int idx = sorted_eigs[i].second;
            sorted_vecs[i] = result.eigenvectors[idx];
            sorted_vals[i] = result.eigenvalues[idx];
        }

        for (size_t i = 0; i < 3; ++i) {
            result.eigenvectors[i] = sorted_vecs[i];
            result.eigenvalues[i] = sorted_vals[i];
        }

        return result;
    }

    // Jet Fitting: Fit local polynomial surface and extract curvature
    // Based on "Estimating Differential Quantities using Polynomial fitting of Osculating Jets"
    struct CurvatureResult {
        double gaussianCurvature;
        double meanCurvature;
    };

    CurvatureResult fitJetAndComputeCurvature(
        const std::vector<Vec3>& points,
        const std::vector<size_t>& neighbors,
        size_t centerIdx,
        const EigenDecomposition& eigen) {

        CurvatureResult result = { 0.0, 0.0 };

        if (neighbors.size() < 4) return result;

        const Vec3& center = points[centerIdx];

        // Build local coordinate system: normal = e0, x-axis = e1, y-axis = e2
        Vec3 normal = eigen.eigenvectors[0];
        Vec3 xaxis = eigen.eigenvectors[1];
        Vec3 yaxis = eigen.eigenvectors[2];

        // Project neighbor points onto local (x, y) plane
        // and compute their z-values
        std::vector<double> x_coords, y_coords, z_coords;

        for (size_t idx : neighbors) {
            Vec3 p = subtract(points[idx], center);

            // Project onto x-axis, y-axis, and normal (z-axis)
            double x = dotProduct(p, xaxis);
            double y = dotProduct(p, yaxis);
            double z = dotProduct(p, normal);

            x_coords.push_back(x);
            y_coords.push_back(y);
            z_coords.push_back(z);
        }

        size_t n = x_coords.size();

        // Fit quadratic surface: z = a20*x^2 + a11*x*y + a02*y^2 + a10*x + a01*y + a00
        // Using least squares fitting
        // Build the design matrix (n x 6)
        // Each row: [x^2, xy, y^2, x, y, 1]

        double sum_x2 = 0, sum_xy = 0, sum_y2 = 0, sum_x = 0, sum_y = 0, sum_1 = 0;
        double sum_x4 = 0, sum_x3y = 0, sum_x2y2 = 0, sum_xy3 = 0, sum_y4 = 0;
        double sum_x3 = 0, sum_x2y = 0, sum_xy2 = 0, sum_y3 = 0;
        double sum_zx2 = 0, sum_zxy = 0, sum_zy2 = 0, sum_zx = 0, sum_zy = 0, sum_z = 0;

        for (size_t i = 0; i < n; ++i) {
            double x = x_coords[i];
            double y = y_coords[i];
            double z = z_coords[i];

            double x2 = x * x, y2 = y * y;
            double x3 = x2 * x, y3 = y2 * y;
            double x4 = x3 * x, y4 = y3 * y;

            sum_x2 += x2;
            sum_xy += x * y;
            sum_y2 += y2;
            sum_x += x;
            sum_y += y;
            sum_1 += 1.0;

            sum_x4 += x4;
            sum_x3y += x3 * y;
            sum_x2y2 += x2 * y2;
            sum_xy3 += x * y3;
            sum_y4 += y4;
            sum_x3 += x3;
            sum_x2y += x2 * y;
            sum_xy2 += x * y2;
            sum_y3 += y3;

            sum_zx2 += z * x2;
            sum_zxy += z * x * y;
            sum_zy2 += z * y2;
            sum_zx += z * x;
            sum_zy += z * y;
            sum_z += z;
        }

        // Use simplified approach: focus on quadratic terms (a20, a11, a02)
        // since they directly give curvature
        // Solve 2x2 subsystem for the quadratic coefficients using Cramer's rule

        double det = sum_x4 * sum_y4 - sum_x2y2 * sum_x2y2;
        if (std::abs(det) < 1e-12) return result;

        // Solve for quadratic coefficients using Cramer's rule (simplified)
        double a20 = (sum_zx2 * sum_y4 - sum_zy2 * sum_x2y2) / det;
        double a02 = (sum_x4 * sum_zy2 - sum_x2y2 * sum_zx2) / det;
        double a11 = 0.0;

        // For a11, we need a different approach
        // Using least squares on a simpler form
        if (std::abs(sum_x2y2) > 1e-12) {
            a11 = (sum_zxy - a20 * sum_x3y - a02 * sum_xy3) / sum_x2y2;
        }

        // Extract curvature from polynomial coefficients
        // Gaussian curvature K = det(H) = a20 * a02 - (a11/2)^2
        // Mean curvature H = (a20 + a02) / 2

        result.gaussianCurvature = a20 * a02 - (a11 * a11) / 4.0;
        result.meanCurvature = (a20 + a02) / 2.0;

        return result;
    }

} // namespace

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

    // K-nearest neighbors for local surface approximation
    const size_t k = std::min(static_cast<size_t>(20), vertexCount - 1);

    for (size_t i = 0; i < vertexCount; ++i) {
      // Find K nearest neighbors
      std::vector<size_t> neighbors = findKNearestNeighbors(points->vertices, i, k);

      if (neighbors.size() < 3) {
        gaussian[i] = 0.0;
        mean[i] = 0.0;
        continue;
      }

      // Compute covariance matrix
      auto cov = computeCovarianceMatrix(points->vertices, neighbors);

      // Compute full eigen decomposition (need all three eigenvectors for local coordinate system)
      auto eigen = computeEigenDecomposition(cov);

      // Apply Jet Fitting: fit local polynomial surface
      auto curvature = fitJetAndComputeCurvature(points->vertices, neighbors, i, eigen);

      gaussian[i] = curvature.gaussianCurvature;
      mean[i] = curvature.meanCurvature;
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