#include "node_laplacian.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <unordered_map>
#include <unordered_set>

namespace {

json anyToJsonObject(const std::any &value) {
  json out = json::object();
  if (NodeUtils::anyToJson(value, out) && out.is_object()) {
    return out;
  }
  return json::object();
}

bool parseHandleRow(const json &row, int &vid, std::array<double, 3> &pos) {
  if (!row.is_object()) {
    return false;
  }
  if (!row.contains("id") || !row["id"].is_number_integer()) {
    return false;
  }
  if (!row.contains("position") || !row["position"].is_array() ||
      row["position"].size() != 3) {
    return false;
  }
  const auto &p = row["position"];
  if (!p[0].is_number() || !p[1].is_number() || !p[2].is_number()) {
    return false;
  }
  vid = row["id"].get<int>();
  pos = {p[0].get<double>(), p[1].get<double>(), p[2].get<double>()};
  return true;
}

std::unordered_map<int, std::array<double, 3>>
collectHandleTargets(const std::map<std::string, std::any> &inputs,
                     const std::map<std::string, std::any> &properties,
                     std::string &err) {
  std::unordered_map<int, std::array<double, 3>> handles;

  auto appendFromEventLike = [&](const json &obj) {
    if (!obj.is_object()) {
      return;
    }
    auto appendArray = [&](const json &arr) {
      if (!arr.is_array()) {
        return;
      }
      for (const auto &row : arr) {
        int vid = -1;
        std::array<double, 3> pos{0.0, 0.0, 0.0};
        if (parseHandleRow(row, vid, pos)) {
          handles[vid] = pos;
        }
      }
    };

    // Direct payload style: {handles:[{id,position},...]}
    if (obj.contains("handles")) {
      appendArray(obj["handles"]);
    }
    // Editor bridge style: {value:{handles:[...]}}
    if (obj.contains("value") && obj["value"].is_object() &&
        obj["value"].contains("handles")) {
      appendArray(obj["value"]["handles"]);
    }
    // Alternative style: {updates:[{id,position},...]}
    if (obj.contains("updates")) {
      appendArray(obj["updates"]);
    }
  };

  auto itPayload = inputs.find("payload");
  if (itPayload != inputs.end()) {
    appendFromEventLike(anyToJsonObject(itPayload->second));
  }

  auto itEvent = inputs.find("event");
  if (itEvent != inputs.end()) {
    const json eventObj = anyToJsonObject(itEvent->second);
    appendFromEventLike(eventObj);
    if (eventObj.contains("payload")) {
      appendFromEventLike(eventObj["payload"]);
    }
  }

  // Optional property fallback for offline tests.
  auto itProp = properties.find("interaction_event");
  if (itProp != properties.end()) {
    const json eventObj = anyToJsonObject(itProp->second);
    appendFromEventLike(eventObj);
    if (eventObj.contains("payload")) {
      appendFromEventLike(eventObj["payload"]);
    }
  }

  (void)err;
  return handles;
}

} // namespace

std::string node_laplacian_deform::getType() const {
  return "laplacian_deform";
}
std::string node_laplacian_deform::getName() const {
  return "Laplacian Deform";
}
std::string node_laplacian_deform::getCategory() const { return "Method"; }
std::string node_laplacian_deform::getDescription() const {
  return "Apply sparse handle constraints to mesh vertices using iterative "
         "laplacian smoothing.";
}

std::vector<Socket> node_laplacian_deform::getInputs() const {
  return {
      {"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"},
      {"event", "Event", DataType::MAP, json::object()},
      {"payload", "Payload", DataType::MAP, json::object()},
  };
}

std::vector<Socket> node_laplacian_deform::getOutputs() const {
  return {
      {"mesh", "Mesh", DataType::CUSTOM, Mesh{}, "mesh"},
      {"moved", "Moved", DataType::NUMBER, 0.0},
      {"handles", "Handles", DataType::NUMBER, 0.0},
  };
}

std::map<std::string, std::any> node_laplacian_deform::getProperties() const {
  std::map<std::string, std::any> props = {
      {"iterations", 20.0},
      {"strength", 0.35},
      {"phase_filter", std::string("update_or_commit")},
      {"interaction_event", json::object()},
  };
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

std::map<std::string, std::vector<std::string>>
node_laplacian_deform::getPropertyOptions() const {
  return {{"phase_filter", {"all", "update", "commit", "update_or_commit"}}};
}

NodeSchema node_laplacian_deform::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#805ad5";
  auto iterationsIt = schema.properties.find("iterations");
  if (iterationsIt != schema.properties.end()) {
    iterationsIt->second.type = "number";
    iterationsIt->second.editor = "number";
    iterationsIt->second.description =
        "Number of smoothing passes applied after handle constraints.";
  }
  auto strengthIt = schema.properties.find("strength");
  if (strengthIt != schema.properties.end()) {
    strengthIt->second.type = "number";
    strengthIt->second.editor = "number";
    strengthIt->second.description =
        "Blend factor between current vertex positions and laplacian average.";
  }
  auto phaseIt = schema.properties.find("phase_filter");
  if (phaseIt != schema.properties.end()) {
    phaseIt->second.editor = "select";
    phaseIt->second.description =
        "Which interaction event phases are allowed to trigger deformation.";
  }
  auto interactionIt = schema.properties.find("interaction_event");
  if (interactionIt != schema.properties.end()) {
    interactionIt->second.editor = "readonly";
    interactionIt->second.editable = false;
    interactionIt->second.description =
        "Latest cached interaction event used as offline fallback.";
  }
  return schema;
}

