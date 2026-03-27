#!/bin/bash

echo "========================================"
echo "Node Graph Processor - Starting Server"
echo "========================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "[ERROR] Failed to install dependencies!"
        echo "Make sure Node.js and npm are installed."
        exit 1
    fi
    echo ""
fi

echo "Starting server..."
echo ""
node server.js
