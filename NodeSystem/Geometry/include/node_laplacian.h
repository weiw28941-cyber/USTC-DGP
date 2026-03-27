#pragma once

#include "node_mesh.h"

// Laplacian Deform Node - applies handle constraints to mesh vertices.
// Designed to consume interaction payload/event from interaction_state node.
class node_laplacian_deform : public NodeBase {
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
  bool execute(const std::map<std::string, std::any> &inputs,
               std::map<std::string, std::any> &outputs,
               const std::map<std::string, std::any> &properties) override;
};
