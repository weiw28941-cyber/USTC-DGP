#include "node_matrix.h"
#include <algorithm>
#include <cmath>
#include <sstream>
#include <string>

std::string node_matrix::getType() const { return "matrix"; }
std::string node_matrix::getName() const { return "Matrix"; }
std::string node_matrix::getCategory() const { return "Data"; }
std::string node_matrix::getDescription() const {
  return "Create a matrix from a number vector and target column count";
}

std::vector<Socket> node_matrix::getInputs() const {
  return {
      {"data", "Data", DataType::LIST, std::vector<double>()},
      {"cols", "Cols", DataType::NUMBER, 1.0},
  };
}

std::vector<Socket> node_matrix::getOutputs() const {
  return {
      {"mat", "Matrix", DataType::MATRIX, std::vector<std::vector<double>>()}};
}

std::map<std::string, std::any> node_matrix::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {};
}

std::map<std::string, std::vector<std::string>>
node_matrix::getPropertyOptions() const {
  return {};
}

NodeSchema node_matrix::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#3182ce";
  return schema;
}

bool node_matrix::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> & /*properties*/) {
  try {
    std::vector<double> data;
    auto dataIt = inputs.find("data");
    if (dataIt != inputs.end()) {
      const auto &raw = dataIt->second;
      if (raw.type() == typeid(std::vector<double>)) {
        data = std::any_cast<std::vector<double>>(raw);
      } else if (raw.type() == typeid(std::vector<int>)) {
        const auto ints = std::any_cast<std::vector<int>>(raw);
        data.assign(ints.begin(), ints.end());
      } else {
        errorMessage =
            "Matrix node error: input 'data' must be a number vector";
        return false;
      }
    }

    const double colsRaw = NodeUtils::getValue<double>(inputs.at("cols"), 1.0);
    if (!std::isfinite(colsRaw) || colsRaw <= 0.0) {
      errorMessage = "Matrix node error: column count must be > 0";
      return false;
    }

    const double colsRounded = std::round(colsRaw);
    if (std::fabs(colsRaw - colsRounded) > 1e-9) {
      errorMessage = "Matrix node error: column count must be an integer";
      return false;
    }

    const size_t cols = static_cast<size_t>(colsRounded);
    if (cols == 0) {
      errorMessage = "Matrix node error: column count must be > 0";
      return false;
    }

    if (!data.empty() && (data.size() % cols != 0)) {
      errorMessage =
          "Matrix node error: vector size is not divisible by columns";
      return false;
    }

    const size_t rows = data.empty() ? 0 : (data.size() / cols);
    std::vector<std::vector<double>> matrix(rows,
                                            std::vector<double>(cols, 0.0));

    for (size_t r = 0; r < rows; ++r) {
      for (size_t c = 0; c < cols; ++c) {
        matrix[r][c] = data[r * cols + c];
      }
    }

    outputs["mat"] = matrix;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Matrix node error: ") + e.what();
    return false;
  }
}

namespace {
using Matrix = std::vector<std::vector<double>>;

bool matrixShape(const Matrix &m, size_t &rows, size_t &cols) {
  rows = m.size();
  cols = rows > 0 ? m[0].size() : 0;
  for (size_t r = 1; r < rows; ++r) {
    if (m[r].size() != cols) {
      return false;
    }
  }
  return true;
}

bool anyToMatrix(const std::any &raw, Matrix &out) {
  if (raw.type() == typeid(Matrix)) {
    out = std::any_cast<Matrix>(raw);
    return true;
  }
  if (raw.type() == typeid(std::vector<double>)) {
    const auto row = std::any_cast<std::vector<double>>(raw);
    out = {row};
    return true;
  }
  if (raw.type() == typeid(std::vector<int>)) {
    const auto rowI = std::any_cast<std::vector<int>>(raw);
    std::vector<double> row(rowI.begin(), rowI.end());
    out = {row};
    return true;
  }
  return false;
}
} // namespace

std::string node_matrix_math::getType() const { return "matrix_math"; }
std::string node_matrix_math::getName() const { return "Matrix Math"; }
std::string node_matrix_math::getCategory() const { return "Operation"; }
std::string node_matrix_math::getDescription() const {
  return "Common matrix operations";
}

