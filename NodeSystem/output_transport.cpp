#include "output_transport.h"

namespace OutputTransport {

namespace {

bool inferMatrixLikeShape(const json &value, std::size_t &rows, std::size_t &cols) {
  if (!value.is_array()) {
    return false;
  }
  rows = value.size();
  if (rows == 0) {
    return false;
  }
  cols = 0;
  bool sawRow = false;
  for (const auto &row : value) {
    if (!row.is_array()) {
      return false;
    }
    cols = std::max(cols, row.size());
    sawRow = true;
  }
  return sawRow && cols > 0;
}

} // namespace

json makePagedArrayDescriptor(const std::string &socket_id,
                              std::size_t total_count,
                              std::size_t page_size) {
  return {{"stream",
           {{"mode", "paged"},
            {"socketId", socket_id},
            {"totalCount", total_count},
            {"loadedCount", 0},
            {"pageSize", page_size}}},
          {"paginated", true}};
}

json makePagedArrayDescriptor(const std::string &socket_id, const json &value,
                              std::size_t max_items) {
  const std::size_t total_count = value.is_array() ? value.size() : 0;
  const std::size_t resolved_max_items =
      max_items > 0 ? max_items : kDefaultPagedPreviewItems;
  std::size_t page_size = resolved_max_items;
  std::size_t rows = 0;
  std::size_t cols = 0;
  json descriptor =
      makePagedArrayDescriptor(socket_id, total_count, page_size);
  if (resolved_max_items > 0 && inferMatrixLikeShape(value, rows, cols)) {
    const std::size_t rows_per_page =
        std::max<std::size_t>(1, resolved_max_items / std::max<std::size_t>(1, cols));
    descriptor["stream"]["pageSize"] =
        std::min<std::size_t>(rows, rows_per_page);
    descriptor["stream"]["rows"] = rows;
    descriptor["stream"]["cols"] = cols;
    descriptor["stream"]["pageUnit"] = "rows";
  }
  return descriptor;
}

} // namespace OutputTransport
