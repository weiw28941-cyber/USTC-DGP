#pragma once

#include "node_base.h"
#include <any>
#include <cstddef>
#include <map>
#include <string>

std::size_t
buildNodeSignature(const NodeBase &node,
                   const std::map<std::string, std::any> &inputs,
                   const std::map<std::string, std::any> &properties);