std::vector<Socket> node_matrix_math::getInputs() const {
  return {
      {"a", "Matrix A", DataType::MATRIX, std::vector<std::vector<double>>()},
      {"b", "Matrix B", DataType::MATRIX, std::vector<std::vector<double>>()},
  };
}

std::vector<Socket> node_matrix_math::getOutputs() const {
  return {{"result", "Result", DataType::MATRIX,
           std::vector<std::vector<double>>()}};
}

std::map<std::string, std::any> node_matrix_math::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("add")}};
}

std::map<std::string, std::vector<std::string>>
node_matrix_math::getPropertyOptions() const {
  return {{"operation",
           {"add", "subtract", "multiply", "divide", "min", "max", "matmul",
            "concat_row", "concat_col"}}};
}

NodeSchema node_matrix_math::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Component-wise, concatenation, or matrix multiplication mode.";
  }
  return schema;
}

bool node_matrix_math::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    Matrix a;
    Matrix b;
    if (!anyToMatrix(inputs.at("a"), a)) {
      errorMessage = "Matrix math node error: invalid Matrix A input";
      return false;
    }
    if (!anyToMatrix(inputs.at("b"), b)) {
      errorMessage = "Matrix math node error: invalid Matrix B input";
      return false;
    }

    size_t aRows = 0, aCols = 0;
    size_t bRows = 0, bCols = 0;
    if (!matrixShape(a, aRows, aCols) || !matrixShape(b, bRows, bCols)) {
      errorMessage = "Matrix math node error: ragged matrix is not supported";
      return false;
    }

    const std::string op =
        NodeUtils::getValue<std::string>(properties.at("operation"), "add");

    if (op == "matmul") {
      if (aCols != bRows) {
        errorMessage =
            "Matrix math node error: A.cols must equal B.rows for matmul";
        return false;
      }

      Matrix result(aRows, std::vector<double>(bCols, 0.0));
      for (size_t i = 0; i < aRows; ++i) {
        for (size_t k = 0; k < aCols; ++k) {
          const double aik = a[i][k];
          for (size_t j = 0; j < bCols; ++j) {
            result[i][j] += aik * b[k][j];
          }
        }
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "concat_row") {
      if (aCols != bCols) {
        errorMessage =
            "Matrix math node error: A.cols must equal B.cols for row concat";
        return false;
      }
      Matrix result;
      result.reserve(aRows + bRows);
      for (const auto &row : a) {
        result.push_back(row);
      }
      for (const auto &row : b) {
        result.push_back(row);
      }
      outputs["result"] = result;
      return true;
    }

    if (op == "concat_col") {
      if (aRows != bRows) {
        errorMessage =
            "Matrix math node error: A.rows must equal B.rows for col concat";
        return false;
      }
      Matrix result(aRows, std::vector<double>(aCols + bCols, 0.0));
      for (size_t i = 0; i < aRows; ++i) {
        for (size_t j = 0; j < aCols; ++j) {
          result[i][j] = a[i][j];
        }
        for (size_t j = 0; j < bCols; ++j) {
          result[i][aCols + j] = b[i][j];
        }
      }
      outputs["result"] = result;
      return true;
    }

    if (aRows != bRows || aCols != bCols) {
      errorMessage = "Matrix math node error: matrix dimensions must match";
      return false;
    }

    Matrix result(aRows, std::vector<double>(aCols, 0.0));
    for (size_t i = 0; i < aRows; ++i) {
      for (size_t j = 0; j < aCols; ++j) {
        if (op == "add") {
          result[i][j] = a[i][j] + b[i][j];
        } else if (op == "subtract") {
          result[i][j] = a[i][j] - b[i][j];
        } else if (op == "multiply") {
          result[i][j] = a[i][j] * b[i][j];
        } else if (op == "divide") {
          if (b[i][j] == 0.0) {
            errorMessage = "Matrix math node error: division by zero";
            return false;
          }
          result[i][j] = a[i][j] / b[i][j];
        } else if (op == "min") {
          result[i][j] = std::min(a[i][j], b[i][j]);
        } else if (op == "max") {
          result[i][j] = std::max(a[i][j], b[i][j]);
        } else {
          errorMessage = "Matrix math node error: unknown operation: " + op;
          return false;
        }
      }
    }

    outputs["result"] = result;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Matrix math node error: ") + e.what();
    return false;
  }
}

