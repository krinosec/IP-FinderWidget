"use strict";

// Imports from GNOME Shell
const Clutter      = imports.gi.Clutter;
const Gio          = imports.gi.Gio;
const GLib         = imports.gi.GLib;
const GObject      = imports.gi.GObject;
const NM           = imports.gi.NM;
const Soup         = imports.gi.Soup;
const St           = imports.gi.St;

const Config         = imports.misc.config;
const ExtensionUtils = imports.misc.extensionUtils;
const ModalDialog    = imports.ui.modalDialog;
const Gettext        = imports.gettext;
const Lang           = imports.lang;
const Main           = imports.ui.main;
const PanelMenu      = imports.ui.panelMenu;
const PopupMenu      = imports.ui.popupMenu;

const Me  = ExtensionUtils.getCurrentExtension();
const _   = Gettext.domain(Me.metadata['gettext-domain']).gettext;

// Enable debug logging – set DEBUG_LOG to false to disable
const DEBUG_LOG = true;
function debugLog(msg) {
  if (DEBUG_LOG) log(`[IP-Finder] ${msg}`);
}

// Constants for API services and panel actor options
const API_SERVICES = {
  IP_API: 0,
  IPINFO_IO: 1,
  CUSTOM: 2,
};

const PanelActors = {
  FLAG_IP: 0,
  FLAG: 1,
  IP: 2,
};

const SESSION      = new Soup.Session();
const DEFAULT_MAP  = Me.path + '/icons/default_map.png';

let settings;
let ipFinderInstance = null;

// -----------------------------------------------------------------------------
// VpnInfoBox
// Displays the VPN status inside the menu.
const VpnInfoBox = GObject.registerClass(
class IPFinderVpnInfoBox extends St.BoxLayout {
  _init(params = {}) {
    super._init({ ...params });
    this._vpnTitleLabel = new St.Label({
      style_class: 'ip-info-vpn-off',
      text: `${_('VPN')}: `,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.START,
    });
    this.add_child(this._vpnTitleLabel);

    this._vpnStatusLabel = new St.Label({
      style_class: 'ip-info-vpn-off',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.START,
      x_expand: true,
    });
    this.add_child(this._vpnStatusLabel);

    this._vpnIcon = new St.Icon({
      style_class: 'popup-menu-icon ip-info-vpn-off',
    });
    this.add_child(this._vpnIcon);
  }

  setVpnStatus(vpnStatus) {
    // Suggestion: Consider validating vpnStatus before using it.
    this._vpnTitleLabel.set_style_class_name(vpnStatus.styleClass);
    this._vpnStatusLabel.set_style_class_name(vpnStatus.styleClass);
    this._vpnIcon.set_style_class_name(`popup-menu-icon ${vpnStatus.styleClass}`);
    this._vpnStatusLabel.text = vpnStatus.vpnOn ? vpnStatus.vpnName : _('Off');
    this._vpnIcon.gicon = Gio.icon_new_for_string(vpnStatus.iconPath);
  }
});

// -----------------------------------------------------------------------------
// BaseButton with tooltip functionality
const BaseButton = GObject.registerClass(
class IPFinderBaseButton extends St.Button {
  _init(text, params = {}) {
    super._init(Object.assign({
      style_class: 'icon-button',
      reactive: true,
      can_focus: true,
      track_hover: true,
      button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
    }, params));
    this.connect('notify::hover', () => this._onHover());
    this.connect('destroy', () => this._onDestroy());
    this.tooltipLabel = new St.Label({
      style_class: 'dash-label tooltip-label',
      text: _(text)
    });
    this.tooltipLabel.hide();
    global.stage.add_child(this.tooltipLabel);
  }

  _onHover() {
    if (this.hover)
      this.showLabel();
    else
      this.hideLabel();
  }

  showLabel() {
    this.tooltipLabel.opacity = 0;
    this.tooltipLabel.show();
    const [stageX, stageY] = this.get_transformed_position();
    const itemWidth   = this.allocation.get_width();
    const labelWidth  = this.tooltipLabel.get_width();
    const offset      = 6;
    const xOffset     = Math.floor((itemWidth - labelWidth) / 2);
    const monitorIndex = Main.layoutManager.findIndexForActor(this);
    const workArea    = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
    let y;
    const x = Math.clamp(stageX + xOffset, offset, workArea.x + workArea.width - labelWidth - offset);
    // Simplified check to place label below icon if space permits.
    if (stageY + this.allocation.get_height() + this.tooltipLabel.get_height() < workArea.y + workArea.height)
      y = stageY + this.allocation.get_height() + offset;
    else
      y = stageY - this.tooltipLabel.get_height() - offset;
    this.tooltipLabel.remove_all_transitions();
    this.tooltipLabel.set_position(x, y);
    this.tooltipLabel.ease({
      opacity: 255,
      duration: 250,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD
    });
  }

  hideLabel() {
    this.tooltipLabel.ease({
      opacity: 0,
      duration: 100,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => this.tooltipLabel.hide()
    });
  }

  _onDestroy() {
    this.tooltipLabel.remove_all_transitions();
    this.tooltipLabel.hide();
    global.stage.remove_child(this.tooltipLabel);
    this.tooltipLabel.destroy();
  }
});

