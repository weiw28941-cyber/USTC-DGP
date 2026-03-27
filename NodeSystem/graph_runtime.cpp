#include "graph_runtime.h"

#include "node_base.h"
#include "processor_graph.h"

#include <fstream>
#include <iostream>
#include <stdexcept>

void generateNodeTypesConfig(const std::string &output_file) {
  json config = NodeFactory::instance().generateNodeTypesConfig();

  std::ofstream file(output_file);
  if (file.is_open()) {
    file << config.dump(2) << std::endl;
    file.close();
    std::cout << "Node types configuration generated: " << output_file
              << std::endl;
  } else {
    std::cerr << "Failed to write node types configuration" << std::endl;
  }
}

GraphExecutionRequest parseExecutionRequest(const json &source,
                                           const char *execution_key) {
  GraphExecutionRequest request;
  const json *exec = &source;
  if (execution_key != nullptr) {
    if (!source.contains(execution_key) || !source[execution_key].is_object()) {
      return request;
    }
    exec = &source[execution_key];
  } else if (!source.is_object()) {
    return request;
  }

  if (exec->contains("target_nodes") && (*exec)["target_nodes"].is_array()) {
    for (const auto &item : (*exec)["target_nodes"]) {
      if (item.is_number_integer()) {
        request.focus_nodes.insert(item.get<int>());
      }
    }
    if (!request.focus_nodes.empty()) {
      request.focus_ptr = &request.focus_nodes;
    }
  }
  if (exec->contains("delta_only") && (*exec)["delta_only"].is_boolean()) {
    request.delta_only = (*exec)["delta_only"].get<bool>();
  }
  if (exec->contains("omit_outputs") && (*exec)["omit_outputs"].is_boolean()) {
    request.omit_outputs = (*exec)["omit_outputs"].get<bool>();
  }
  if (exec->contains("max_preview_items") &&
      (*exec)["max_preview_items"].is_number_integer()) {
    const int v = (*exec)["max_preview_items"].get<int>();
    if (v > 0) {
      request.max_preview_items = static_cast<std::size_t>(v);
    }
  }
  if (exec->contains("output_node_ids") && (*exec)["output_node_ids"].is_array()) {
    for (const auto &item : (*exec)["output_node_ids"]) {
      if (item.is_number_integer()) {
        request.output_node_ids.insert(item.get<int>());
      }
    }
    if (!request.output_node_ids.empty()) {
      request.output_node_ids_ptr = &request.output_node_ids;
    }
  }
  if (exec->contains("output_socket_ids") &&
      (*exec)["output_socket_ids"].is_object()) {
    for (auto it = (*exec)["output_socket_ids"].begin();
         it != (*exec)["output_socket_ids"].end(); ++it) {
      int nodeId = 0;
      try {
        nodeId = std::stoi(it.key());
      } catch (...) {
        continue;
      }
      if (!it.value().is_array()) {
        continue;
      }
      auto &dest = request.output_socket_ids[nodeId];
      for (const auto &sid : it.value()) {
        if (sid.is_string()) {
          dest.insert(sid.get<std::string>());
        }
      }
    }
    if (!request.output_socket_ids.empty()) {
      request.output_socket_ids_ptr = &request.output_socket_ids;
    }
  }
  return request;
}

json executeGraphRequest(NodeGraph &graph, const GraphExecutionRequest &request) {
  return request.delta_only
             ? graph.executeDelta(request.focus_ptr, request.omit_outputs,
                                  request.max_preview_items,
                                  request.output_node_ids_ptr,
                                  request.output_socket_ids_ptr)
             : graph.execute(request.focus_ptr);
}

