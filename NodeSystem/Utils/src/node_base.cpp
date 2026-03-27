#include "node_base.h"
#include <mutex>
#include <sstream>

json NodeBase::toJson() const {
    json data;
    data["type"] = getType();
    data["id"] = id;
    data["success"] = success;
    if (!errorMessage.empty()) {
        data["error"] = errorMessage;
    }
    return data;
}

NodeSchema NodeBase::getSchema() const {
    NodeSchema schema;
    schema.id = getType();
    schema.name = getName();
    schema.category = getCategory();
    schema.description = getDescription();

    for (const auto& input : getInputs()) {
        SocketSchema inputSchema;
        inputSchema.id = input.id;
        inputSchema.label = input.label;
        inputSchema.type = NodeUtils::dataTypeToString(input.type);
        inputSchema.customType = input.customType;
        schema.inputs.push_back(std::move(inputSchema));
    }

    for (const auto& output : getOutputs()) {
        SocketSchema outputSchema;
        outputSchema.id = output.id;
        outputSchema.label = output.label;
        outputSchema.type = NodeUtils::dataTypeToString(output.type);
        outputSchema.customType = output.customType;
        schema.outputs.push_back(std::move(outputSchema));
    }

    const auto propertyOptions = getPropertyOptions();
    for (const auto& [key, value] : getProperties()) {
        PropertySchema propertySchema;
        json defaultValue;
        if (NodeUtils::anyToJson(value, defaultValue)) {
            propertySchema.defaultValue = defaultValue;
            if (defaultValue.is_number()) {
                propertySchema.type = "number";
            } else if (defaultValue.is_boolean()) {
                propertySchema.type = "boolean";
            } else if (defaultValue.is_array()) {
                propertySchema.type = "array";
            } else if (defaultValue.is_object()) {
                propertySchema.type = "object";
            } else {
                propertySchema.type = "string";
            }
        }
        auto optIt = propertyOptions.find(key);
        if (optIt != propertyOptions.end()) {
            propertySchema.options = optIt->second;
            propertySchema.editor = "select";
        }
        schema.properties[key] = std::move(propertySchema);
    }

    return schema;
}

void NodeBase::fromJson(const json& data) {
    if (data.contains("id")) {
        id = data["id"];
    }
}

json NodeFactory::generateNodeTypesConfig() const {
    json config;
    config["nodeTypes"] = json::array();

    for (const auto& [type, creator] : creators_) {
        auto node = creator();
        const NodeSchema schema = node->getSchema();

        json nodeConfig;
        nodeConfig["id"] = schema.id;
        nodeConfig["name"] = schema.name;
        nodeConfig["category"] = schema.category;
        nodeConfig["description"] = schema.description;
        nodeConfig["color"] = schema.color;
        nodeConfig["inputs"] = json::array();
        for (const auto& input : schema.inputs) {
            json inputJson;
            inputJson["id"] = input.id;
            inputJson["label"] = input.label;
            inputJson["type"] = input.type;
            if (!input.customType.empty()) {
                inputJson["customType"] = input.customType;
            }
            nodeConfig["inputs"].push_back(std::move(inputJson));
        }
        nodeConfig["outputs"] = json::array();
        for (const auto& output : schema.outputs) {
            json outputJson;
            outputJson["id"] = output.id;
            outputJson["label"] = output.label;
            outputJson["type"] = output.type;
            if (!output.customType.empty()) {
                outputJson["customType"] = output.customType;
            }
            nodeConfig["outputs"].push_back(std::move(outputJson));
        }
        nodeConfig["properties"] = json::object();
        for (const auto& [key, property] : schema.properties) {
            json propJson;
            propJson["type"] = property.type;
            propJson["default"] = property.defaultValue;
            propJson["editable"] = property.editable;
            if (!property.options.empty()) {
                propJson["options"] = property.options;
            }
            if (!property.editor.empty()) {
                propJson["editor"] = property.editor;
            }
            if (!property.description.empty()) {
                propJson["description"] = property.description;
            }
            nodeConfig["properties"][key] = std::move(propJson);
        }
        config["nodeTypes"].push_back(std::move(nodeConfig));
    }

    return config;
}

namespace NodeUtils {
    namespace {
        using RegistryMap = std::unordered_map<std::type_index, AnyToJsonFn>;

        RegistryMap& anyToJsonRegistry() {
            static RegistryMap registry;
            return registry;
        }

        std::mutex& anyToJsonMutex() {
            static std::mutex mtx;
            return mtx;
        }

        void registerDefaultAnyToJson() {
            registerAnyToJson<int>([](const std::any& value, json& out) {
                out = std::any_cast<int>(value);
                return true;
            });
            registerAnyToJson<double>([](const std::any& value, json& out) {
                out = std::any_cast<double>(value);
                return true;
            });
            registerAnyToJson<float>([](const std::any& value, json& out) {
                out = std::any_cast<float>(value);
                return true;
            });
            registerAnyToJson<std::string>([](const std::any& value, json& out) {
                out = std::any_cast<std::string>(value);
                return true;
            });
            registerAnyToJson<bool>([](const std::any& value, json& out) {
                out = std::any_cast<bool>(value);
                return true;
            });
            registerAnyToJson<std::vector<double>>([](const std::any& value, json& out) {
                out = std::any_cast<std::vector<double>>(value);
                return true;
            });
            registerAnyToJson<std::vector<int>>([](const std::any& value, json& out) {
                out = std::any_cast<std::vector<int>>(value);
                return true;
            });
            registerAnyToJson<std::vector<std::string>>([](const std::any& value, json& out) {
                out = std::any_cast<std::vector<std::string>>(value);
                return true;
            });
            registerAnyToJson<json>([](const std::any& value, json& out) {
                out = std::any_cast<const json&>(value);
                return true;
            });
        }

        struct AnyToJsonDefaultsRegistrar {
            AnyToJsonDefaultsRegistrar() {
                registerDefaultAnyToJson();
            }
        };

        AnyToJsonDefaultsRegistrar any_to_json_defaults_registrar;
    }

    void registerAnyToJson(std::type_index type, AnyToJsonFn fn) {
        std::lock_guard<std::mutex> lock(anyToJsonMutex());
        anyToJsonRegistry()[type] = std::move(fn);
    }

    bool anyToJson(const std::any& value, json& out) {
        const auto type = std::type_index(value.type());
        AnyToJsonFn fn;
        {
            std::lock_guard<std::mutex> lock(anyToJsonMutex());
            auto it = anyToJsonRegistry().find(type);
            if (it == anyToJsonRegistry().end()) {
                return false;
            }
            fn = it->second;
        }

        try {
            return fn(value, out);
        } catch (...) {
            return false;
        }
    }

    std::string dataTypeToString(DataType type) {
        switch (type) {
            case DataType::NUMBER: return "number";
            case DataType::STRING: return "string";
            case DataType::VECTOR: return "vector";
            case DataType::MATRIX: return "matrix";
            case DataType::LIST: return "list";
            case DataType::MAP: return "map";
            case DataType::CUSTOM: return "custom";
            default: return "unknown";
        }
    }

    DataType stringToDataType(const std::string& str) {
        if (str == "number") return DataType::NUMBER;
        if (str == "string") return DataType::STRING;
        if (str == "vector") return DataType::VECTOR;
        if (str == "matrix") return DataType::MATRIX;
        if (str == "list") return DataType::LIST;
        if (str == "map") return DataType::MAP;
        if (str == "custom") return DataType::CUSTOM;
        return DataType::CUSTOM;
    }
}
