#!/bin/bash
# IP-FinderWidget Dependency Installer
# Kali/Debian/Ubuntu/Fedora/Arch support

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Please run with sudo${NC}"
  exit 1
fi

# Detect distro
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  OS=$(uname -s)
fi

# Main installation function
install_deps() {
  case $OS in
    kali|debian|ubuntu|pop)
      echo -e "${GREEN}[+] Installing dependencies for Debian-based systems${NC}"
      apt update || { echo -e "${RED}Failed to update packages${NC}"; exit 1; }
      apt install -y \
        gir1.2-soup-2.4 \
        libsoup2.4-dev \
        gir1.2-nm-1.0 \
        libnm-dev \
        libclutter-1.0-dev \
        gettext \
        gnome-shell-extensions \
        meson \
        ninja-build \
        libgdk-pixbuf2.0-dev \
        libsecret-1-dev || { echo -e "${RED}Installation failed${NC}"; exit 1; }
      ;;
    fedora)
      echo -e "${GREEN}[+] Installing dependencies for Fedora${NC}"
      dnf install -y \
        libsoup-devel \
        network-manager-devel \
        clutter-devel \
        libgdk-pixbuf2-devel \
        libsecret-devel \
        meson \
        ninja-build \
        gettext \
        gnome-shell-extension-tool || { echo -e "${RED}Installation failed${NC}"; exit 1; }
      ;;
    arch|manjaro)
      echo -e "${GREEN}[+] Installing dependencies for Arch-based systems${NC}"
      pacman -Sy --noconfirm \
        libsoup \
        networkmanager \
        clutter \
        gdk-pixbuf2 \
        libsecret \
        meson \
        ninja \
        gettext \
        gnome-shell || { echo -e "${RED}Installation failed${NC}"; exit 1; }
      ;;
    *)
      echo -e "${RED}Unsupported OS: $OS${NC}"
      exit 1
      ;;
  esac
}

# Execute installation
install_deps

echo -e "\n${GREEN}Dependencies installed successfully!${NC}"
echo "Run './install.sh' to build and install the extension"
