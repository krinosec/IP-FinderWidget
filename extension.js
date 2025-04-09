'use strict';

const { Gio, GLib, St, GObject, Soup, Gdk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Me = ExtensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const API_URL = 'https://ipapi.co/%s/json/';  // Supports both IPv4 and IPv6
const SESSION = new Soup.Session();

let ipFinderButton, settings;

const IPFinderWidget = GObject.registerClass(
class IPFinderWidget extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'IPFinderWidget');
        
        this._buildUI();
        this._refreshData();
        this._setupListeners();
    }

    _buildUI() {
        // Header with icon and text
        this.box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this.icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${Me.path}/icons/globe-symbolic.svg`),
            style_class: 'system-status-icon'
        });
        this.label = new St.Label({ text: _("Loading...") });
        
        this.box.add_child(this.icon);
        this.box.add_child(this.label);
        this.add_child(this.box);

        // Menu items
        this.menu.addMenuItem(new PopupMenu.PopupSeparator());
        this._refreshItem = new PopupMenu.PopupMenuItem(_("Refresh"), { reactive: true });
        this._customIPItem = new PopupMenu.PopupMenuItem(_("Lookup Custom IP"));
        this._vpnStatusItem = new PopupMenu.PopupMenuItem(_("VPN Status: Checking..."));
        
        this.menu.addMenuItem(this._vpnStatusItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparator());
        this.menu.addMenuItem(this._customIPItem);
        this.menu.addMenuItem(this._refreshItem);
    }

    async _refreshData(ip = '') {
        try {
            this.label.text = _("Fetching...");
            const data = await this._fetchIPData(ip);
            this._updateDisplay(data);
            this._checkVPNStatus(data);
        } catch (error) {
            this._showError(error.message);
        }
    }

    async _fetchIPData(ip) {
        const url = `${API_URL}`.replace('%s', ip || '');
        const message = Soup.Message.new('GET', url);
        
        const response = await SESSION.send_and_read_async(
            message, 
            GLib.PRIORITY_DEFAULT, 
            null
        );

        if (message.status_code !== 200) {
            throw new Error(_("API request failed"));
        }

        const decoder = new TextDecoder('utf-8');
        return JSON.parse(decoder.decode(response.get_data()));
    }

    _updateDisplay(data) {
        this.label.text = `${data.ip} (${data.country_code})`;
        
        // Clear existing info items
        this.menu._getMenuItems().forEach(item => {
            if (item._isInfoItem) item.destroy();
        });

        // Add new info items
        const addInfoItem = (label, value) => {
            const item = new PopupMenu.PopupMenuItem(
                `<b>${label}:</b> ${value}`, 
                { reactive: false }
            );
            item._isInfoItem = true;
            item.label.clutter_text.use_markup = true;
            this.menu.addMenuItem(item, 1);
        };

        addInfoItem(_("ISP"), data.org);
        addInfoItem(_("Location"), `${data.city}, ${data.region}`);
        addInfoItem(_("Coordinates"), `${data.latitude}, ${data.longitude}`);
    }

    _checkVPNStatus(data) {
        const isVPN = data.security?.vpn || 
                     data.security?.proxy ||
                     data.network?.includes('tun') ||
                     data.network?.includes('wg');

        this._vpnStatusItem.label.text = _("VPN Status:") + ` ${isVPN ? '🔒 Connected' : '⚠️ Unprotected'}`;
        this._vpnStatusItem.setStyleClass(isVPN ? 'success' : 'warning');
    }

    _setupListeners() {
        this._refreshItem.connect('activate', () => this._refreshData());
        
        this._customIPItem.connect('activate', () => {
            const modal = new ModalDialog.TextEntry(_("Enter IP Address"));
            modal.open(response => {
                if (response && this._validateIP(response)) {
                    this._refreshData(response);
                }
            });
        });
    }

    _validateIP(ip) {
        const ipv4Pattern = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)(\.(?!$)|$)){4}$/;
        const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
    }

    _showError(message) {
        this.label.text = _("Error");
        const errorItem = new PopupMenu.PopupMenuItem(
            `<b>${_("Error:")}</b> ${message}`,
            { reactive: false }
        );
        errorItem.label.clutter_text.use_markup = true;
        this.menu.addMenuItem(errorItem, 1);
    }
});

function init() {
    ExtensionUtils.initTranslations();
    settings = ExtensionUtils.getSettings();
}

function enable() {
    ipFinderButton = new IPFinderWidget();
    Main.panel.addToStatusArea('ip-finder-widget', ipFinderButton);
}

function disable() {
    if (ipFinderButton) {
        ipFinderButton.destroy();
        ipFinderButton = null;
    }
}
