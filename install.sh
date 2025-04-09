#!/bin/bash

# IP-FinderWidget GNOME Extension Installer
# Kali Linux/Debian/Ubuntu

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Please run with sudo${NC}"
  exit 1
fi

# Install dependencies
echo -e "${GREEN}[1/5] Installing dependencies...${NC}"
apt update && apt install -y \
  git \
  meson \
  gettext \
  libglib2.0-bin \
  gnome-shell-extensions

# Clone repo (if not already present)
if [ ! -d "IP-FinderWidget" ]; then
  echo -e "${GREEN}[2/5] Cloning repository...${NC}"
  git clone https://github.com/krinosec/IP-FinderWidget.git
fi

cd IP-FinderWidget

# Compile schemas
echo -e "${GREEN}[3/5] Compiling schemas...${NC}"
glib-compile-schemas schemas/

# Build and install
echo -e "${GREEN}[4/5] Building extension...${NC}"
meson setup build
ninja -C build install

# Enable extension
echo -e "${GREEN}[5/5] Enabling extension...${NC}"
sudo -u $SUDO_USER DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$SUDO_UID/bus" \
  gnome-extensions enable ip-finder-widget@krinosec.github.com

echo -e "\n${GREEN}Installation complete! Restart GNOME Shell with Alt+F2 → r${NC}"
