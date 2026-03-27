#pragma once

#include <any>
#include <cstddef>
#include <map>
#include <string>

struct GraphConnection {
  int from_node;
  std::string from_socket;
  int to_node;
  std::string to_socket;
  bool success = true;
  std::string errorMessage;
};

struct CachedNodeResult {
  std::size_t signature = 0;
  std::map<std::string, std::any> outputs;
  bool success = true;
  std::string errorMessage;
};
