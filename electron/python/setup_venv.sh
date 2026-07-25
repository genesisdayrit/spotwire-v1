#!/bin/bash
# setup_venv.sh
# This script creates a virtual environment for spotdl and installs required packages

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
APP_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Use VENV_PATH environment variable if provided, otherwise use default
if [ -n "$VENV_PATH" ]; then
    VENV_DIR="$VENV_PATH"
    echo "Using custom venv path from environment variable: $VENV_DIR"
else
    VENV_DIR="$APP_DIR/venv"
fi

# Create parent directories for VENV_DIR if they don't exist
mkdir -p "$(dirname "$VENV_DIR")"

# Use the requirements file path from command line argument, or use default
if [ -n "$1" ]; then
    REQUIREMENTS_FILE="$1"
else
    REQUIREMENTS_FILE="$SCRIPT_DIR/requirements.txt"
fi

echo "Setting up Python virtual environment for spotdl..."
echo "App directory: $APP_DIR"
echo "Venv directory: $VENV_DIR"
echo "Using requirements file: $REQUIREMENTS_FILE"

# Check if the requirements file exists
if [ ! -f "$REQUIREMENTS_FILE" ]; then
    echo "Error: Requirements file not found at $REQUIREMENTS_FILE"
    exit 1
fi

# Find the best available Python version (prefer 3.10+)
PYTHON_CMD=""

# Common Python installation paths on macOS (Electron apps don't inherit shell PATH)
PYTHON_PATHS=(
    "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
    "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"
    "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3"
    "/Library/Frameworks/Python.framework/Versions/3.10/bin/python3"
    "/opt/homebrew/bin/python3"
    "/usr/local/bin/python3"
    "/usr/bin/python3"
)

# First check common installation paths directly
for pypath in "${PYTHON_PATHS[@]}"; do
    if [ -x "$pypath" ]; then
        PYTHON_CMD="$pypath"
        echo "Found Python at: $pypath"
        break
    fi
done

# If not found in common paths, try command -v as fallback
if [ -z "$PYTHON_CMD" ]; then
    for ver in python3.13 python3.12 python3.11 python3.10 python3; do
        if command -v $ver &> /dev/null; then
            PYTHON_CMD=$ver
            echo "Found Python via PATH: $ver"
            break
        fi
    done
fi

# If still not found, error out
if [ -z "$PYTHON_CMD" ]; then
    echo "Error: Python 3 is not installed. Please install Python 3.10 or newer and try again."
    echo "Download from: https://www.python.org/downloads/"
    exit 1
fi

# Check Python version
PYTHON_VERSION=$($PYTHON_CMD --version | cut -d' ' -f2)
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

echo "Using Python: $PYTHON_CMD (version $PYTHON_VERSION)"

# Verify Python version is 3.10 or higher
if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 10 ]); then
    echo "Error: Python 3.10 or higher is required. Found Python $PYTHON_VERSION"
    echo "Please install Python 3.10+ from https://www.python.org/downloads/"
    exit 1
fi

# Remove existing virtual environment if Python version has changed
if [ -f "$VENV_DIR/pyvenv.cfg" ]; then
    VENV_PYTHON_VERSION=$(grep "version" "$VENV_DIR/pyvenv.cfg" | cut -d' ' -f3)
    if [ "$PYTHON_VERSION" != "$VENV_PYTHON_VERSION" ]; then
        echo "Python version changed from $VENV_PYTHON_VERSION to $PYTHON_VERSION"
        echo "Removing outdated virtual environment..."
        rm -rf "$VENV_DIR"
    fi
fi

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment with $PYTHON_CMD..."
    $PYTHON_CMD -m venv "$VENV_DIR"
    if [ $? -ne 0 ]; then
        echo "Error: Failed to create virtual environment. Trying with '--system-site-packages' option..."
        $PYTHON_CMD -m venv --system-site-packages "$VENV_DIR"
        if [ $? -ne 0 ]; then
            echo "Error: Failed to create virtual environment even with --system-site-packages."
            echo "Please check your Python installation and try again."
            exit 1
        fi
    fi
else
    echo "Using existing virtual environment at $VENV_DIR"
fi

# Activate the virtual environment and install packages
echo "Installing required packages..."
source "$VENV_DIR/bin/activate" || { echo "Error: Failed to activate virtual environment"; exit 1; }

# Print active Python version
echo "Using Python: $(python --version)"

# Upgrade pip first
echo "Upgrading pip..."
pip install --upgrade pip

# Install wheel and setuptools first
echo "Installing wheel and setuptools..."
pip install --upgrade wheel setuptools

# Install / update dependencies.
#
# yt-dlp is a rolling-release package: YouTube changes things server-side
# constantly, and an older yt-dlp fails downloads with "YT-DLP download error".
# A static minimum-version floor is not enough — once a user cleared the floor
# they would never upgrade again and would silently break at the next YouTube
# change. So we ALWAYS pull the latest yt-dlp on launch (it is a single small
# package, a few seconds of network) to keep downloads working without needing
# an app release for every YouTube-side change.
CURRENT_YTDLP_VERSION=$(pip show yt-dlp 2>/dev/null | grep "^Version:" | awk '{print $2}')

if [ -n "$CURRENT_YTDLP_VERSION" ]; then
    echo "yt-dlp $CURRENT_YTDLP_VERSION installed. Checking for a newer release..."
    # Always upgrade yt-dlp to the latest release (resilient to YouTube changes).
    pip install --upgrade yt-dlp
    # Ensure the rest of the pinned deps (spotdl, ytmusicapi) meet their minimums.
    pip install --upgrade -r "$REQUIREMENTS_FILE"
else
    # First run: no venv packages yet, do a full install.
    echo "Installing dependencies from requirements.txt..."
    pip install -r "$REQUIREMENTS_FILE"
    # And make sure yt-dlp is the very latest, not just the floor in requirements.
    pip install --upgrade yt-dlp
fi

# Check if ffmpeg is installed in the system
if ! command -v ffmpeg &> /dev/null; then
    echo "Warning: ffmpeg not found in system PATH."
    echo "spotdl requires ffmpeg to function properly."
    echo "Please install ffmpeg using your system's package manager:"
    echo "  - macOS: brew install ffmpeg"
    echo "  - Linux: sudo apt install ffmpeg"
    echo "  - Windows: download from https://ffmpeg.org/download.html"
else
    echo "ffmpeg found in system PATH: $(which ffmpeg)"
fi

echo "Setup complete! Virtual environment is ready."
echo "You can now use spotdl through the spotwire app."