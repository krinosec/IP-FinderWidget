/* extension.js – Revised Enhanced Version */
/* eslint-disable jsdoc/require-jsdoc */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Mtk from 'gi://Mtk';
import NM from 'gi://NM';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import { loadInterfaceXML } from 'resource:///org/gnome/shell/misc/fileUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Utils from './utils.js';
const { getFlagEmoji, ApiService } = Utils;

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Enable debug logging.
const DEBUG_LOG = true;
function debugLog(msg) {
  if (!DEBUG_LOG) return;
  // Using the built-in log for GNOME extensions.
  log(`[IP-Finder] ${msg}`);
}

// Load Portal Helper interface for connectivity checks.
const PortalHelperIface = loadInterfaceXML('org.gnome.Shell.PortalHelper');
const PortalHelperInfo = Gio.DBusInterfaceInfo.new_for_xml(PortalHelperIface);

const PortalHelperResult = {
  CANCELLED: 0,
  COMPLETED: 1,
  RECHECK: 2,
};

const VpnWidgets = {
  ALL: 0,
  ICON_ONLY: 1,
  TEXT_ONLY: 2,
};

const PanelActors = {
  FLAG_IP: 0,
  FLAG: 1,
  IP: 2,
};

// Constant for custom API (must match preference value)
const CUSTOM_API = 2;

var VpnInfoBox = GObject.registerClass(
  class IPFinderVpnInfoBox extends St.BoxLayout {
    _init(params) {
      super._init({ ...params });
      this._vpnTitleLabel = new St.Label({
        style_class: 'ip-info-vpn-off',
        text: `${_('VPN')}: `,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
      });
      this.add_child(this._vpnTitleLabel);

      this._vpnStatusLabel = new St.Label({
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
        x_expand: true,
        style_class: 'ip-info-vpn-off',
      });
      this.add_child(this._vpnStatusLabel);

      this._vpnIcon = new St.Icon({
        style_class: 'popup-menu-icon ip-info-vpn-off',
      });
      this.add_child(this._vpnIcon);
    }
    setVpnStatus(vpnStatus) {
      this._vpnTitleLabel.set_style_class_name(vpnStatus.styleClass);
      this._vpnStatusLabel.set_style_class_name(vpnStatus.styleClass);
      this._vpnIcon.set_style_class_name(`popup-menu-icon ${vpnStatus.styleClass}`);
      this._vpnStatusLabel.text = vpnStatus.vpnOn ? vpnStatus.vpnName : _('Off');
      this._vpnIcon.gicon = Gio.icon_new_for_string(vpnStatus.iconPath);
    }
  }
);

