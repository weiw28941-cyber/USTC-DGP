#include "node_scalarCurvature.h"
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

namespace {

    using Vec3 = std::array<double, 3>;

    // Vector operations
    Vec3 subtract(const Vec3& a, const Vec3& b) {
        return { a[0] - b[0], a[1] - b[1], a[2] - b[2] };
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

    // Compute angle at vertex p0 in triangle (p0, p1, p2)
    double computeAngle(const Vec3& p0, const Vec3& p1, const Vec3& p2) {
        Vec3 v1 = subtract(p1, p0);
        Vec3 v2 = subtract(p2, p0);
        double dot = dotProduct(v1, v2);
        double mag1 = magnitude(v1);
        double mag2 = magnitude(v2);
        if (mag1 < 1e-12 || mag2 < 1e-12) return 0.0;
        double cosAngle = dot / (mag1 * mag2);
        cosAngle = std::max(-1.0, std::min(1.0, cosAngle));
        return std::acos(cosAngle);
    }

    // Compute cotangent of angle at vertex p0 in triangle (p0, p1, p2)
    double computeCotan(const Vec3& p0, const Vec3& p1, const Vec3& p2) {
        Vec3 v1 = subtract(p1, p0);
        Vec3 v2 = subtract(p2, p0);
        double dot = dotProduct(v1, v2);
        double mag1 = magnitude(v1);
        double mag2 = magnitude(v2);
        if (mag1 < 1e-12 || mag2 < 1e-12) return 0.0;
        double sinAngle = std::sqrt(1.0 - (dot / (mag1 * mag2)) * (dot / (mag1 * mag2)));
        if (sinAngle < 1e-12) return 0.0;
        return dot / (mag1 * mag2) / sinAngle;
    }

    // Compute triangle area
    double computeTriangleArea(const Vec3& p0, const Vec3& p1, const Vec3& p2) {
        Vec3 v1 = subtract(p1, p0);
        Vec3 v2 = subtract(p2, p0);
        Vec3 cross = crossProduct(v1, v2);
        return 0.5 * magnitude(cross);
    }

} // namespace

std::string node_scalarCurvature::getType() const { return "scalar_curvature"; }
std::string node_scalarCurvature::getName() const { return "Scalar Curvature"; }
std::string node_scalarCurvature::getCategory() const { return "Geometry"; }
std::string node_scalarCurvature::getDescription() const {
    return "Compute per-vertex Gaussian or mean curvature from a mesh";
}

std::vector<Socket> node_scalarCurvature::getInputs() const {
    return { {"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"} };
}

std::vector<Socket> node_scalarCurvature::getOutputs() const {
    return { {"curvature", "Curvature", DataType::LIST, std::vector<double>{}} };
}

std::map<std::string, std::any> node_scalarCurvature::getProperties() const {
    std::map<std::string, std::any> props = {
        {"operation", std::string("gaussian")},
    };
    for (const auto& entry : properties_) {
        props[entry.first] = entry.second;
    }
    return props;
}

std::map<std::string, std::vector<std::string>>
node_scalarCurvature::getPropertyOptions() const {
    return { {"operation", {"gaussian", "mean"}} };
}

NodeSchema node_scalarCurvature::getSchema() const {
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

bool node_scalarCurvature::execute(
    const std::map<std::string, std::any>& inputs,
    std::map<std::string, std::any>& outputs,
    const std::map<std::string, std::any>& properties) {
    try {
        const auto meshIt = inputs.find("mesh");
        if (meshIt == inputs.end()) {
            errorMessage =
                "Scalar Curvature node error: input mesh is missing or invalid";
            return false;
        }
        const Mesh* mesh = NodeUtils::getValuePtr<Mesh>(meshIt->second);
        if (!mesh) {
            errorMessage =
                "Scalar Curvature node error: input mesh is missing or invalid";
            return false;
        }
        const size_t vertexCount = mesh->vertices.size();
        if (vertexCount == 0) {
            errorMessage = "Scalar Curvature node error: mesh has no vertices";
            return false;
        }
        if (mesh->triangles.empty()) {
            errorMessage = "Scalar Curvature node error: mesh has no triangles";
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

        // Build vertex-to-triangle adjacency
        std::vector<std::vector<size_t>> vertexTriangles(vertexCount);
        for (size_t i = 0; i < mesh->triangles.size(); ++i) {
            const auto& tri = mesh->triangles[i];
            vertexTriangles[tri[0]].push_back(i);
            vertexTriangles[tri[1]].push_back(i);
            vertexTriangles[tri[2]].push_back(i);
        }

        // Compute Gaussian and Mean curvature using angle deficit / barycentric area
        for (size_t vertexIdx = 0; vertexIdx < vertexCount; ++vertexIdx) {
            double angleSumAtVertex = 0.0;
            double barycentricArea = 0.0;
            double laplacianX = 0.0, laplacianY = 0.0, laplacianZ = 0.0;

            for (size_t triIdx : vertexTriangles[vertexIdx]) {
                const auto& tri = mesh->triangles[triIdx];
                const auto& p0 = mesh->vertices[tri[0]];
                const auto& p1 = mesh->vertices[tri[1]];
                const auto& p2 = mesh->vertices[tri[2]];

                // Compute triangle area and barycentric area
                double triArea = computeTriangleArea(p0, p1, p2);
                barycentricArea += triArea / 3.0;

                // Compute angle at vertex and cotangent weights
                int localIdx = -1;
                double angle = 0.0;

                if (tri[0] == vertexIdx) {
                    localIdx = 0;
                    angle = computeAngle(p0, p1, p2);
                    double cot1 = computeCotan(p1, p0, p2);
                    double cot2 = computeCotan(p2, p0, p1);
                    laplacianX += cot1 * (p2[0] - p0[0]) + cot2 * (p1[0] - p0[0]);
                    laplacianY += cot1 * (p2[1] - p0[1]) + cot2 * (p1[1] - p0[1]);
                    laplacianZ += cot1 * (p2[2] - p0[2]) + cot2 * (p1[2] - p0[2]);
                }
                else if (tri[1] == vertexIdx) {
                    localIdx = 1;
                    angle = computeAngle(p1, p0, p2);
                    double cot0 = computeCotan(p0, p1, p2);
                    double cot2 = computeCotan(p2, p1, p0);
                    laplacianX += cot0 * (p2[0] - p1[0]) + cot2 * (p0[0] - p1[0]);
                    laplacianY += cot0 * (p2[1] - p1[1]) + cot2 * (p0[1] - p1[1]);
                    laplacianZ += cot0 * (p2[2] - p1[2]) + cot2 * (p0[2] - p1[2]);
                }
                else if (tri[2] == vertexIdx) {
                    localIdx = 2;
                    angle = computeAngle(p2, p0, p1);
                    double cot0 = computeCotan(p0, p2, p1);
                    double cot1 = computeCotan(p1, p2, p0);
                    laplacianX += cot0 * (p1[0] - p2[0]) + cot1 * (p0[0] - p2[0]);
                    laplacianY += cot0 * (p1[1] - p2[1]) + cot1 * (p0[1] - p2[1]);
                    laplacianZ += cot0 * (p1[2] - p2[2]) + cot1 * (p0[2] - p2[2]);
                }
                angleSumAtVertex += angle;
            }

            // Gaussian curvature = (2π - angle sum) / barycentric area
            if (barycentricArea > 1e-12) {
                double pi = std::acos(-1.0);
                gaussian[vertexIdx] = (2.0 * pi - angleSumAtVertex) / barycentricArea;
            }

            // Mean curvature = |Laplacian vector| / (2 * barycentric area)
            if (barycentricArea > 1e-12) {
                double laplacianMag = std::sqrt(laplacianX * laplacianX + laplacianY * laplacianY + laplacianZ * laplacianZ);
                mean[vertexIdx] = laplacianMag / (2.0 * barycentricArea);
            }
            else {
                mean[vertexIdx] = 0.0;
            }
        }

        /*** compute curvature ***/

        outputs["curvature"] = (op == "mean") ? mean : gaussian;
        return true;
    }
    catch (const std::exception& e) {
        errorMessage = std::string("Scalar Curvature node error: ") + e.what();
        return false;
    }
}

namespace {
    NodeRegistrar<node_scalarCurvature> node_scalar_curvature_registrar;
} // namespace