std::string node_matrix_unary::getType() const { return "matrix_unary"; }
std::string node_matrix_unary::getName() const { return "Matrix Unary"; }
std::string node_matrix_unary::getCategory() const { return "Operation"; }
std::string node_matrix_unary::getDescription() const {
  return "Single-matrix operations";
}

std::vector<Socket> node_matrix_unary::getInputs() const {
  return {
      {"a", "Matrix", DataType::MATRIX, std::vector<std::vector<double>>()},
  };
}

std::vector<Socket> node_matrix_unary::getOutputs() const {
  return {
      {"result", "Result", DataType::MATRIX,
       std::vector<std::vector<double>>()},
      {"scalar", "Scalar", DataType::NUMBER, 0.0},
  };
}

std::map<std::string, std::any> node_matrix_unary::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("magnitude")}};
}

std::map<std::string, std::vector<std::string>>
node_matrix_unary::getPropertyOptions() const {
  return {{"operation",
           {"magnitude", "normalize", "negate", "sum", "row_sum", "col_sum",
            "transpose"}}};
}

NodeSchema node_matrix_unary::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Unary matrix transform or reduction applied to input matrix A.";
  }
  return schema;
}

bool node_matrix_unary::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    Matrix a;
    if (!anyToMatrix(inputs.at("a"), a)) {
      errorMessage = "Matrix unary node error: invalid matrix input";
      return false;
    }

    size_t rows = 0;
    size_t cols = 0;
    if (!matrixShape(a, rows, cols)) {
      errorMessage = "Matrix unary node error: ragged matrix is not supported";
      return false;
    }

    const std::string op = NodeUtils::getValue<std::string>(
        properties.at("operation"), "magnitude");

    if (op == "transpose") {
      Matrix result(cols, std::vector<double>(rows, 0.0));
      for (size_t r = 0; r < rows; ++r) {
        for (size_t c = 0; c < cols; ++c) {
          result[c][r] = a[r][c];
        }
      }
      outputs["result"] = result;
      outputs["scalar"] = 0.0;
      return true;
    }

    if (op == "negate") {
      Matrix result = a;
      for (size_t r = 0; r < rows; ++r) {
        for (size_t c = 0; c < cols; ++c) {
          result[r][c] = -result[r][c];
        }
      }
      outputs["result"] = result;
      outputs["scalar"] = 0.0;
      return true;
    }

    double accum = 0.0;
    for (size_t r = 0; r < rows; ++r) {
      for (size_t c = 0; c < cols; ++c) {
        const double v = a[r][c];
        if (op == "sum") {
          accum += v;
        } else {
          accum += v * v;
        }
      }
    }

    if (op == "sum") {
      outputs["result"] = a;
      outputs["scalar"] = accum;
      return true;
    }

    if (op == "row_sum") {
      Matrix result(rows, std::vector<double>(1, 0.0));
      for (size_t r = 0; r < rows; ++r) {
        double rowAccum = 0.0;
        for (size_t c = 0; c < cols; ++c) {
          rowAccum += a[r][c];
        }
        result[r][0] = rowAccum;
      }
      outputs["result"] = result;
      outputs["scalar"] = 0.0;
      return true;
    }

    if (op == "col_sum") {
      Matrix result(1, std::vector<double>(cols, 0.0));
      for (size_t c = 0; c < cols; ++c) {
        double colAccum = 0.0;
        for (size_t r = 0; r < rows; ++r) {
          colAccum += a[r][c];
        }
        result[0][c] = colAccum;
      }
      outputs["result"] = result;
      outputs["scalar"] = 0.0;
      return true;
    }

    const double magnitude = std::sqrt(accum);
    if (op == "magnitude") {
      outputs["result"] = a;
      outputs["scalar"] = magnitude;
      return true;
    }

    if (op == "normalize") {
      if (magnitude == 0.0) {
        errorMessage = "Matrix unary node error: cannot normalize zero matrix";
        return false;
      }
      Matrix result = a;
      for (size_t r = 0; r < rows; ++r) {
        for (size_t c = 0; c < cols; ++c) {
          result[r][c] /= magnitude;
        }
      }
      outputs["result"] = result;
      outputs["scalar"] = magnitude;
      return true;
    }

    errorMessage = "Matrix unary node error: unknown operation: " + op;
    return false;
  } catch (const std::exception &e) {
    errorMessage = std::string("Matrix unary node error: ") + e.what();
    return false;
  }
}

