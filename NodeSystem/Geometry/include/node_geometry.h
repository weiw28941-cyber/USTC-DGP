#pragma once

#include "node_base.h"
#include "node_lines.h"
#include "node_mesh.h"
#include "node_points.h"
#include <array>
#include <cstdint>
#include <string>
#include <vector>

struct GeometryData {
  struct Object {
    std::string type;
    std::vector<float> positions;
    std::vector<float> colors;
    std::vector<float> texcoords;
    std::vector<int> triTexcoordIndices;
    std::vector<int> triIndices;
    std::vector<int> lineIndices;
    std::vector<int> pointIndices;
    std::vector<int> vectorLineFlags;
    std::string texturePath;
    std::string colorMap;
  };
  std::vector<Object> objects;
  std::vector<float> positions;
  std::vector<float> colors;
  std::vector<float> texcoords;
  std::vector<int> triTexcoordIndices;
  std::vector<int> triIndices;
  std::vector<int> lineIndices;
  std::vector<int> pointIndices;
  std::vector<int> vectorLineFlags;
  std::string texturePath;
};

struct GeometryViewPayload {
  std::string viewerType;
  std::string meshId;
  std::uint64_t version;
  std::string dataFormat;
  std::vector<GeometryData::Object> objects;
  std::vector<float> positions;
  std::vector<float> colors;
  std::vector<float> texcoords;
  std::vector<int> triTexcoordIndices;
  std::vector<int> triIndices;
  std::vector<int> lineIndices;
  std::vector<int> pointIndices;
  std::vector<int> vectorLineFlags;
  std::string texturePath;
  std::array<double, 3> lightDirection;
  double lightIntensity;
  std::array<double, 3> boundsMin;
  std::array<double, 3> boundsMax;
};

class node_geometry : public NodeBase {
public:
  std::string getType() const override;
  std::string getName() const override;
  std::string getCategory() const override;
  std::string getDescription() const override;
  std::vector<Socket> getInputs() const override;
  std::vector<Socket> getOutputs() const override;
  std::map<std::string, std::any> getProperties() const override;
  NodeSchema getSchema() const override;
  bool execute(const std::map<std::string, std::any> &inputs,
               std::map<std::string, std::any> &outputs,
               const std::map<std::string, std::any> &properties) override;
};

class node_geometry_viewer : public NodeBase {
public:
  std::string getType() const override;
  std::string getName() const override;
  std::string getCategory() const override;
  std::string getDescription() const override;
  std::vector<Socket> getInputs() const override;
  std::vector<Socket> getOutputs() const override;
  std::map<std::string, std::any> getProperties() const override;
  NodeSchema getSchema() const override;
  bool execute(const std::map<std::string, std::any> &inputs,
               std::map<std::string, std::any> &outputs,
               const std::map<std::string, std::any> &properties) override;
};
