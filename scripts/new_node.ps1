param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [ValidateSet("Utils", "Geometry")]
    [string]$Category = "Utils",

    [string]$DisplayName = "",
    [string]$Description = "",
    [string]$NodeColor = "#2b6cb0",
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function To-ClassSuffix {
    param([string]$Value)
    $parts = ($Value -replace "[^a-zA-Z0-9_]", "_").Split("_", [System.StringSplitOptions]::RemoveEmptyEntries)
    if ($parts.Count -eq 0) { return "custom" }
    return (($parts | ForEach-Object {
        if ($_.Length -eq 0) { return "" }
        $_.Substring(0,1).ToUpper() + $_.Substring(1)
    }) -join " ")
}

if ($Name -notmatch "^[a-zA-Z][a-zA-Z0-9_]*$") {
    throw "Name must match ^[a-zA-Z][a-zA-Z0-9_]*$"
}

$baseDir = (Resolve-Path ".").Path
$safeName = $Name.ToLower()
$className = "node_$safeName"
$nodeType = $safeName
$display = if ([string]::IsNullOrWhiteSpace($DisplayName)) { To-ClassSuffix $safeName } else { $DisplayName }
$desc = if ([string]::IsNullOrWhiteSpace($Description)) { "Auto-generated node: $safeName" } else { $Description }

if ($Category -eq "Geometry") {
    $includeDir = Join-Path $baseDir "NodeSystem/Geometry/include"
    $sourceDir = Join-Path $baseDir "NodeSystem/Geometry/src"
    $nodeCategory = "Geometry"
    $defaultColor = "#276749"
} else {
    $includeDir = Join-Path $baseDir "NodeSystem/Utils/include"
    $sourceDir = Join-Path $baseDir "NodeSystem/Utils/src"
    $nodeCategory = "Custom"
    $defaultColor = "#2b6cb0"
}

$finalColor = if ([string]::IsNullOrWhiteSpace($NodeColor)) { $defaultColor } else { $NodeColor }
$headerPath = Join-Path $includeDir "$className.h"
$sourcePath = Join-Path $sourceDir "$className.cpp"

if ((Test-Path $headerPath -or Test-Path $sourcePath) -and -not $Force) {
    throw "Target file already exists. Use -Force to overwrite: $className"
}

$header = @"
#pragma once

#include "node_base.h"

class $className : public NodeBase {
public:
  std::string getType() const override;
  std::string getName() const override;
  std::string getCategory() const override;
  std::string getDescription() const override;
  std::vector<Socket> getInputs() const override;
  std::vector<Socket> getOutputs() const override;
  std::map<std::string, std::any> getProperties() const override;
  NodeSchema getSchema() const override;
  bool execute(const std::map<std::string, std::any> &inputs,
               std::map<std::string, std::any> &outputs,
               const std::map<std::string, std::any> &properties) override;
};
"@

$source = @"
#include "$className.h"

std::string $className::getType() const { return "$nodeType"; }
std::string $className::getName() const { return "$display"; }
std::string $className::getCategory() const { return "$nodeCategory"; }
std::string $className::getDescription() const { return "$desc"; }

std::vector<Socket> $className::getInputs() const {
  return {{"in", "In", DataType::NUMBER, 0.0}};
}

std::vector<Socket> $className::getOutputs() const {
  return {{"out", "Out", DataType::NUMBER, 0.0}};
}

std::map<std::string, std::any> $className::getProperties() const {
  std::map<std::string, std::any> props = {{"scale", 1.0}};
  for (const auto &entry : properties_) {
    props[entry.first] = entry.second;
  }
  return props;
}

NodeSchema $className::getSchema() const {
  NodeSchema schema = NodeBase::getSchema();
  schema.color = "$finalColor";
  auto scaleIt = schema.properties.find("scale");
  if (scaleIt != schema.properties.end()) {
    scaleIt->second.type = "number";
    scaleIt->second.editor = "number";
    scaleIt->second.description = "Scale applied to the input value.";
  }
  return schema;
}

bool $className::execute(const std::map<std::string, std::any> &inputs,
                         std::map<std::string, std::any> &outputs,
                         const std::map<std::string, std::any> &properties) {
  try {
    double inValue = 0.0;
    auto inIt = inputs.find("in");
    if (inIt != inputs.end()) {
      inValue = NodeUtils::getValue<double>(inIt->second, 0.0);
    }

    double scale = 1.0;
    auto scaleIt = properties.find("scale");
    if (scaleIt != properties.end()) {
      scale = NodeUtils::getValue<double>(scaleIt->second, 1.0);
    }

    outputs["out"] = inValue * scale;
    return true;
  } catch (const std::exception &e) {
    errorMessage = std::string("$display node error: ") + e.what();
    return false;
  }
}

namespace {
NodeRegistrar<$className> ${className}_registrar;
} // namespace
"@

New-Item -ItemType Directory -Force -Path $includeDir | Out-Null
New-Item -ItemType Directory -Force -Path $sourceDir | Out-Null

Set-Content -Path $headerPath -Value $header -Encoding UTF8
Set-Content -Path $sourcePath -Value $source -Encoding UTF8

Write-Host "[OK] Created:"
Write-Host "  $headerPath"
Write-Host "  $sourcePath"
Write-Host ""
Write-Host "Generated with:"
Write-Host "  - NodeBase interface"
Write-Host "  - explicit getSchema() override"
Write-Host "  - NodeRegistrar registration"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Fill in inputs/outputs/properties/execute"
Write-Host "  2. Adjust schema metadata (editor/options/description/color)"
Write-Host "  3. If using CUSTOM outputs, register NodeUtils::registerAnyToJson<T>()"
Write-Host "  4. cmake --build build --config Release"
