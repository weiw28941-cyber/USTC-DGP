#include "node_interaction.h"

namespace {

json anyToJsonObject(const std::any &value) {
  if (value.type() == typeid(json)) {
    try {
      const auto &j = std::any_cast<const json &>(value);
      if (j.is_object()) {
        return j;
      }
    } catch (...) {
    }
  }
  json out = json::object();
  if (NodeUtils::anyToJson(value, out) && out.is_object()) {
    return out;
  }
  if (value.type() == typeid(std::string)) {
    try {
      json parsed = json::parse(std::any_cast<std::string>(value));
      if (parsed.is_object()) {
        return parsed;
      }
    } catch (...) {
    }
  }
  return json::object();
}

std::string anyToString(const std::any &value, const std::string &fallback) {
  if (value.type() == typeid(std::string)) {
    return std::any_cast<std::string>(value);
  }
  return fallback;
}

void mergeEventIntoState(json &state, const json &event) {
  if (!state.is_object()) {
    state = json::object();
  }
  if (!event.is_object() || event.empty()) {
    return;
  }
  if (!state.contains("channels") || !state["channels"].is_object()) {
    state["channels"] = json::object();
  }
  const std::string channel = event.value("channel", std::string("viewer"));
  if (!state["channels"].contains(channel) ||
      !state["channels"][channel].is_object()) {
    state["channels"][channel] = json::object();
  }
  json &ch = state["channels"][channel];
  const std::string phase = event.value("phase", std::string("update"));
  json payload = event.value("payload", json::object());
  if (!payload.is_object()) {
    payload = json::object({{"value", payload}});
  }
  ch["version"] = event.value("version", 0);
  ch["phase"] = phase;
  ch["source"] = event.value("source", std::string("webui"));
  ch["sourceNodeId"] = event.value("sourceNodeId", -1);
  ch["targetNodeId"] = event.value("targetNodeId", -1);
  ch["timestampMs"] = event.value("timestampMs", event.value("ts", 0));
  ch["lastEvent"] = event;
  if (phase == "begin" || phase == "update") {
    ch["transient"] = payload;
    ch["payload"] = payload;
  } else if (phase == "commit") {
    ch["committed"] = payload;
    ch["payload"] = payload;
    ch["transient"] = json::object();
  } else if (phase == "cancel") {
    ch["transient"] = json::object();
  }
  state["lastChannel"] = channel;
  state["lastVersion"] = ch["version"];
  state["lastPhase"] = phase;
  state["timestampMs"] = ch["timestampMs"];
  state["ts"] = ch["timestampMs"];
}

} // namespace

std::string node_interaction_state::getType() const {
  return "interaction_state";
}
std::string node_interaction_state::getName() const {
  return "Interaction State";
}
std::string node_interaction_state::getCategory() const {
  return "Interaction";
}
std::string node_interaction_state::getDescription() const {
  return "Unified interaction bridge for mesh edit, vector field, camera, "
         "lighting, and custom channels.";
}

std::vector<Socket> node_interaction_state::getInputs() const {
  return {{"event", "Event", DataType::MAP, json::object()}};
}

std::vector<Socket> node_interaction_state::getOutputs() const {
  return {
      {"state", "State", DataType::MAP, json::object()},
      {"event", "Event", DataType::MAP, json::object()},
      {"payload", "Payload", DataType::MAP, json::object()},
      {"committed", "Committed", DataType::MAP, json::object()},
      {"transient", "Transient", DataType::MAP, json::object()},
      {"channel_state", "Channel State", DataType::MAP, json::object()},
      {"channel", "Channel", DataType::STRING, std::string("viewer")},
      {"phase", "Phase", DataType::STRING, std::string("update")},
      {"phaseMatched", "Phase Matched", DataType::NUMBER, 1.0},
      {"target", "Target", DataType::NUMBER, 0.0},
      {"version", "Version", DataType::NUMBER, 0.0},
  };
}

std::map<std::string, std::any> node_interaction_state::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {
      {"channel", std::string("all")},
      {"custom_channel", std::string("")},
      {"phase_filter", std::string("all")},
      {"interaction_state", json::object()},
      {"interaction_event", json::object()},
  };
}

std::map<std::string, std::vector<std::string>>
node_interaction_state::getPropertyOptions() const {
  return {
      {"channel",
       {"all", "mesh_edit", "vector_field", "camera", "lighting", "custom"}},
      {"phase_filter", {"all", "begin", "update", "commit", "cancel"}}};
}

