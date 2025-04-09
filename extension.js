'use strict';

const { Gio, GLib, St, GObject, Soup, Clutter, NM, Meta, Mtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Config = imports.misc.config;
const ModalDialog = imports.ui.modalDialog;

const Me = ExtensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

// Constants
const API_SERVICES = {
  IP_API: 0,
  IPINFO_IO: 1,
  CUSTOM: 2
};
const DEBUG_LOG = true;
const SESSION = new Soup.Session();
const DEFAULT_MAP = Me.path + '/icons/default_map.png';

let ipFinderButton, settings;

function debugLog(msg) {
  if (DEBUG_LOG) console.log(`[IP Finder] ${msg}`);
}

const IPFinderWidget = GObject.registerClass(
class IPFinderWidget extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'IPFinderWidget');
        this._buildUI();
        this._setupNetworkMonitoring();
        this._refreshData();
    }

    _buildUI() {
        // Main panel button
        this.box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        
        this.icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${Me.path}/icons/globe-symbolic.svg`),
            style_class: 'system-status-icon'
        });
        
        this.label = new St.Label({ 
            text: _("Initializing..."),
            style_class: 'system-status-icon'
        });

        this.box.add_child(this.icon);
        this.box.add_child(this.label);
        this.add_child(this.box);

        // Menu construction
        this.menu.addMenuItem(new PopupMenu.PopupSeparator());
        
        this._vpnStatusItem = new PopupMenu.PopupMenuItem(_("VPN Status: Checking..."));
        this.menu.addMenuItem(this._vpnStatusItem);
        
        this._customIPItem = new PopupMenu.PopupMenuItem(_("Lookup Custom IP"));
        this.menu.addMenuItem(this._customIPItem);
        
        this._refreshItem = new PopupMenu.PopupMenuItem(_("Refresh"));
        this.menu.addMenuItem(this._refreshItem);

        this._mapTile = new St.Icon({
            gicon: Gio.icon_new_for_string(DEFAULT_MAP),
            icon_size: 200
        });
        this.menu.addMenuItem(new PopupMenu.PopupSeparator());
        this.menu.addMenuItem(this._mapTile);
    }

    async _refreshData(ip = '') {
        try {
            this.label.text = _("Fetching...");
            const data = await this._fetchIPData(ip);
            this._updateDisplay(data);
            this._checkVPNStatus(data);
            this._updateMapTile(data);
        } catch (error) {
            this._showError(error.message);
        }
    }

    async _fetchIPData(ip) {
        const apiService = settings.get_enum('api-service');
        let apiUrl;
        
        switch(apiService) {
            case API_SERVICES.IPINFO_IO:
                apiUrl = `https://ipinfo.io/${ip || ''}/json`;
                break;
            case API_SERVICES.CUSTOM:
                apiUrl = settings.get_string('custom-api-url').replace('%s', ip || '');
                break;
            default:
                apiUrl = `https://ipapi.co/${ip || ''}/json/`;
        }

        const message = Soup.Message.new('GET', apiUrl);
        const response = await SESSION.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        
        if (message.status_code !== 200) {
            throw new Error(_("API request failed"));
        }

        return JSON.parse(new TextDecoder().decode(response.get_data()));
    }

    _updateDisplay(data) {
        this.label.text = `${data.ip} (${data.country_code || data.country})`;
        
        // Clear previous info items
        this.menu._getMenuItems().forEach(item => {
            if (item._isInfoItem) item.destroy();
        });

        const addInfo = (label, value) => {
            const item = new PopupMenu.PopupMenuItem(
                `<b>${label}:</b> ${value}`,
                { reactive: false }
            );
            item.label.clutter_text.use_markup = true;
            item._isInfoItem = true;
            this.menu.addMenuItem(item, 1);
        };

        if (data.org) addInfo(_("ISP"), data.org);
        if (data.city) addInfo(_("City"), data.city);
        if (data.region) addInfo(_("Region"), data.region);
        if (data.latitude && data.longitude) {
            addInfo(_("Coordinates"), `${data.latitude}, ${data.longitude}`);
        }
    }

    _checkVPNStatus(data) {
        const connectionTypes = settings.get_strv('vpn-connection-types');
        const isVPN = connectionTypes.some(type => 
            data.security?.includes(type) || 
            data.network?.includes(type)
        );

        this._vpnStatusItem.label.text = _("VPN Status:") + 
            ` ${isVPN ? '🔒 Connected' : '⚠️ Unprotected'}`;
        this._vpnStatusItem.setStyleClass(isVPN ? 'success' : 'warning');
    }

    _updateMapTile(data) {
        if (data.latitude && data.longitude) {
            const zoom = settings.get_int('tile-zoom');
            const mapUrl = `https://tile.openstreetmap.org/${zoom}/${data.latitude}/${data.longitude}.png`;
            this._mapTile.gicon = Gio.icon_new_for_string(mapUrl);
        }
    }

    _setupNetworkMonitoring() {
        this._client = new NM.Client();
        this._client.connect('notify::primary-connection', () => this._refreshData());
        this._client.connect('notify::connectivity', () => this._refreshData());
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

    _setupListeners() {
        this._refreshItem.connect('activate', () => this._refreshData());
        
        this._customIPItem.connect('activate', () => {
            const dialog = new ModalDialog.TextEntry(_("Enter IP Address"));
            dialog.open(response => {
                if (response && this._validateIP(response)) {
                    this._refreshData(response);
                }
            });
        });
    }

    _validateIP(ip) {
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        return ipPattern.test(ip);
    }
});

function init() {
    ExtensionUtils.initTranslations();
    settings = ExtensionUtils.getSettings();
}

function enable() {
    ipFinderButton = new IPFinderWidget();
    Main.panel.addToStatusArea('ip-finder-widget', ipFinderButton);
    ipFinderButton._setupListeners();
}

function disable() {
    if (ipFinderButton) {
        ipFinderButton.destroy();
        ipFinderButton = null;
    }
}
