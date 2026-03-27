#include "json.hpp"
#include "graph_runtime.h"
#include "node_system_registration.h"
#include <string>

int main(int argc, char *argv[]) {
  if (argc >= 2 && std::string(argv[1]) == "--worker") {
    return runWorkerLoop();
  }
  return runCliApp(argc, argv);
}