NodeSchema node_interaction_state::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2f855a";
  auto channelIt = schema.properties.find("channel");
  if (channelIt != schema.properties.end()) {
    channelIt->second.editor = "select";
    channelIt->second.description =
        "Select which interaction channel this node exposes.";
  }
  auto customChannelIt = schema.properties.find("custom_channel");
  if (customChannelIt != schema.properties.end()) {
    customChannelIt->second.editor = "text";
    customChannelIt->second.description =
        "Custom channel name used when channel=custom.";
  }
  auto phaseFilterIt = schema.properties.find("phase_filter");
  if (phaseFilterIt != schema.properties.end()) {
    phaseFilterIt->second.editor = "select";
    phaseFilterIt->second.description =
        "Filter emitted interaction events by lifecycle phase.";
  }
  auto stateIt = schema.properties.find("interaction_state");
  if (stateIt != schema.properties.end()) {
    stateIt->second.editor = "readonly";
    stateIt->second.editable = false;
    stateIt->second.description =
        "Internal accumulated interaction state snapshot.";
  }
  auto eventIt = schema.properties.find("interaction_event");
  if (eventIt != schema.properties.end()) {
    eventIt->second.editor = "readonly";
    eventIt->second.editable = false;
    eventIt->second.description =
        "Most recent normalized interaction event routed into this node.";
  }
  return schema;
}