// -----------------------------------------------------------------------------
// Main Panel Menu Button – displays IP info and controls.
const IPFinderMenuButton = GObject.registerClass(
class IPFinderMenuButton extends PanelMenu.Button {
  _init(extension) {
    super._init(0.5, _('IP Details'));
    // Setup the menu appearance.
    this.menu.box.style = 'padding: 16px;';
    this._extension = extension;
    this._settings = extension.getSettings();
    this._createSettingsConnections();
    this._textureCache = St.TextureCache.get_default();

    // Default IP data to show while loading.
    this._defaultIpData = {
      ip: { name: _('IP Address'), text: _('Loading IP Details') },
      hostname: { name: _('Hostname'), text: '' },
      org: { name: _('Organization'), text: '' },
      city: { name: _('City'), text: '' },
      region: { name: _('Region'), text: '' },
      country: { name: _('Country'), text: '' },
      loc: { name: _('Location'), text: '' },
      postal: { name: _('Postal'), text: '' },
      timezone: { name: _('Timezone'), text: '' }
    };

    // Configure network session with a custom User-Agent.
    const SESSION_TYPE = GLib.getenv('XDG_SESSION_TYPE');
    const PACKAGE_VERSION = Config.PACKAGE_VERSION;
    const USER_AGENT = `Mozilla/5.0 (${SESSION_TYPE}; GNOME Shell/${PACKAGE_VERSION}; Linux) IP_Finder/${this._extension.metadata.version}`;
    this._session = new Soup.Session({ user_agent: USER_AGENT, timeout: 60 });
    this._defaultMapTile = `${this._extension.path}/icons/default_map.png`;
    this._latestMapTile = `${this._extension.path}/icons/latest_map.png`;

    // Build the panel UI.
    const panelBox = new St.BoxLayout({
      style_class: 'panel-status-menu-box',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.FILL
    });
    this.add_child(panelBox);

    // VPN status icon.
    this._vpnStatusIcon = new St.Icon({
      icon_name: 'changes-prevent-symbolic',
      style_class: 'system-status-icon',
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
    });
    panelBox.add_child(this._vpnStatusIcon);

    // IP address label.
    this._ipAddressLabel = new St.Label({
      text: this._defaultIpData.ip.text,
      style_class: 'system-status-icon',
      y_align: Clutter.ActorAlign.CENTER,
    });
    panelBox.add_child(this._ipAddressLabel);

    // Connection status icon.
    this._statusIcon = new St.Icon({
      icon_name: 'network-wired-acquiring-symbolic',
      style_class: 'system-status-icon',
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
    });
    panelBox.add_child(this._statusIcon);

    // Flag icon (for country flag).
    this._flagIcon = new St.Label({
      visible: false,
      style_class: 'system-status-icon',
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
    });
    panelBox.add_child(this._flagIcon);

    // Build the popup menu.
    const menuSection = new PopupMenu.PopupMenuSection();
    this.menu.addMenuItem(menuSection);

    const mapAndIpDetailsBox = new St.BoxLayout({
      style: 'min-width:540px; padding-bottom: 10px;',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
    });
    menuSection.actor.add_child(mapAndIpDetailsBox);

    // Map tile container.
    this._mapTileBox = new St.BoxLayout({
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      y_expand: true,
    });
    mapAndIpDetailsBox.add_child(this._mapTileBox);
    this._mapTileBox.add_child(this._getMapTileIcon(this._defaultMapTile));

    // IP info container.
    const ipInfoParentBox = new St.BoxLayout({
      style_class: 'ip-info-box',
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
    });
    mapAndIpDetailsBox.add_child(ipInfoParentBox);

    this._vpnInfoBox = new VpnInfoBox();
    ipInfoParentBox.add_child(this._vpnInfoBox);

    this._ipInfoBox = new St.BoxLayout({ vertical: true });
    ipInfoParentBox.add_child(this._ipInfoBox);

    // Buttons row.
    const buttonBox = new St.BoxLayout();
    menuSection.actor.add_child(buttonBox);

    const settingsButton = new BaseButton(_('Settings'), { icon_name: 'emblem-system-symbolic' });
    settingsButton.connect('clicked', () => {
      extension.openPreferences();
      this.menu.toggle();
    });
    buttonBox.add_child(settingsButton);

    const copyButton = new BaseButton(_('Copy IP'), { icon_name: 'edit-copy-symbolic', x_expand: true, x_align: Clutter.ActorAlign.CENTER });
    copyButton.connect('clicked', () => {
      this._setClipboardText(this._ipAddressLabel.text);
    });
    buttonBox.add_child(copyButton);

    const refreshButton = new BaseButton(_('Refresh'), { icon_name: 'view-refresh-symbolic', x_expand: false, x_align: Clutter.ActorAlign.END });
    refreshButton.connect('clicked', () => this._startGetIpInfo());
    buttonBox.add_child(refreshButton);

    // Initiate network connection asynchronously.
    NM.Client.new_async(null, this.establishNetworkConnectivity.bind(this));

    // Add the widget to the status area.
    Main.panel.addToStatusArea('ip-menu', this, 1, this._settings.get_string('position-in-panel'));
    this._updatePanelWidgets();
    this._updateVPNWidgets();
  }

  // Clipboard helper
  _setClipboardText(text) {
    const clipboard = St.Clipboard.get_default();
    clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
  }

  // Wire settings changes for dynamic updates.
  _createSettingsConnections() {
    this._settings.connectObject('changed::vpn-status', () => this._updateVPNWidgets(), this);
    this._settings.connectObject('changed::vpn-widgets', () => this._updateVPNWidgets(), this);
    this._settings.connectObject('changed::vpn-status-only-when-on', () => this._updateVPNWidgets(), this);
    this._settings.connectObject('changed::vpn-icon-color', () => this._updateVPNWidgets(), this);
    this._settings.connectObject('changed::vpn-ip-address-color', () => this._updateVPNWidgets(), this);
    this._settings.connectObject('changed::position-in-panel', () => this._updatePosition(), this);
    this._settings.connectObject('changed::actors-in-panel', () => this._updatePanelWidgets(), this);
    this._settings.connectObject('changed::vpn-connections-whitelist', () => this._startGetIpInfo(), this);
    this._settings.connectObject('changed::api-service', () => this._startGetIpInfo(), this);
    this._settings.connectObject('changed::tile-zoom', () => this._startGetIpInfo(), this);
    this._settings.connectObject('changed::vpn-connection-types', () => this._startGetIpInfo(), this);
  }

  _updatePanelWidgets() {
    const panelActors = this._settings.get_enum('actors-in-panel');
    if (panelActors === PanelActors.FLAG_IP) {
      this._flagIcon.show();
      this._ipAddressLabel.show();
    } else if (panelActors === PanelActors.FLAG) {
      this._flagIcon.show();
      this._ipAddressLabel.hide();
    } else if (panelActors === PanelActors.IP) {
      this._flagIcon.hide();
      this._ipAddressLabel.show();
    }
    this._setPanelWidgetsPadding();
  }

  _setPanelWidgetsPadding() {
    const iconShown  = this._flagIcon.visible || this._statusIcon.visible;
    const ipShown    = this._ipAddressLabel.visible;
    const vpnShown   = this._vpnStatusIcon.visible;
    let style = '';
    if (iconShown && ipShown && vpnShown)
      style = 'padding-left: 0px; padding-right: 0px;';
    else if (iconShown && ipShown && !vpnShown)
      style = 'padding-right: 0px;';
    else if (!iconShown && ipShown && vpnShown)
      style = 'padding-left: 0px;';
    this._ipAddressLabel.style = style;
  }

  _updateVPNWidgets() {
    // Determine if VPN status should be shown.
    const showWhenActive = this._settings.get_boolean('vpn-status-only-when-on') ? this._vpnConnectionOn : true;
    const showVpnStatus  = this._settings.get_boolean('vpn-status') && showWhenActive;
    const vpnWidgets     = this._settings.get_enum('vpn-widgets');
    this._vpnStatusIcon.visible = showVpnStatus && (vpnWidgets !== 1); // 1 = TEXT_ONLY
    this._vpnInfoBox.visible    = showVpnStatus && (vpnWidgets !== 2); // 2 = ICON_ONLY
    this._vpnStatusIcon.icon_name = this._vpnConnectionOn ? 'changes-prevent-symbolic' : 'changes-allow-symbolic';
    if (this._settings.get_boolean('vpn-icon-color'))
      this._vpnStatusIcon.style_class = this._vpnConnectionOn ? 'system-status-icon ip-info-vpn-on' : 'system-status-icon ip-info-vpn-off';
    else
      this._vpnStatusIcon.style_class = 'system-status-icon';
    if (this._settings.get_boolean('vpn-ip-address-color'))
      this._ipAddressLabel.style_class = this._vpnConnectionOn ? 'system-status-icon ip-info-vpn-on' : 'system-status-icon ip-info-vpn-off';
    else
      this._ipAddressLabel.style_class = 'system-status-icon';
    this._setPanelWidgetsPadding();
  }

  _updatePosition() {
    Main.panel.statusArea['ip-menu'] = null;
    Main.panel.addToStatusArea('ip-menu', this, 1, this._settings.get_string('position-in-panel'));
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

  async _fetchIPData(ip = '') {
    const apiService = this._settings.get_enum('api-service');
    let apiUrl;
    switch(apiService) {
      case API_SERVICES.IPINFO_IO:
        apiUrl = `https://ipinfo.io/${ip || ''}/json`;
        break;
      case API_SERVICES.CUSTOM:
        apiUrl = this._settings.get_string('custom-api-url').replace('%s', ip || '');
        break;
      default:
        apiUrl = `https://ipapi.co/${ip || ''}/json/`;
    }
    let message  = Soup.Message.new('GET', apiUrl);
    let response = await new Promise((resolve, reject) => {
      SESSION.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
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
    try {
      return JSON.parse(imports.byteArray.toString(response));
    } catch (e) {
      throw new Error(_("Failed to parse API response"));
    }
  }

  _updateDisplay(data) {
    this.label.text = `${data.ip} (${data.country_code || data.country})`;
    // Remove previous info items.
    this.menu._getMenuItems().forEach(item => {
      if (item._isInfoItem === true) item.destroy();
    });
    let addInfo = (label, value) => {
      let item = new PopupMenu.PopupMenuItem(`<b>${label}:</b> ${value}`, { reactive: false });
      item.label.clutter_text.use_markup = true;
      item._isInfoItem = true;
      this.menu.addMenuItem(item, 1);
    };
    if (data.org)    addInfo(_("ISP"), data.org);
    if (data.city)   addInfo(_("City"), data.city);
    if (data.region) addInfo(_("Region"), data.region);
    if (data.latitude && data.longitude)
      addInfo(_("Coordinates"), `${data.latitude}, ${data.longitude}`);
  }

  _checkVPNStatus(data) {
    const connectionTypes = this._settings.get_strv('vpn-connection-types');
    let isVPN = connectionTypes.some(type =>
      data.security?.includes(type) || data.network?.includes(type)
    );
    this._vpnStatusItem.label.text = _("VPN Status:") + ` ${isVPN ? '🔒 Connected' : '⚠️ Unprotected'}`;
    this._vpnStatusItem.setStyleClass(isVPN ? 'success' : 'warning');
  }

  _updateMapTile(data) {
    if (data.latitude && data.longitude) {
      const zoom = this._settings.get_int('tile-zoom');
      const mapUrl = `https://tile.openstreetmap.org/${zoom}/${data.latitude}/${data.longitude}.png`;
      this._mapTile.gicon = Gio.icon_new_for_string(mapUrl);
    }
  }

  _setupNetworkMonitoring() {
    try {
      this._client = NM.Client.new();
      this._client.connect('notify::primary-connection', () => this._refreshData());
      this._client.connect('notify::connectivity', () => this._refreshData());
    } catch (e) {
      debugLog("Network Manager not available");
    }
  }

  _setupAutoRefresh() {
    this._refreshTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
      this._refreshData();
      return true;
    });
  }

  _setupListeners() {
    this._refreshItem.connect('activate', () => this._refreshData());
    this._customIPItem.connect('activate', () => {
      const dialog = new ModalDialog.TextEntry(_("Enter IP Address"));
      dialog.open(response => {
        if (response && this._validateIP(response))
          this._refreshData(response);
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

  _setAcquiringDetails() {
    this._flagIcon.hide();
    this._statusIcon.show();
    this._ipAddressLabel.text = _('Loading IP Details');
    this._ipAddressLabel.style_class = 'system-status-icon';
    this._statusIcon.icon_name = 'network-wired-acquiring-symbolic';
    this._vpnStatusIcon.style_class = 'system-status-icon';
    this._vpnStatusIcon.hide();
    this._vpnInfoBox.hide();
  }

  _startGetIpInfo() {
    this._session.abort();
    if (this._getIpInfoId) {
      GLib.source_remove(this._getIpInfoId);
      this._getIpInfoId = null;
    }
    this._setAcquiringDetails();
    this._getIpInfoId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
      this._getIpInfo().catch(err => debugLog(err));
      this._getIpInfoId = null;
      return GLib.SOURCE_REMOVE;
    });
  }

  async _getIpInfo() {
    this._setAcquiringDetails();
    this._vpnConnectionOn = false;
    this._vpnConnectionName = null;
    if (this._client.connectivity === NM.ConnectivityState.NONE) {
      this._setIpDetails();
      return;
    }
    const whiteList = this._settings.get_strv('vpn-connections-whitelist');
    const activeConnectionIds = [];
    const activeConnections = this._client.get_active_connections() || [];
    const handledTypes = this._settings.get_strv('vpn-connection-types');
    debugLog('Active Connections:');
    activeConnections.forEach(conn => {
      activeConnectionIds.push(conn.id);
      if (conn.state === NM.ActiveConnectionState.ACTIVATED &&
         (handledTypes.includes(conn.type) || whiteList.includes(conn.id))) {
        debugLog(`VPN Connection detected: ${conn.id}`);
        this._vpnConnectionOn = true;
        this._vpnConnectionName = conn.id;
      } else {
        debugLog(`Non-VPN connection: ${conn.id}`);
      }
    });
    this._settings.set_strv('current-connection-ids', activeConnectionIds);
    if (activeConnections.length < 1) {
      this._setIpDetails();
      return;
    }
    const apiService = this._settings.get_enum('api-service');
    this._currentApiService = apiService;
    if (apiService === API_SERVICES.CUSTOM) {
      const customUrl = this._settings.get_string('custom-api-url');
      if (!customUrl || customUrl.length === 0) {
        debugLog("Custom API selected but no URL provided. Falling back to ipinfo.io");
        this._currentApiService = API_SERVICES.IPINFO_IO;
      } else {
        try {
          const uri = Soup.URI.new_from_string(customUrl);
          const message = new Soup.Message({ method: 'GET', uri: uri });
          message.request_headers.append('Accept', 'application/json');
          message.request_headers.append('User-Agent', 'GNOME-IP-Finder/1.0');
          const response = await this._session.send_and_read_async(message, null);
          const dataStr = new TextDecoder().decode(response.get_data());
          let data = JSON.parse(dataStr);
          debugLog("Custom API returned: " + JSON.stringify(data));
          this._setIpDetails(data);
        } catch (error) {
          debugLog("Custom API error: " + error.message);
          this._setIpDetails(null, error.message);
        }
        return;
      }
    }
    const { data, error } = await Utils.getIPDetails(this._session, {}, this._currentApiService);
    debugLog(`API response: ${JSON.stringify(data)}`);
    this._setIpDetails(data, error);
  }

  _setIpDetails(data, error) {
    this._ipInfoBox.get_children().forEach(child => child.destroy());
    this._mapTileBox.get_children().forEach(child => child.destroy());
    if (!data) {
      this._ipAddressLabel.style_class = 'system-status-icon';
      this._ipAddressLabel.text = error ? _('Error!') : _('No Connection');
      this._statusIcon.show();
      this._statusIcon.icon_name = 'network-offline-symbolic';
      const ipInfoRow = new St.BoxLayout();
      this._ipInfoBox.add_child(ipInfoRow);
      const label = new St.Label({
        style_class: 'ip-info-key',
        text: error ? `${error}` : _('No Connection'),
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true
      });
      ipInfoRow.add_child(label);
      this._mapTileBox.add_child(this._getMapTileIcon(this._defaultMapTile));
      return;
    }
    this._statusIcon.hide();
    if (!data['loc'] && data['lat'] && data['lon']) {
      data['loc'] = `${data['lat']}, ${data['lon']}`;
    }
    this._ipAddress = data.ip || data.query || _('Unavailable');
    this._ipAddressLabel.text = this._ipAddress;
    const panelActors = this._settings.get_enum('actors-in-panel');
    if (panelActors === PanelActors.FLAG_IP || panelActors === PanelActors.FLAG)
      this._flagIcon.show();
    this._flagIcon.text = getFlagEmoji(data.countryCode || data.country);
    this._vpnInfoBox.setVpnStatus({
      vpnOn: this._vpnConnectionOn,
      iconPath: this._vpnConnectionOn ? 'changes-prevent-symbolic' : 'changes-allow-symbolic',
      vpnName: this._vpnConnectionName || _('On'),
      styleClass: this._vpnConnectionOn ? 'ip-info-vpn-on' : 'ip-info-vpn-off'
    });
    this._updatePanelWidgets();
    this._updateVPNWidgets();
    debugLog(`Received IP Data: ${JSON.stringify(data)}`);
    let displayKeys;
    if (this._currentApiService === API_SERVICES.IPINFO_IO) {
      displayKeys = [
        { key: 'ip', label: _('IP Address') },
        { key: 'hostname', label: _('Hostname') },
        { key: 'org', label: _('Organization') },
        { key: 'city', label: _('City') },
        { key: 'region', label: _('Region') },
        { key: 'country', label: _('Country') },
        { key: 'loc', label: _('Location') },
        { key: 'postal', label: _('Postal') },
        { key: 'timezone', label: _('Timezone') },
      ];
    } else {
      displayKeys = [
        { key: 'query', label: _('IP Address') },
        { key: 'country', label: _('Country') },
        { key: 'regionName', label: _('Region') },
        { key: 'city', label: _('City') },
        { key: 'zip', label: _('Postal') },
        { key: 'lat', label: _('Latitude') },
        { key: 'lon', label: _('Longitude') },
        { key: 'timezone', label: _('Timezone') },
        { key: 'isp', label: _('ISP') },
        { key: 'org', label: _('Organization') },
        { key: 'as', label: _('AS') },
      ];
    }
    displayKeys.forEach(item => {
      if (data[item.key]) {
        const row = new St.BoxLayout();
        this._ipInfoBox.add_child(row);
        const label = new St.Label({
          style_class: 'ip-info-key',
          text: `${item.label}: `,
          x_align: Clutter.ActorAlign.FILL,
          y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(label);
        const valueLabel = new St.Label({
          style_class: 'ip-info-value',
          text: data[item.key].toString(),
          x_align: Clutter.ActorAlign.FILL,
          y_align: Clutter.ActorAlign.CENTER,
          x_expand: true,
        });
        const btn = new St.Button({ child: valueLabel });
        btn.connect('button-press-event', () => {
          this._setClipboardText(valueLabel.text);
        });
        row.add_child(btn);
      }
    });
    if (data.privacy) {
      const vpnRow = new St.BoxLayout();
      this._ipInfoBox.add_child(vpnRow);
      const privacyLabel = new St.Label({
        style_class: 'ip-info-key',
        text: _('Proxy/VPN: '),
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
      });
      vpnRow.add_child(privacyLabel);
      const vpnInfoText = [];
      vpnInfoText.push(`${_('VPN')}: ${data.privacy.vpn ? _('Yes') : _('No')}`);
      vpnInfoText.push(`${_('Proxy')}: ${data.privacy.proxy ? _('Yes') : _('No')}`);
      vpnInfoText.push(`${_('Tor')}: ${data.privacy.tor ? _('Yes') : _('No')}`);
      vpnInfoText.push(`${_('Hosting')}: ${data.privacy.hosting ? _('Yes') : _('No')}`);
      const privacyValueLabel = new St.Label({
        style_class: 'ip-info-value',
        text: vpnInfoText.join(' | '),
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      const privacyBtn = new St.Button({ child: privacyValueLabel });
      privacyBtn.connect('button-press-event', () => {
        this._setClipboardText(privacyValueLabel.text);
      });
      vpnRow.add_child(privacyBtn);
    }
    this._ipInfoBox.add_child(new PopupMenu.PopupSeparatorMenuItem());
    const location = data['loc'];
    this._setMapTile(location).catch(e => debugLog(e));
  }

  async _setMapTile(location) {
    const zoom = this._settings.get_int('tile-zoom');
    const mapTileInfo = Utils.getMapTileInfo(location, zoom);
    const mapTileCoordinates = `${mapTileInfo.xTile},${mapTileInfo.yTile}`;
    const mapTileUrl = `${mapTileInfo.zoom}/${mapTileInfo.xTile}/${mapTileInfo.yTile}`;
    if (mapTileCoordinates !== this._settings.get_string('map-tile-coords') ||
        !this._checkLatestFileMapExists()) {
      this._mapTileBox.add_child(this._getMapTileIcon(this._defaultMapTile));
      const mapLabel = new St.Label({
        style_class: 'ip-info-key',
        text: _('Loading new map tile...'),
        x_align: Clutter.ActorAlign.CENTER,
      });
      this._mapTileBox.add_child(mapLabel);
      const { file, error } = await Utils.getMapTile(this._session, this._extension.soupParams, this._extension.path, mapTileUrl);
      if (error) {
        mapLabel.text = _(`Error getting map tile: ${error}`);
      } else {
        this._settings.set_string('map-tile-coords', mapTileCoordinates);
        this._mapTileBox.get_children().forEach(child => child.destroy());
        this._mapTileBox.add_child(this._textureCache.load_file_async(file, -1, 200, 1, 1));
      }
    } else {
      this._mapTileBox.add_child(this._getMapTileIcon(this._latestMapTile));
    }
  }

  _checkLatestFileMapExists() {
    const file = Gio.File.new_for_path(this._latestMapTile);
    return file.query_exists(null);
  }

  _getMapTileIcon(mapTile) {
    if (mapTile === this._defaultMapTile)
      return new St.Icon({ gicon: Gio.icon_new_for_string(mapTile), icon_size: 200 });
    else
      return this._textureCache.load_file_async(Gio.File.new_for_path(this._latestMapTile), -1, 200, 1, 1);
  }

  destroy() {
    if (this._refreshTimeout) {
      GLib.Source.remove(this._refreshTimeout);
      this._refreshTimeout = null;
    }
    if (this._getIpInfoId) {
      GLib.source_remove(this._getIpInfoId);
      this._getIpInfoId = null;
    }
    super.destroy();
  }
});

// -----------------------------------------------------------------------------
// Fallback Implementation for GNOME <45 using Lang.Class
var IPFinderIndicator =
