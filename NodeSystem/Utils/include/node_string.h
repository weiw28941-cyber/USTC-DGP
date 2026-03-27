#pragma once

#include "node_base.h"
#include <string>

class node_string : public NodeBase {
public:
  std::string getType() const override;
  std::string getName() const override;
  std::string getCategory() const override;
  std::string getDescription() const override;
  std::vector<Socket> getInputs() const override;
  std::vector<Socket> getOutputs() const override;
  std::map<std::string, std::any> getProperties() const override;
  NodeSchema getSchema() const override;
  bool execute(const std::map<std::string, std::any> & /*inputs*/,
               std::map<std::string, std::any> &outputs,
               const std::map<std::string, std::any> &properties) override;
};
