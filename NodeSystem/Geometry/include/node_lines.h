#pragma once

#include "node_base.h"
#include "node_points.h"
#include <array>
#include <string>
#include <vector>

struct LineSet {
  std::vector<std::array<double, 3>> points;
  std::vector<std::array<int, 2>> segments;
  bool directed = false;
};

class node_lines : public NodeBase {
public:
  std::string getType() const override;
  std::string getName() const override;
  std::string getCategory() const override;
  std::string getDescription() const override;
  std::vector<Socket> getInputs() const override;
  std::vector<Socket> getOutputs() const override;
  std::map<std::string, std::any> getProperties() const override;
  std::map<std::string, std::vector<std::string>>
  getPropertyOptions() const override;
  NodeSchema getSchema() const override;
  bool execute(const std::map<std::string, std::any> &inputs,
               std::map<std::string, std::any> &outputs,
               const std::map<std::string, std::any> &properties) override;
};

class node_loadlines : public NodeBase {
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

class node_writelines : public NodeBase {
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