var BaseButton = GObject.registerClass(
  class IPFinderBaseButton extends St.Button {
    _init(text, params) {
      super._init({
        style_class: 'icon-button',
        reactive: true,
        can_focus: true,
        track_hover: true,
        button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        ...params,
      });
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
      const itemWidth = this.allocation.get_width();
      const labelWidth = this.tooltipLabel.get_width();
      const offset = 6;
      const xOffset = Math.floor((itemWidth - labelWidth) / 2);
      const monitorIndex = Main.layoutManager.findIndexForActor(this);
      const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
      let y;
      const x = Math.clamp(stageX + xOffset, offset, workArea.x + workArea.width - labelWidth - offset);
      const labelBelowIconRect = new Mtk.Rectangle({
        x,
        y: stageY + this.allocation.get_height() + offset,
        width: labelWidth,
        height: this.tooltipLabel.get_height()
      });
      if (workArea.contains_rect(labelBelowIconRect))
        y = labelBelowIconRect.y;
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
  }
);

var IPFinderMenuButton = GObject.registerClass(
  class IPFinderMenuButton extends PanelMenu.Button {
    _init(extension) {
      super._init(0.5, _('IP Details'));
      this.menu.box.style = 'padding: 16px;';

      // Default IP data.
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

      this._extension = extension;
      this._settings = extension.getSettings();
      this._createSettingsConnections();
      this._textureCache = St.TextureCache.get_default();

      const SESSION_TYPE = GLib.getenv('XDG_SESSION_TYPE');
      const PACKAGE_VERSION = Config.PACKAGE_VERSION;
      const USER_AGENT = `Mozilla/5.0 (${SESSION_TYPE}; GNOME Shell/${PACKAGE_VERSION}; Linux ${GLib.getenv('CPU')};) IP_Finder/${this._extension.metadata.version}`;
      this._session = new Soup.Session({ user_agent: USER_AGENT, timeout: 60 });
      this._defaultMapTile = `${this._extension.path}/icons/default_map.png`;
      this._latestMapTile = `${this._extension.path}/icons/latest_map.png`;

      // Build panel UI.
      const panelBox = new St.BoxLayout({
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        style_class: 'panel-status-menu-box'
      });
      this.add_child(panelBox);

      this._vpnStatusIcon = new St.Icon({
        icon_name: 'changes-prevent-symbolic',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'system-status-icon'
      });
      panelBox.add_child(this._vpnStatusIcon);

      this._ipAddress = this._defaultIpData.ip.text;
      this._ipAddressLabel = new St.Label({
        text: this._ipAddress,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'system-status-icon'
      });
      panelBox.add_child(this._ipAddressLabel);

      this._statusIcon = new St.Icon({
        icon_name: 'network-wired-acquiring-symbolic',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'system-status-icon'
      });
      panelBox.add_child(this._statusIcon);

      this._flagIcon = new St.Label({
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'system-status-icon',
        visible: false
      });
      panelBox.add_child(this._flagIcon);

      // Build the menu section.
      const menuSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(menuSection);

      const mapAndIpDetailsBox = new St.BoxLayout({
        x_align: Clutter.ActorAlign.FILL,
        x_expand: true,
        style: 'min-width:540px; padding-bottom: 10px;'
      });
      menuSection.actor.add_child(mapAndIpDetailsBox);

      this._mapTileBox = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        y_expand: true
      });
      mapAndIpDetailsBox.add_child(this._mapTileBox);
      this._mapTileBox.add_child(this._getMapTileIcon(this._defaultMapTile));

      const ipInfoParentBox = new St.BoxLayout({
        style_class: 'ip-info-box',
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER
      });
      mapAndIpDetailsBox.add_child(ipInfoParentBox);

      this._vpnInfoBox = new VpnInfoBox();
      ipInfoParentBox.add_child(this._vpnInfoBox);

      this._ipInfoBox = new St.BoxLayout({ vertical: true });
      ipInfoParentBox.add_child(this._ipInfoBox);

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
        this._setClipboardText(this._ipAddress);
      });
      buttonBox.add_child(copyButton);

      const refreshButton = new BaseButton(_('Refresh'), { icon_name: 'view-refresh-symbolic', x_expand: false, x_align: Clutter.ActorAlign.END });
      refreshButton.connect('clicked', () => this._startGetIpInfo());
      buttonBox.add_child(refreshButton);

      NM.Client.new_async(null, this.establishNetworkConnectivity.bind(this));

      Main.panel.addToStatusArea('ip-menu', this, 1, this._settings.get_string('position-in-panel'));
      this._updatePanelWidgets();
      this._updateVPNWidgets();
    }

    _setClipboardText(text) {
      const clipboard = St.Clipboard.get_default();
      clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

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

    _updatePosition() {
      Main.panel.statusArea['ip-menu'] = null;
      Main.panel.addToStatusArea('ip-menu', this, 1, this._settings.get_string('position-in-panel'));
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

    _updateVPNWidgets() {
      const showWhenActiveVpn = this._settings.get_boolean('vpn-status-only-when-on') ? this._vpnConnectionOn : true;
      const showVpnStatus = this._settings.get_boolean('vpn-status') && showWhenActiveVpn;
      const vpnWidgets = this._settings.get_enum('vpn-widgets');
      this._vpnStatusIcon.visible = showVpnStatus && vpnWidgets !== VpnWidgets.TEXT_ONLY;
      this._vpnInfoBox.visible = showVpnStatus && vpnWidgets !== VpnWidgets.ICON_ONLY;
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

    _setPanelWidgetsPadding() {
      const iconShown = this._flagIcon.visible || this._statusIcon.visible;
      const ipLabelShown = this._ipAddressLabel.visible;
      const vpnIconShown = this._vpnStatusIcon.visible;
      let style = '';
      if (iconShown && ipLabelShown && vpnIconShown)
        style = 'padding-left: 0px; padding-right: 0px;';
      else if (iconShown && ipLabelShown && !vpnIconShown)
        style = 'padding-right: 0px;';
      else if (!iconShown && ipLabelShown && vpnIconShown)
        style = 'padding-left: 0px;';
      else if (!iconShown && ipLabelShown && !vpnIconShown)
        style = '';
      this._ipAddressLabel.style = style;
    }

    establishNetworkConnectivity(obj, result) {
      this._client = NM.Client.new_finish(result);
      this._connectivityQueue = new Set();
      this._mainConnection = null;
      this._client.connectObject(
        'notify::primary-connection', () => this._syncMainConnection(),
        'notify::activating-connection', () => this._syncMainConnection(),
        'notify::active-connections', () => this._syncMainConnection(),
        'notify::connectivity', () => this._syncConnectivity(),
        this
      );
      this._syncMainConnection();
    }

    _syncMainConnection() {
      this._setAcquiringDetails();
      if (this._mainConnection) {
        this._mainConnection.disconnectObject(this);
      }
      this._mainConnection = this._client.get_primary_connection() || this._client.get_activating_connection();
      if (this._mainConnection) {
        this._mainConnection.connectObject('notify::state', this._mainConnectionStateChanged.bind(this), this);
        this._mainConnectionStateChanged();
      }
      this._syncConnectivity();
    }

    _mainConnectionStateChanged() {
      if (this._mainConnection.state === NM.ActiveConnectionState.ACTIVATED)
        this._startGetIpInfo();
    }

    _startGetIpInfo() {
      this._session.abort();
      this._removeGetIpInfoId();
      this._setAcquiringDetails();
      this._getIpInfoId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        this._getIpInfo().catch(err => debugLog(err));
        this._getIpInfoId = null;
        return GLib.SOURCE_REMOVE;
      });
    }

    _removeGetIpInfoId() {
      if (this._getIpInfoId) {
        GLib.source_remove(this._getIpInfoId);
        this._getIpInfoId = null;
      }
    }

    _flushConnectivityQueue() {
      for (const item of this._connectivityQueue)
        this._portalHelperProxy?.CloseAsync(item);
      this._connectivityQueue.clear();
    }

    _closeConnectivityCheck(path) {
      if (this._connectivityQueue.delete(path))
        this._portalHelperProxy?.CloseAsync(path);
    }

    async _portalHelperDone(proxy, emitter, parameters) {
      const args = parameters.deep_unpack ? parameters.deep_unpack() : parameters;
      const [path, result] = args;
      if (result === PortalHelperResult.CANCELLED) {
        this._setIpDetails();
      } else if (result === PortalHelperResult.COMPLETED) {
        this._startGetIpInfo();
        this._closeConnectivityCheck(path);
      } else if (result === PortalHelperResult.RECHECK) {
        this._setIpDetails();
        try {
          const state = await this._client.check_connectivity_async(null);
          if (state >= NM.ConnectivityState.FULL) {
            this._startGetIpInfo();
            this._closeConnectivityCheck(path);
          }
        } catch (e) {
          debugLog(e);
        }
      } else {
        this._setIpDetails(null, `Invalid result from portal helper: ${result}`);
      }
    }

    async _syncConnectivity() {
      if (this._client.get_active_connections().length < 1 || this._client.connectivity === NM.ConnectivityState.NONE) {
        this._setIpDetails();
      }
      if (!this._mainConnection || this._mainConnection.state !== NM.ActiveConnectionState.ACTIVATED) {
        this._setIpDetails();
        this._flushConnectivityQueue();
        return;
      }
      let isPortal = this._client.connectivity === NM.ConnectivityState.PORTAL;
      if (GLib.getenv('GNOME_SHELL_CONNECTIVITY_TEST') != null)
        isPortal ||= this._client.connectivity < NM.ConnectivityState.FULL;
      if (!isPortal)
        return;
      const path = this._mainConnection.get_path();
      if (this._connectivityQueue.has(path)) return;
      const timestamp = global.get_current_time();
      if (!this._portalHelperProxy) {
        this._portalHelperProxy = new Gio.DBusProxy({
          g_connection: Gio.DBus.session,
          g_name: 'org.gnome.Shell.PortalHelper',
          g_object_path: '/org/gnome/Shell/PortalHelper',
          g_interface_name: PortalHelperInfo.name,
          g_interface_info: PortalHelperInfo,
        });
        this._portalHelperProxy.connectSignal(
          'Done',
          (proxy, sender, parameters) =>
            this._portalHelperDone(proxy, sender, parameters).catch(console.error)
        );
        try {
          await this._portalHelperProxy.init_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
          debugLog(`Error launching the portal helper: ${e.message}`);
        }
      }
      this._portalHelperProxy?.AuthenticateAsync(path, this._client.connectivity_check_uri, timestamp)
        .catch(console.error);
      this._connectivityQueue.add(path);
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

      debugLog('IP-Finder Log: Active Connections --------------------------');
      activeConnections.forEach(a => {
        activeConnectionIds.push(a.id);
        if (a.state === NM.ActiveConnectionState.ACTIVATED &&
            (handledTypes.includes(a.type) || whiteList.includes(a.id))) {
          debugLog(`VPN Connection: '${a.id}', Type: '${a.type}'`);
          this._vpnConnectionOn = true;
          this._vpnConnectionName = a.id;
        } else {
          debugLog(`Connection: '${a.id}', Type: '${a.type}'`);
        }
      });
      debugLog('------------------------------------------------------------');
      this._settings.set_strv('current-connection-ids', activeConnectionIds);
      if (activeConnections.length < 1) {
        this._setIpDetails();
        return;
      }
      const apiService = this._settings.get_enum('api-service');
      this._currentApiService = apiService;
      if (apiService === CUSTOM_API) {
        const customUrl = this._settings.get_string('custom-api-url');
        if (!customUrl || customUrl.length === 0) {
          debugLog("Custom API selected but no URL provided. Falling back to ipinfo.io");
          this._currentApiService = ApiService.IP_INFO_IO;
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
      debugLog(`Received API response: ${JSON.stringify(data)}`);
      this._setIpDetails(data, error);
    }

    _setAcquiringDetails() {
      this._flagIcon.hide();
      this._statusIcon.show();
      this._ipAddressLabel.text = _(this._defaultIpData.ip.text);
      this._ipAddressLabel.style_class = 'system-status-icon';
      this._statusIcon.icon_name = 'network-wired-acquiring-symbolic';
      this._vpnStatusIcon.style_class = 'system-status-icon';
      this._vpnStatusIcon.hide();
      this._vpnInfoBox.hide();
    }

    _setIpDetails(data, error) {
      // Clear previous children
      this._ipInfoBox.get_children().forEach(child => child.destroy());
      this._mapTileBox.get_children().forEach(child => child.destroy());
      if (!data) {
        this._ipAddressLabel.style_class = 'system-status-icon';
        this._ipAddressLabel.text = error ? _('Error!') : _('No Connection');
        this._statusIcon.show();
        this._statusIcon.icon_name = 'network-offline-symbolic';
        this._vpnStatusIcon.style_class = 'system-status-icon';
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
        vpnName: this._vpnConnectionName ? this._vpnConnectionName : _('On'),
        styleClass: this._vpnConnectionOn ? 'ip-info-vpn-on' : 'ip-info-vpn-off'
      });
      this._updatePanelWidgets();
      this._updateVPNWidgets();

      debugLog(`Received IP Data: ${JSON.stringify(data)}`);

      let displayKeys;
      if (this._currentApiService === ApiService.IP_INFO_IO) {
        displayKeys = [
          { key: 'ip', label: _('IP Address') },
          { key: 'hostname', label: _('Hostname') },
          { key: 'org', label: _('Organization') },
          { key: 'city', label: _('City') },
          { key: 'region', label: _('Region') },
          { key: 'country', label: _('Country') },
          { key: 'loc', label: _('Location') },
          { key: 'postal', label: _('Postal') },
          { key: 'timezone', label: _('Timezone') }
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
          { key: 'as', label: _('AS') }
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
            y_align: Clutter.ActorAlign.CENTER
          });
          row.add_child(label);
          const valueLabel = new St.Label({
            style_class: 'ip-info-value',
            text: data[item.key].toString(),
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true
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
          y_align: Clutter.ActorAlign.CENTER
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
          x_expand: true
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
          x_align: Clutter.ActorAlign.CENTER
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
        return;
      }
      this._mapTileBox.add_child(this._getMapTileIcon(this._latestMapTile));
    }

    _getMapTileIcon(mapTile) {
      if (mapTile === this._defaultMapTile)
        return new St.Icon({ gicon: Gio.icon_new_for_string(mapTile), icon_size: 200 });
      else
        return this._textureCache.load_file_async(Gio.File.new_for_path(this._latestMapTile), -1, 200, 1, 1);
    }

    _checkLatestFileMapExists() {
      const file = Gio.File.new_for_path(this._latestMapTile);
      return file.query_exists(null);
    }

    disable() {
      this._removeGetIpInfoId();
      this._client?.disconnectObject(this);
      this._settings.disconnectObject(this);
      this._settings = null;
    }
  }
);

export default class IpFinder extends Extension {
  enable() {
    this.soupParams = { id: `ip-finder/v${this.metadata.version}` };
    this._menuButton = new IPFinderMenuButton(this);
  }
  disable() {
    this.soupParams = null;
    if (this._menuButton) {
      this._menuButton.disable();
      this._menuButton.destroy();
      this._menuButton = null;
    }
  }
}