std::string node_matrix_scalar::getType() const { return "matrix_scalar"; }
std::string node_matrix_scalar::getName() const { return "Matrix Scalar"; }
std::string node_matrix_scalar::getCategory() const { return "Operation"; }
std::string node_matrix_scalar::getDescription() const {
  return "Matrix-scalar operations";
}

std::vector<Socket> node_matrix_scalar::getInputs() const {
  return {
      {"mat", "Matrix", DataType::MATRIX, std::vector<std::vector<double>>()},
      {"scalar", "Scalar", DataType::NUMBER, 0.0},
  };
}

std::vector<Socket> node_matrix_scalar::getOutputs() const {
  return {
      {"result", "Result", DataType::MATRIX,
       std::vector<std::vector<double>>()},
  };
}

std::map<std::string, std::any> node_matrix_scalar::getProperties() const {
  if (!properties_.empty()) {
    return properties_;
  }
  return {{"operation", std::string("add")}};
}

std::map<std::string, std::vector<std::string>>
node_matrix_scalar::getPropertyOptions() const {
  return {{"operation", {"add", "subtract", "multiply", "divide"}}};
}

NodeSchema node_matrix_scalar::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "#2a4365";
  auto operationIt = schema.properties.find("operation");
  if (operationIt != schema.properties.end()) {
    operationIt->second.editor = "select";
    operationIt->second.description =
        "Operation applied between the matrix input and scalar input.";
  }
  return schema;
}

bool node_matrix_scalar::execute(
    const std::map<std::string, std::any> &inputs,
    std::map<std::string, std::any> &outputs,
    const std::map<std::string, std::any> &properties) {
  try {
    Matrix mat;
    if (!anyToMatrix(inputs.at("mat"), mat)) {
      errorMessage = "Matrix scalar node error: invalid matrix input";
      return false;
    }

    size_t rows = 0;
    size_t cols = 0;
    if (!matrixShape(mat, rows, cols)) {
      errorMessage = "Matrix scalar node error: ragged matrix is not supported";
      return false;
    }

    const double scalar = NodeUtils::getValue<double>(inputs.at("scalar"), 0.0);
    const std::string op =
        NodeUtils::getValue<std::string>(properties.at("operation"), "add");

    Matrix result = mat;
    for (size_t r = 0; r < rows; ++r) {
      for (size_t c = 0; c < cols; ++c) {
        if (op == "add") {
          result[r][c] = mat[r][c] + scalar;
        } else if (op == "subtract") {
          result[r][c] = mat[r][c] - scalar;
        } else if (op == "multiply") {
          result[r][c] = mat[r][c] * scalar;
        } else if (op == "divide") {
          if (scalar == 0.0) {
            errorMessage = "Matrix scalar node error: division by zero";
            return false;
          }
          result[r][c] = mat[r][c] / scalar;
        } else {
          errorMessage = "Matrix scalar node error: unknown operation: " + op;
          return false;
        }
      }
    }

    outputs["result"] = result;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("Matrix scalar node error: ") + e.what();
    return false;
  }
}

namespace {
struct matrix_any_to_json_registrar {
  matrix_any_to_json_registrar() {
    NodeUtils::registerAnyToJson<std::vector<std::vector<double>>>(
        [](const std::any &value, json &out) {
          out = std::any_cast<std::vector<std::vector<double>>>(value);
          return true;
        });
  }
};

matrix_any_to_json_registrar matrix_any_to_json_registrar_instance;
NodeRegistrar<node_matrix> node_matrix_registrar;
NodeRegistrar<node_matrix_math> node_matrix_math_registrar;
NodeRegistrar<node_matrix_unary> node_matrix_unary_registrar;
NodeRegistrar<node_matrix_scalar> node_matrix_scalar_registrar;
} // namespace
