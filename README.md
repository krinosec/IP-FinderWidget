
```markdown
# 🌐 IP Finder GNOME Extension 

[![GitHub Actions](https://github.com/krinosec/IP-FinderWidget/actions/workflows/build.yml/badge.svg)](https://github.com/krinosec/IP-FinderWidget/actions)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![Platform](https://img.shields.io/badge/Platform-Kali%20Linux|Fedora|Arch|Ubuntu-lightgrey)

**Real-time IP geolocation with VPN detection and network security monitoring**  
*(GNOME 45+ compatible extension with multi-distro support)*

![Demo](https://raw.githubusercontent.com/krinosec/IP-FinderWidget/main/screenshot.png)  
*Screenshot showing IP details and VPN status*

## ✨ Features
- 🗺️ Live geolocation mapping (OpenStreetMap integration)
- 🔒 Automatic VPN/proxy detection
- 🌐 Multiple API support (ipapi.co, ipinfo.io, custom endpoints)
- 📡 Network interface analysis
- 📋 One-click IP copying
- ⚙️ Customizable settings (refresh interval, API selection)
- 🖥️ System tray integration with status indicators

## 🚀 Installation

### One-Line Install (All Supported Distros)
```bash
curl -sSL https://raw.githubusercontent.com/krinosec/IP-FinderWidget/main/install-deps.sh | sudo bash && \
git clone https://github.com/krinosec/IP-FinderWidget.git && \
cd IP-FinderWidget && \
./install.sh
```

### Manual Installation
```bash
# 1. Install dependencies
sudo apt install -y git meson libsoup2.4-dev gir1.2-nm-1.0  # Debian/Kali
sudo dnf install -y libsoup-devel network-manager-devel      # Fedora
sudo pacman -S libsoup networkmanager clutter               # Arch

# 2. Clone & Build
git clone https://github.com/krinosec/IP-FinderWidget.git
cd IP-FinderWidget
meson setup build
ninja -C build
sudo ninja -C build install

# 3. Enable Extension
gnome-extensions enable ip-finder-widget@krinosec.github.com
```

## 🖱️ Usage
1. Click the **🌐 icon** in your system tray
2. Choose from:
   - `Find My IP`: Auto-detect public IP
   - `Custom Lookup`: Enter specific IP
   - `Refresh`: Force data update
3. View:
   - Geolocation coordinates
   - ISP details
   - Network security status
   - Interactive map preview

## ⚙️ Configuration
Customize via terminal or `dconf-editor`:
```bash
# Change API provider (0=ipapi.co, 1=ipinfo.io, 2=custom)
gsettings set org.gnome.shell.extensions.ip-finder-widget api-service 1

# Set refresh interval (seconds)
gsettings set org.gnome.shell.extensions.ip-finder-widget refresh-interval 60

# Configure VPN detection types
gsettings set org.gnome.shell.extensions.ip-finder-widget vpn-connection-types "['vpn', 'wireguard', 'tun']"
```

## 🔧 Troubleshooting
**Extension not visible?**
```bash
# Check installation
gnome-extensions list --enabled | grep ip-finder

# Reset settings
gsettings reset-recursively org.gnome.shell.extensions.ip-finder-widget

# View logs
journalctl -f -o cat | grep -i "ip-finder"
```

**API Errors?**
```bash
# Test API connectivity
curl -s https://ipapi.co/json | jq

# Switch to backup API
gsettings set org.gnome.shell.extensions.ip-finder-widget api-service 1
```

## 🛠️ Development
```bash
# Build dependencies
sudo apt install -y libgjs-dev libclutter-1.0-dev

# Debug mode
GNOME_SHELL_DEBUG=1 journalctl -f

# Package for distribution
ninja -C build dist

# Test in isolated environment
gnome-extensions disable ip-finder-widget@krinosec.github.com
gnome-extensions enable ip-finder-widget@krinosec.github.com
```

## 📅 Roadmap
- [ ] Preferences GUI
- [ ] IPv6 support
- [ ] Historical data tracking
- [ ] Network threat detection
- [ ] Dark mode support

## 📜 License
GNU General Public License v3.0 - See [LICENSE](LICENSE)

---

*Geolocation data provided by [ipapi.co](https://ipapi.co)  
Map tiles by [OpenStreetMap](https://www.openstreetmap.org/copyright)*
```

**Key Improvements**:
1. Added universal one-line installer
2. Clear distro-specific dependency lists
3. Enhanced troubleshooting section
4. Added development/debugging instructions
5. Interactive configuration examples
6. Future roadmap for contributors
7. Better visual hierarchy with emoji markers

**To Complete**:
1. Add actual screenshot named `screenshot.png`
2. Update roadmap with your priorities
3. Verify all code snippets match your current build process

This README now supports:
✅ New users with one-line install  
✅ Developers with debug instructions  
✅ Cross-distro compatibility  
✅ Clear visual documentation
