cmake_minimum_required(VERSION 3.10)
# set(CMAKE_TOOLCHAIN_FILE "C:/Users/lym29/Documents/GitHub/vcpkg/scripts/buildsystems/vcpkg.cmake")

project(NodeGraphProcessor VERSION 3.0 LANGUAGES CXX)
enable_testing()

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Output directories
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

# Util directories
set(UTILS_HEAD_DIR "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/Utils/include/")
set(UTILS_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/Utils/src/")
set(GEOMETRY_HEAD_DIR "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/Geometry/include/")
set(GEOMETRY_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/Geometry/src/")

# find_package(Eigen3 CONFIG REQUIRED)

# Source files for the plugin system
file(GLOB_RECURSE NODE_SYSTEM_SOURCES
    "${UTILS_SOURCE_DIR}/*.cpp"
    "${GEOMETRY_SOURCE_DIR}/*.cpp"
    "NodeSystem/*.cpp"
)

list(REMOVE_ITEM NODE_SYSTEM_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/processor_tests.cpp"
)

list(APPEND NODE_SYSTEM_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_model.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_patch_applier.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_runtime.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_executor.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/node_signature.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/output_transport.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/patch_semantics.cpp"
)

# Header files (for IDE organization)
file(GLOB_RECURSE NODE_SYSTEM_HEADERS
    "${UTILS_HEAD_DIR}/*.h"
    "${GEOMETRY_HEAD_DIR}/*.h"
)

list(APPEND NODE_SYSTEM_HEADERS
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_execution_state.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_model.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_patch_applier.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_runtime.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/node_schema.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/node_system_registration.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/processor_graph.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_executor.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/graph_types.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/node_signature.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/output_transport.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/patch_semantics.h"
)

# Add executable
add_executable(processor ${NODE_SYSTEM_SOURCES} ${NODE_SYSTEM_HEADERS})

set(PROCESSOR_TEST_SOURCES ${NODE_SYSTEM_SOURCES})
list(REMOVE_ITEM PROCESSOR_TEST_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/processor.cpp"
)
add_executable(processor_tests
    ${PROCESSOR_TEST_SOURCES}
    "${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem/processor_tests.cpp"
    ${NODE_SYSTEM_HEADERS}
)

# Include directories
target_include_directories(processor PRIVATE
    ${VCPKG_INCLUDE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem
    ${UTILS_HEAD_DIR}
    ${GEOMETRY_HEAD_DIR}
)

target_include_directories(processor_tests PRIVATE
    ${VCPKG_INCLUDE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/NodeSystem
    ${UTILS_HEAD_DIR}
    ${GEOMETRY_HEAD_DIR}
)

# Compiler warnings
if(MSVC)
    target_compile_options(processor PRIVATE /W4)
    target_compile_options(processor_tests PRIVATE /W4)
else()
    target_compile_options(processor PRIVATE -Wall -Wextra -pedantic)
    target_compile_options(processor_tests PRIVATE -Wall -Wextra -pedantic)
endif()

# Platform-specific settings
if(WIN32)
    message(STATUS "Configuring for Windows")
elseif(UNIX AND NOT APPLE)
    message(STATUS "Configuring for Linux")
elseif(APPLE)
    message(STATUS "Configuring for macOS")
endif()

# Installation
install(TARGETS processor
    RUNTIME DESTINATION bin
)

# Auto-generate node types configuration after build
add_custom_command(TARGET processor POST_BUILD
    COMMAND processor --generate-config ${CMAKE_SOURCE_DIR}/json/generated/node_types.json
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}/bin
    COMMENT "Auto-generating node types configuration from node headers"
)

# Custom target to manually generate node types configuration
add_custom_target(generate_node_config
    COMMAND processor --generate-config ${CMAKE_SOURCE_DIR}/json/generated/node_types.json
    DEPENDS processor
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}/bin
    COMMENT "Manually generating node types configuration"
)

add_test(NAME processor_tests COMMAND $<TARGET_FILE:processor_tests>)

# Print build information
message(STATUS "========================================")
message(STATUS "Node Graph Processor Build Configuration")
message(STATUS "========================================")
message(STATUS "Project: ${PROJECT_NAME}")
message(STATUS "Version: ${PROJECT_VERSION}")
message(STATUS "C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "Build Type: ${CMAKE_BUILD_TYPE}")
message(STATUS "Source Directory: ${CMAKE_CURRENT_SOURCE_DIR}")
message(STATUS "Binary Directory: ${CMAKE_BINARY_DIR}")
message(STATUS "")
message(STATUS "Node System Files:")
message(STATUS "  - node_base.h/cpp (Base classes)")
message(STATUS "  - node_value.h/.cpp (Value input node)")
message(STATUS "  - node_vector.h/.cpp (Vector operations)")
message(STATUS "  - node_list.h/.cpp (List operations)")
message(STATUS "  - node_string.h/.cpp (String input node)")
message(STATUS "  - ... (Other utility nodes)")
message(STATUS "")
message(STATUS "To add custom nodes:")
message(STATUS "  1. Create node_xxx.h under NodeSystem/Utils/include/")
message(STATUS "  2. Add node_xxx.cpp under NodeSystem/Utils/src/")
message(STATUS "  3. Inherit from NodeBase")
message(STATUS "  4. Override getSchema() for editor metadata")
message(STATUS "  5. Register with NodeRegistrar<NodeClass> in .cpp")
message(STATUS "  6. Rebuild project")
message(STATUS "========================================")
