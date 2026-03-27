#pragma once

#include <string>
#include <map>
#include <vector>
#include <memory>
#include <any>
#include <functional>
#include <typeindex>
#include <unordered_map>
#include "json.hpp"
#include "node_schema.h"

using json = nlohmann::json;

// Data types supported by the node system
enum class DataType {
    NUMBER,
    STRING,
    VECTOR,
    MATRIX,
    LIST,
    MAP,
    CUSTOM
};

// Socket definition
struct Socket {
    std::string id;
    std::string label;
    DataType type;
    std::any value;
    std::string customType = "";
};

// Base class for all nodes
class NodeBase {
public:
    virtual ~NodeBase() = default;

    // Node identification
    virtual std::string getType() const = 0;
    virtual std::string getName() const = 0;
    virtual std::string getCategory() const = 0;
    virtual std::string getDescription() const = 0;

    // Node configuration
    virtual std::vector<Socket> getInputs() const = 0;
    virtual std::vector<Socket> getOutputs() const = 0;
    virtual std::map<std::string, std::any> getProperties() const = 0;
    virtual std::map<std::string, std::vector<std::string>> getPropertyOptions() const {
        return {};
    }
    virtual NodeSchema getSchema() const;
    virtual void setProperties(const std::map<std::string, std::any>& props) {
        properties_ = props;
    }

    // Node execution
    virtual bool execute(
        const std::map<std::string, std::any>& inputs,
        std::map<std::string, std::any>& outputs,
        const std::map<std::string, std::any>& properties
    ) = 0;

    // Serialization
    virtual json toJson() const;
    virtual void fromJson(const json& data);

    // Node state
    int id = -1;
    bool success = true;
    std::string errorMessage;

protected:
    std::map<std::string, std::any> properties_;
};

// Node factory for registering and creating nodes
class NodeFactory {
public:
    using NodeCreator = std::function<std::unique_ptr<NodeBase>()>;

    static NodeFactory& instance() {
        static NodeFactory factory;
        return factory;
    }

    void registerNode(const std::string& type, NodeCreator creator) {
        creators_[type] = creator;
    }

    std::unique_ptr<NodeBase> createNode(const std::string& type) {
        auto it = creators_.find(type);
        if (it != creators_.end()) {
            return it->second();
        }
        return nullptr;
    }

    std::vector<std::string> getRegisteredTypes() const {
        std::vector<std::string> types;
        for (const auto& [type, _] : creators_) {
            types.push_back(type);
        }
        return types;
    }

    json generateNodeTypesConfig() const;

private:
    NodeFactory() = default;
    std::map<std::string, NodeCreator> creators_;
};

// Registrar class for registering nodes (scales better than macros)
template<typename NodeClass>
class NodeRegistrar {
public:
    NodeRegistrar() {
        auto temp_node = std::make_unique<NodeClass>();
        const std::string node_type = temp_node->getType();
        NodeFactory::instance().registerNode(
            node_type,
            []() -> std::unique_ptr<NodeBase> {
                return std::make_unique<NodeClass>();
            }
        );
    }
};

// Utility functions for type conversion
namespace NodeUtils {
    std::string dataTypeToString(DataType type);
    DataType stringToDataType(const std::string& str);

    template<typename T>
    T getValue(const std::any& value, const T& defaultValue = T()) {
        try {
            return std::any_cast<T>(value);
        } catch (const std::bad_any_cast&) {
            return defaultValue;
        }
    }

    template<typename T>
    const T* getValuePtr(const std::any& value) {
        if (const auto p = std::any_cast<T>(&value)) {
            return p;
        }
        if (const auto p = std::any_cast<std::shared_ptr<T>>(&value)) {
            return p->get();
        }
        if (const auto p = std::any_cast<std::shared_ptr<const T>>(&value)) {
            return p->get();
        }
        return nullptr;
    }

    using AnyToJsonFn = std::function<bool(const std::any&, json&)>;
    void registerAnyToJson(std::type_index type, AnyToJsonFn fn);
    bool anyToJson(const std::any& value, json& out);

    template<typename T>
    void registerAnyToJson(AnyToJsonFn fn) {
        registerAnyToJson(std::type_index(typeid(T)), std::move(fn));
    }
}
