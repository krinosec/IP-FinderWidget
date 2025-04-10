'use strict';

// Imports
const { Gio, GLib, St, GObject, Soup, NM } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Config = imports.misc.config;
const ExtensionUtils = imports.misc.extensionUtils;
const ModalDialog = imports.ui.modalDialog;
const Gettext = imports.gettext;
const Lang = imports.lang;

// Fallback for Mainloop (for GNOME versions where it's not defined)
var Mainloop = imports.mainloop ? imports.mainloop : (imports.main ? imports.main : null);

const Me = ExtensionUtils.getCurrentExtension();
const _ = Gettext.domain(Me.metadata['gettext-domain']).gettext;

// Constants
const API_SERVICES = {
  IP_API: 0,
  IPINFO_IO: 1,
  CUSTOM: 2
};
const DEBUG_LOG = true;
const SESSION = new Soup.Session();
const DEFAULT_MAP = Me.path + '/icons/default_map.png';

let settings;
let ipFinderInstance = null;

function debugLog(msg) {
    if (DEBUG_LOG) console.log(`[IP Finder] ${msg}`);
}

/* ***************************************
   Modern Implementation for GNOME 45+
   using GObject.registerClass and async/await
***************************************** */
const IPFinderWidget = GObject.registerClass(
class IPFinderWidget extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'IPFinderWidget');
        this._buildUI();
        this._setupNetworkMonitoring();
        this._refreshData();
        this._setupListeners();
        this._setupAutoRefresh();
    }

    _buildUI() {
        // Build main panel button content
        this.box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        
        this.icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${Me.path}/icons/globe-symbolic.svg`),
            style_class: 'system-status-icon'
        });
        
        this.label = new St.Label({ 
            text: _("Initializing..."),
            style_class: 'system-status-label'
        });

        this.box.add_child(this.icon);
        this.box.add_child(this.label);
        this.add_child(this.box);

        // Build the dropdown menu
        this.menu.removeAll();
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

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
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
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
        // Choose API service based on extension settings
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

        let message = Soup.Message.new('GET', apiUrl);
        let response = await new Promise((resolve, reject) => {
            SESSION.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    let res = SESSION.send_and_read_finish(result);
                    resolve(res);
                } catch (e) {
                    reject(e);
                }
            });
        });

        if (message.status_code !== 200) {
            throw new Error(_("API request failed"));
        }

        // Parse response data (using imports.byteArray for conversion)
        return JSON.parse(imports.byteArray.toString(response));
    }

    _updateDisplay(data) {
        this.label.text = `${data.ip} (${data.country_code || data.country})`;
        
        // Remove previously added info items (if any) from the menu
        this.menu._getMenuItems().forEach(item => {
            if (item._isInfoItem === true) {
                item.destroy();
            }
        });

        let addInfo = (label, value) => {
            let item = new PopupMenu.PopupMenuItem(`<b>${label}:</b> ${value}`, { reactive: false });
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
        let isVPN = connectionTypes.some(type => 
            data.security?.includes(type) || data.network?.includes(type)
        );
        this._vpnStatusItem.label.text = _("VPN Status:") + ` ${isVPN ? '🔒 Connected' : '⚠️ Unprotected'}`;
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
        try {
            this._client = new NM.Client();
            this._client.connect('notify::primary-connection', () => this._refreshData());
            this._client.connect('notify::connectivity', () => this._refreshData());
        } catch (e) {
            debugLog("Network Manager not available");
        }
    }

    _setupAutoRefresh() {
        // Auto-refresh every 5 minutes (300 seconds)
        this._refreshTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
            this._refreshData();
            return true; // Continue the timeout
        });
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

    _showError(message) {
        this.label.text = _("Error");
        let errorItem = new PopupMenu.PopupMenuItem(`<b>${_("Error:")}</b> ${message}`, { reactive: false });
        errorItem.label.clutter_text.use_markup = true;
        this.menu.addMenuItem(errorItem, 1);
    }

    destroy() {
        if (this._refreshTimeout) {
            GLib.Source.remove(this._refreshTimeout);
            this._refreshTimeout = null;
        }
        super.destroy();
    }
});

/* ***************************************
   Fallback Implementation for GNOME <45
   using Lang.Class
***************************************** */
var IPFinderIndicator = new Lang.Class({
    Name: 'IPFinderIndicator',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, "IP Finder Widget");
        this._ipAddress = "Fetching...";
        this._geoData = {};

        this._label = new St.Label({ text: this._ipAddress });
        this.actor.add_child(this._label);

        this._refreshItem = new PopupMenu.PopupMenuItem("Refresh IP");
        this._refreshItem.connect('activate', Lang.bind(this, this._updateIP));
        this.menu.addMenuItem(this._refreshItem);

        this._separator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._separator);

        this._geoItem = new PopupMenu.PopupMenuItem("Location: ...");
        this.menu.addMenuItem(this._geoItem);

        this._updateIP();
        this._setupAutoRefresh();
    },

    _setupAutoRefresh: function() {
        this._timeout = Mainloop.timeout_add_seconds(300, Lang.bind(this, function() {
            this._updateIP();
            return true;
        }));
    },

    _updateIP: function() {
        var url = "https://ipinfo.io/json";
        var message = Soup.Message.new('GET', url);

        var http_session = new Soup.Session();
        http_session.user_agent = 'GnomeShellIPFinder/1.0 (+https://github.com/krinosec/IP-FinderWidget)';

        http_session.queue_message(message, Lang.bind(this, function(session, response) {
            try {
                if (message.status_code !== 200) {
                    this._ipAddress = "API Error";
                    this._label.set_text(this._ipAddress);
                    return;
                }

                var data = JSON.parse(message.response_body.data);
                this._ipAddress = data.ip || "No IP";
                this._geoData = {
                    city: data.city,
                    region: data.region,
                    country: data.country
                };

                this._label.set_text(this._ipAddress);
                this._geoItem.label.text = "Location: " + [
                    this._geoData.city,
                    this._geoData.region,
                    this._geoData.country
                ].filter(Boolean).join(", ");
            } catch(e) {
                logError(e, 'IP-FinderWidget Error');
                this._label.set_text("Parse Error");
            }
        }));
    },

    destroy: function() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
        this.parent();
    }
});

// Create the correct widget instance based on GNOME version
function createWidgetInstance() {
    let majorVersion = parseInt(Config.PACKAGE_VERSION.split('.')[0]);
    if (majorVersion >= 45) {
        return new IPFinderWidget();
    } else {
        return new IPFinderIndicator();
    }
}

/* ***************************************
   Extension Entry Points
***************************************** */
function init() {
    ExtensionUtils.initTranslations();
    settings = ExtensionUtils.getSettings();
}

function enable() {
    if (!ipFinderInstance) {
        ipFinderInstance = createWidgetInstance();
        Main.panel.addToStatusArea('ip-finder-widget', ipFinderInstance);
    }
}

function disable() {
    if (ipFinderInstance) {
        ipFinderInstance.destroy();
        ipFinderInstance = null;
    }
}