int runWorkerLoop() {
  NodeGraph workerGraph;
  workerGraph.verbose = false;
  bool has_graph = false;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) {
      continue;
    }
    json response = json::object();
    try {
      const json req = json::parse(line);
      const int reqId = req.value("id", 0);
      response["id"] = reqId;
      const std::string cmd = req.value("cmd", "execute_graph");

      if (cmd == "load_graph") {
        if (!req.contains("graph") || !req["graph"].is_object()) {
          throw std::runtime_error("load_graph requires graph object");
        }
        workerGraph.loadFromJson(req["graph"]);
        has_graph = true;
        response["ok"] = true;
        response["loaded"] = true;
      } else if (cmd == "apply_patches") {
        if (!has_graph) {
          throw std::runtime_error("No graph loaded");
        }
        std::string patchErr;
        if (!workerGraph.applyPatches(req.value("patches", json::array()),
                                      patchErr)) {
          throw std::runtime_error(patchErr);
        }
        response["ok"] = true;
        response["patched"] = true;
      } else if (cmd == "execute") {
        if (!has_graph) {
          throw std::runtime_error("No graph loaded");
        }
        GraphExecutionRequest request = parseExecutionRequest(req);
        response["ok"] = true;
        response["results"] = workerGraph.execute(request.focus_ptr);
      } else if (cmd == "execute_delta") {
        if (!has_graph) {
          throw std::runtime_error("No graph loaded");
        }
        GraphExecutionRequest request = parseExecutionRequest(req);
        request.delta_only = true;
        response["ok"] = true;
        response["results"] = executeGraphRequest(workerGraph, request);
      } else if (cmd == "read_output_page") {
        if (!has_graph) {
          throw std::runtime_error("No graph loaded");
        }
        const int nodeId = req.value("node_id", -1);
        const std::string socketId = req.value("socket_id", "");
        const int rawOffset = req.value("offset", 0);
        const int rawLimit = req.value("limit", 0);
        if (nodeId < 0 || socketId.empty()) {
          throw std::runtime_error("read_output_page requires node_id and socket_id");
        }
        const std::size_t offset =
            rawOffset > 0 ? static_cast<std::size_t>(rawOffset) : 0;
        const std::size_t limit =
            rawLimit > 0 ? static_cast<std::size_t>(rawLimit) : 0;
        response["ok"] = true;
        response["results"] =
            workerGraph.readOutputPage(nodeId, socketId, offset, limit);
      } else if (cmd == "execute_graph") {
        json inputData;
        if (req.contains("graph") && req["graph"].is_object()) {
          inputData = req["graph"];
        } else if (req.is_object()) {
          inputData = req;
        } else {
          throw std::runtime_error("Invalid worker request");
        }
        workerGraph.loadFromJson(inputData);
        has_graph = true;
        GraphExecutionRequest request = parseExecutionRequest(inputData, "_execution");
        response["ok"] = true;
        response["results"] = executeGraphRequest(workerGraph, request);
      } else {
        throw std::runtime_error("Unknown worker cmd: " + cmd);
      }
    } catch (const std::exception &e) {
      response["ok"] = false;
      response["error"] = e.what();
    }
    std::cout << response.dump() << std::endl;
    std::cout.flush();
  }
  return 0;
}

int runCliApp(int argc, char *argv[]) {
  std::cout << "Node Graph Processor v3.0 (Plugin System)" << std::endl;
  std::cout << "==========================================" << std::endl;

  if (argc >= 2 && std::string(argv[1]) == "--generate-config") {
    const std::string output_file =
        argc >= 3 ? argv[2] : "../json/generated/node_types.json";
    generateNodeTypesConfig(output_file);
    return 0;
  }

  auto registered_types = NodeFactory::instance().getRegisteredTypes();
  std::cout << "\nRegistered node types (" << registered_types.size()
            << "):" << std::endl;
  for (const auto &type : registered_types) {
    auto node = NodeFactory::instance().createNode(type);
    std::cout << "  - " << type << " (" << node->getName() << ")" << std::endl;
  }

  std::string input_file = "../json/runtime/graph_input.json";
  std::string output_file = "../json/runtime/graph_output.json";
  if (argc >= 2) {
    input_file = argv[1];
  }
  if (argc >= 3) {
    output_file = argv[2];
  }

  std::cout << "\nInput file:  " << input_file << std::endl;
  std::cout << "Output file: " << output_file << std::endl;

  std::ifstream input_stream(input_file);
  if (!input_stream.is_open()) {
    std::cerr << "\nError: Could not open input file: " << input_file
              << std::endl;
    std::cerr << "Usage: " << argv[0] << " [input.json] [output.json]"
              << std::endl;
    std::cerr << "       " << argv[0] << " --generate-config [output.json]"
              << std::endl;
    return 1;
  }

  json input_data;
  try {
    input_stream >> input_data;
    input_stream.close();
  } catch (const std::exception &e) {
    std::cerr << "\nError parsing JSON: " << e.what() << std::endl;
    return 1;
  }

  NodeGraph graph;
  try {
    graph.loadFromJson(input_data);
    graph.printGraph();
    const GraphExecutionRequest request =
        parseExecutionRequest(input_data, "_execution");
    if (request.focus_ptr != nullptr) {
      std::cout << "Execution mode: incremental (" << request.focus_nodes.size()
                << " target nodes)" << std::endl;
    }
    const json results = executeGraphRequest(graph, request);

    std::ofstream output_stream(output_file);
    if (!output_stream.is_open()) {
      std::cerr << "\nError: Could not create output file: " << output_file
                << std::endl;
      return 1;
    }

    output_stream << results.dump(2) << std::endl;
    output_stream.close();

    std::cout << "\nResults written to: " << output_file << std::endl;
    std::cout << "\nSuccess!" << std::endl;
  } catch (const std::exception &e) {
    std::cerr << "\nError processing graph: " << e.what() << std::endl;
    return 1;
  }

  return 0;
}
