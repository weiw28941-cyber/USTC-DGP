@echo off
echo ========================================
echo Node Graph Processor v3.0 - Build Script
echo ========================================
echo.

REM Check if build directory exists
if not exist build (
    echo Creating build directory...
    mkdir build
)

cd build

echo Configuring CMake...
cmake .. -G "MinGW Makefiles"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] CMake configuration failed!
    cd ..
    pause
    exit /b 1
)

echo.
echo Building project...
cmake --build .

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed!
    cd ..
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build Successful!
echo ========================================
echo.

echo Generating node types configuration...
cd bin
processor.exe --generate-config ..\..\Data\node_types.json

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Node types configuration generated!
) else (
    echo.
    echo [WARNING] Failed to generate node types configuration
)

cd ..\..

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Executable: build\bin\processor.exe
echo Config: Data\node_types.json
echo.
echo Next steps:
echo   1. cd Server
echo   2. npm install
echo   3. npm start
echo   4. Open http://localhost:3000
echo.
echo To test the processor:
echo   build\bin\processor.exe Data\example_graph_v2.json Data\output.json
echo.

pause
