#pragma once

#include "Utils/include/json.hpp"

#include <cstddef>
#include <string>

using json = nlohmann::json;

namespace OutputTransport {

constexpr std::size_t kDefaultPagedPreviewItems = 100;

json makePagedArrayDescriptor(const std::string &socket_id,
                              std::size_t total_count,
                              std::size_t page_size);

json makePagedArrayDescriptor(const std::string &socket_id,
                              const json &value,
                              std::size_t max_items);

}