bool node_interaction_state::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  (void)inputs;
  try {
    const auto itState = properties.find("interaction_state");
    const auto itEvent = properties.find("interaction_event");
    const auto itChannel = properties.find("channel");
    const auto itCustomChannel = properties.find("custom_channel");
    const auto itPhaseFilter = properties.find("phase_filter");

    json state = (itState != properties.end())
                     ? anyToJsonObject(itState->second)
                     : json::object();
    json event = json::object();
    auto inEventIt = inputs.find("event");
    if (inEventIt != inputs.end()) {
      event = anyToJsonObject(inEventIt->second);
    }
    if (!event.is_object() || event.empty()) {
      event = (itEvent != properties.end()) ? anyToJsonObject(itEvent->second)
                                            : json::object();
    }

    std::string channelMode = (itChannel != properties.end())
                                  ? anyToString(itChannel->second, "all")
                                  : "all";
    std::string customChannel = (itCustomChannel != properties.end())
                                    ? anyToString(itCustomChannel->second, "")
                                    : "";
    std::string phaseFilter = (itPhaseFilter != properties.end())
                                  ? anyToString(itPhaseFilter->second, "all")
                                  : "all";
    auto inferChannelFromActionKey = [](const std::string &key) {
      if (key.rfind("mesh_", 0) == 0)
        return std::string("mesh_edit");
      if (key.rfind("viewer_camera", 0) == 0 || key.rfind("camera_", 0) == 0)
        return std::string("camera");
      if (key.rfind("viewer_light", 0) == 0 || key.rfind("light_", 0) == 0)
        return std::string("lighting");
      if (key.rfind("vector_", 0) == 0)
        return std::string("vector_field");
      return std::string("viewer");
    };

    std::string selectedChannel;
    if (channelMode == "custom") {
      selectedChannel = customChannel;
    } else if (channelMode == "all") {
      selectedChannel =
          event.value("channel", state.value("lastChannel", std::string("")));
      if (selectedChannel.empty() && state.contains("channels") &&
          state["channels"].is_object() && !state["channels"].empty()) {
        selectedChannel = state["channels"].begin().key();
      }
    } else {
      selectedChannel = channelMode;
    }
    if (selectedChannel.empty()) {
      selectedChannel = "viewer";
    }

    json selectedEvent = json::object();
    if (event.is_object() && event.value("channel", "") == selectedChannel) {
      selectedEvent = event;
    } else if (state.contains("channels") && state["channels"].is_object() &&
               state["channels"].contains(selectedChannel) &&
               state["channels"][selectedChannel].is_object()) {
      selectedEvent = state["channels"][selectedChannel];
      selectedEvent["channel"] = selectedChannel;
    }
    if ((!selectedEvent.is_object() || selectedEvent.empty()) &&
        event.is_object() && !event.empty()) {
      selectedEvent = event;
      if (!selectedEvent.contains("channel")) {
        selectedEvent["channel"] = selectedChannel;
      }
    }
    // Fallback: synthesize from direct viewer_interaction action property
    // (e.g. mesh_edit_handles / viewer_camera_state) if interaction_event is
    // absent.
    if (!selectedEvent.is_object() || selectedEvent.empty()) {
      for (const auto &[k, v] : properties) {
        if (k == "channel" || k == "custom_channel" || k == "phase_filter" ||
            k == "interaction_state" || k == "interaction_event") {
          continue;
        }
        json actionValue = anyToJsonObject(v);
        if (!actionValue.is_object() || actionValue.empty()) {
          continue;
        }
        selectedEvent = json::object();
        selectedEvent["channel"] = inferChannelFromActionKey(k);
        selectedEvent["phase"] = "update";
        selectedEvent["targetNodeId"] = id;
        selectedEvent["version"] = 0;
        selectedEvent["action"] = k;
        selectedEvent["payload"] = {{"action", k}, {"value", actionValue}};
        selectedChannel = selectedEvent.value("channel", selectedChannel);
        break;
      }
    }
    if (selectedEvent.is_object() && selectedEvent.contains("channel") &&
        selectedEvent["channel"].is_string() &&
        !selectedEvent["channel"].get<std::string>().empty()) {
      selectedChannel = selectedEvent["channel"].get<std::string>();
    }

    // Always fold latest event into state so downstream sockets
    // (state/channel_state/committed/transient) are usable even when
    // interaction_state did not receive explicit property routing.
    mergeEventIntoState(state, selectedEvent);

    bool phaseMatched = true;
    if (phaseFilter != "all" && selectedEvent.is_object()) {
      const std::string currentPhase = selectedEvent.value("phase", "");
      phaseMatched = (currentPhase == phaseFilter);
    }

    json payload = json::object();
    if (selectedEvent.is_object() && selectedEvent.contains("payload")) {
      payload = selectedEvent["payload"];
      if (!payload.is_object()) {
        json wrapped = json::object();
        wrapped["value"] = payload;
        payload = std::move(wrapped);
      }
    }
    json channelState = json::object();
    if (state.contains("channels") && state["channels"].is_object() &&
        state["channels"].contains(selectedChannel) &&
        state["channels"][selectedChannel].is_object()) {
      channelState = state["channels"][selectedChannel];
    } else if (state.contains("lastChannel") &&
               state["lastChannel"].is_string()) {
      const std::string lastChannel = state["lastChannel"].get<std::string>();
      if (!lastChannel.empty() && state["channels"].contains(lastChannel) &&
          state["channels"][lastChannel].is_object()) {
        selectedChannel = lastChannel;
        channelState = state["channels"][lastChannel];
      }
    }
    json committed = json::object();
    if (channelState.contains("committed") &&
        channelState["committed"].is_object()) {
      committed = channelState["committed"];
    }
    if (committed.empty() && channelState.contains("lastEvent") &&
        channelState["lastEvent"].is_object() &&
        channelState["lastEvent"].value("phase", std::string("")) == "commit") {
      json evtPayload =
          channelState["lastEvent"].value("payload", json::object());
      if (evtPayload.is_object()) {
        committed = evtPayload;
      }
    }
    if (committed.empty() &&
        channelState.value("phase", std::string("")) == "commit") {
      json phasePayload = channelState.value("payload", json::object());
      if (phasePayload.is_object()) {
        committed = phasePayload;
      }
    }
    json transient = json::object();
    if (channelState.contains("transient") &&
        channelState["transient"].is_object()) {
      transient = channelState["transient"];
    }
    const std::string selectedPhase =
        selectedEvent.value("phase", std::string("update"));
    if (selectedPhase == "commit" && committed.empty() && payload.is_object()) {
      committed = payload;
    }
    if ((selectedPhase == "begin" || selectedPhase == "update") &&
        transient.empty() && payload.is_object()) {
      transient = payload;
    }

    outputs["state"] = state;
    outputs["event"] = selectedEvent;
    outputs["payload"] = payload;
    outputs["committed"] = committed;
    outputs["transient"] = transient;
    outputs["channel_state"] = channelState;
    outputs["channel"] = selectedChannel;
    outputs["phase"] = selectedPhase;
    outputs["phaseMatched"] = phaseMatched ? 1.0 : 0.0;
    const int targetNode = selectedEvent.value("targetNodeId", id);
    const double version =
        static_cast<double>(selectedEvent.value("version", 0));
    outputs["target"] = static_cast<double>(targetNode);
    outputs["version"] = version;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Interaction state node error: ") + e.what();
    return false;
  }
}

namespace {
struct InteractionJsonRegistrar {
  InteractionJsonRegistrar() {
    NodeUtils::registerAnyToJson<json>([](const std::any &value, json &out) {
      out = std::any_cast<const json &>(value);
      return true;
    });
  }
} interaction_json_registrar;

NodeRegistrar<node_interaction_state> node_interaction_state_registrar;
} // namespace
