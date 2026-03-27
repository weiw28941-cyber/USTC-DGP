#pragma once

#include "node_base.h"
#include "node_points.h"
#include "node_texture.h"
#include <array>
#include <string>
#include <vector>

struct Mesh {
  std::vector<std::array<double, 3>> vertices;
  std::vector<std::array<int, 3>> triangles;
  std::vector<std::array<double, 2>> texcoords;
  std::vector<std::array<int, 3>> triangleTexcoords;
  std::vector<std::array<double, 3>> colors;
  std::string colorMap;
  std::string texturePath;
};

class node_mesh : public NodeBase {
public:
  std::string getType() const override;
  std::string getName() const override;
  std::string getCategory() const override;
  std::string getDescription() const override;
  std::vector<Socket> getInputs() const override;
  std::vector<Socket> getOutputs() const override;
  std::map<std::string, std::any> getProperties() const override;
  std::map<std::string, std::vector<std::string>> getPropertyOptions() const override;
  NodeSchema getSchema() const override;
  bool execute(const std::map<std::string, std::any> & /*inputs*/,
               std::map<std::string, std::any> &outputs,
               const std::map<std::string, std::any> &properties) override;
};

class node_loadmesh : public NodeBase {
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

class node_writemesh : public NodeBase {
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

class node_mesh_attributes : public NodeBase {
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
