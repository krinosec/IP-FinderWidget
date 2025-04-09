
```markdown
# 🌐 IP Finder GNOME Extension 

[![GitHub Actions Build Status](https://github.com/krinosec/IP-FinderWidget/actions/workflows/build.yml/badge.svg)](https://github.com/krinosec/IP-FinderWidget/actions)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

A GNOME Shell extension for Kali Linux that displays real-time IP geolocation data and VPN status in your system tray.

![Demo Screenshot](./screenshot.png) *(Replace with actual screenshot)*

## Features ✨
- 🎌 Display IP address with country flag
- 📍 Show geolocation data (ISP, city, coordinates)
- 🔒 Monitor VPN connection status
- ⚙️ Customize panel position and widgets
- 🌐 Support for multiple API services (ip-api.com, ipinfo.io)

## Installation (Kali Linux) 💻

### Prerequisites
```bash
sudo apt update && sudo apt install gnome-shell-extensions meson gettext libglib2.0-bin
```

### Step-by-Step Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/krinosec/IP-FinderWidget.git
   cd IP-FinderWidget
   ```

2. Build and install:
   ```bash
   meson setup build
   ninja -C build
   sudo ninja -C build install
   ```

3. Enable extension:
   ```bash
   gnome-extensions enable ip-finder-widget@krinosec.github.com
   ```

4. Restart GNOME Shell:  
   Press `Alt + F2`, type `r`, then press Enter.

## Usage 🖱️
1. Click the **🌐 icon** in your top panel
2. Choose from:
   - **Find My IP**: Auto-detect your public IP
   - **Lookup Custom IP**: Enter any IPv4 address
   - **Refresh**: Force update data
3. View detailed results in dropdown panel

## Configuration ⚙️
Customize via `dconf-editor` or terminal:
```bash
# Example: Change API service to ipinfo.io
gsettings set org.gnome.shell.extensions.ip-finder-widget api-service 'ipinfo'

# Example: Set panel position to left
gsettings set org.gnome.shell.extensions.ip-finder-widget position-in-panel 'left'
```

## For Developers 🛠️
### Build Dependencies
```bash
sudo apt install libglib2.0-dev gir1.2-gtk-3.0
```

### Development Workflow
```bash
# Compile schemas after changes
glib-compile-schemas schemas/

# Debug mode
journalctl -f -o cat | grep -i "ip-finder"

# Package for distribution
ninja -C build dist
```

## Troubleshooting 🔧
**Extension not loading?**
```bash
# Check installation status
gnome-extensions list --enabled | grep ip-finder

# Reset settings
gsettings reset-recursively org.gnome.shell.extensions.ip-finder-widget
```

## TODO 📝
- [ ] Add preferences UI
- [ ] Implement IP history tracking
- [ ] Add more API service options
- [ ] Support IPv6 lookups

## License 📄
This project is licensed under the [GPL-3.0 License](LICENSE).

---

*Geolocation data provided by [ip-api.com](https://ip-api.com).*  
*Kali Linux is a trademark of OffSec Services Limited.*
```

---

### **To Complete**:
1. **Add Screenshot**:
   - Take a screenshot of your extension in action
   - Save as `screenshot.png` in your repo root
   - Update the `![Demo Screenshot]` link accordingly

2. **Final Checks**:
   - Verify all file paths match your actual structure
   - Test installation commands in a fresh Kali environment
   - Update the "TODO" list with your priorities

This README now supports:
✅ GitHub Actions status visibility  
✅ Clear user/developer documentation  
✅ GNOME extension best practices  
✅ Kali Linux-specific instructions  