bool node_laplacian_deform::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    auto meshPtr = NodeUtils::getValuePtr<Mesh>(inputs.at("mesh"));
    if (!meshPtr) {
      errorMessage = "Laplacian deform node error: input mesh is missing";
      return false;
    }
    Mesh outMesh = *meshPtr;
    if (outMesh.vertices.empty()) {
      outputs["mesh"] = std::make_shared<Mesh>(std::move(outMesh));
      outputs["moved"] = 0.0;
      outputs["handles"] = 0.0;
      return true;
    }

    const int iterations =
        std::max(0, static_cast<int>(std::round(NodeUtils::getValue<double>(
                        properties.at("iterations"), 20.0))));
    const double strength = std::clamp(
        NodeUtils::getValue<double>(properties.at("strength"), 0.35), 0.0, 1.0);
    const std::string phaseFilter = NodeUtils::getValue<std::string>(
        properties.at("phase_filter"), "update_or_commit");

    json eventObj = json::object();
    auto itEvent = inputs.find("event");
    if (itEvent != inputs.end()) {
      eventObj = anyToJsonObject(itEvent->second);
    }
    const std::string phase = eventObj.value("phase", std::string("update"));
    const bool phaseAllowed = (phaseFilter == "all") ||
                              (phaseFilter == "update" && phase == "update") ||
                              (phaseFilter == "commit" && phase == "commit") ||
                              (phaseFilter == "update_or_commit" &&
                               (phase == "update" || phase == "commit"));
    if (!phaseAllowed) {
      outputs["mesh"] = std::make_shared<Mesh>(std::move(outMesh));
      outputs["moved"] = 0.0;
      outputs["handles"] = 0.0;
      return true;
    }

    std::string parseErr;
    auto handles = collectHandleTargets(inputs, properties, parseErr);
    if (handles.empty()) {
      outputs["mesh"] = std::make_shared<Mesh>(std::move(outMesh));
      outputs["moved"] = 0.0;
      outputs["handles"] = 0.0;
      return true;
    }

    const int n = static_cast<int>(outMesh.vertices.size());
    std::vector<std::vector<int>> neighbors(n);
    for (const auto &tri : outMesh.triangles) {
      const int a = tri[0], b = tri[1], c = tri[2];
      if (a < 0 || b < 0 || c < 0 || a >= n || b >= n || c >= n) {
        continue;
      }
      neighbors[a].push_back(b);
      neighbors[a].push_back(c);
      neighbors[b].push_back(a);
      neighbors[b].push_back(c);
      neighbors[c].push_back(a);
      neighbors[c].push_back(b);
    }
    for (auto &nb : neighbors) {
      std::sort(nb.begin(), nb.end());
      nb.erase(std::unique(nb.begin(), nb.end()), nb.end());
    }

    std::unordered_set<int> constrained;
    constrained.reserve(handles.size());
    for (const auto &[vid, pos] : handles) {
      (void)pos;
      if (vid >= 0 && vid < n) {
        constrained.insert(vid);
      }
    }

    std::vector<std::array<double, 3>> current = outMesh.vertices;
    for (const auto &[vid, pos] : handles) {
      if (vid >= 0 && vid < n) {
        current[vid] = pos;
      }
    }

    std::vector<std::array<double, 3>> next = current;
    for (int it = 0; it < iterations; ++it) {
      for (int i = 0; i < n; ++i) {
        if (constrained.find(i) != constrained.end()) {
          continue;
        }
        const auto &nb = neighbors[i];
        if (nb.empty()) {
          continue;
        }
        std::array<double, 3> avg{0.0, 0.0, 0.0};
        for (const int j : nb) {
          avg[0] += current[j][0];
          avg[1] += current[j][1];
          avg[2] += current[j][2];
        }
        const double invDeg = 1.0 / static_cast<double>(nb.size());
        avg[0] *= invDeg;
        avg[1] *= invDeg;
        avg[2] *= invDeg;
        next[i][0] = current[i][0] + strength * (avg[0] - current[i][0]);
        next[i][1] = current[i][1] + strength * (avg[1] - current[i][1]);
        next[i][2] = current[i][2] + strength * (avg[2] - current[i][2]);
      }
      for (const auto &[vid, pos] : handles) {
        if (vid >= 0 && vid < n) {
          next[vid] = pos;
        }
      }
      current.swap(next);
    }

    double moved = 0.0;
    for (int i = 0; i < n; ++i) {
      const auto &a = outMesh.vertices[i];
      const auto &b = current[i];
      const double dx = b[0] - a[0];
      const double dy = b[1] - a[1];
      const double dz = b[2] - a[2];
      moved += std::sqrt(dx * dx + dy * dy + dz * dz);
    }
    outMesh.vertices = std::move(current);

    outputs["mesh"] = std::make_shared<Mesh>(std::move(outMesh));
    outputs["moved"] = moved;
    outputs["handles"] = static_cast<double>(constrained.size());
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Laplacian deform node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<node_laplacian_deform> node_laplacian_deform_registrar;
}
