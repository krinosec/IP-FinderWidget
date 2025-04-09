/* prefs.js – Revised */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import * as Config from 'resource:///org/gnome/Shell/Extensions/js/misc/config.js';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Helper: create an Adw.ActionRow with a title and a suffix widget.
function createActionRow(title, suffixWidget) {
  const row = new Adw.ActionRow({ title, activatable_widget: suffixWidget });
  row.add_suffix(suffixWidget);
  return row;
}

var GeneralPage = GObject.registerClass(
class IPFinderGeneralPage extends Adw.PreferencesPage {
  _init(settings) {
    super._init({
      title: _('General'),
      icon_name: 'preferences-system-symbolic',
      name: 'GeneralPage'
    });
    this._settings = settings;

    // ----- General Group -----
    const generalGroup = new Adw.PreferencesGroup({ title: _('General') });
    this.add(generalGroup);

    // "Actors in Panel" dropdown
    const actorsInPanelList = new Gtk.StringList();
    actorsInPanelList.append(_('IP Address and Flag'));
    actorsInPanelList.append(_('Flag'));
    actorsInPanelList.append(_('IP Address'));
    const actorsInPanelMenu = new Gtk.DropDown({
      valign: Gtk.Align.CENTER,
      model: actorsInPanelList,
      selected: this._settings.get_enum('actors-in-panel')
    });
    const actorsInPanelRow = createActionRow(_('Elements to show on the Panel'), actorsInPanelMenu);
    actorsInPanelMenu.connect('notify::selected', widget => {
      let newVal = widget.selected;
      if (newVal !== null && newVal !== this._settings.get_enum('actors-in-panel')) {
        this._settings.set_enum('actors-in-panel', newVal);
      }
    });
    generalGroup.add(actorsInPanelRow);

    // Panel position (Left/Center/Right)
    const panelPositions = new Gtk.StringList();
    panelPositions.append(_('Left'));
    panelPositions.append(_('Center'));
    panelPositions.append(_('Right'));
    const panelPositionRow = new Adw.ComboRow({
      title: _('Position in Panel'),
      model: panelPositions,
      selected: this._settings.get_enum('position-in-panel')
    });
    panelPositionRow.connect('notify::selected', widget => {
      let newVal = widget.selected;
      if (newVal !== null && newVal !== this._settings.get_enum('position-in-panel')) {
        this._settings.set_enum('position-in-panel', newVal);
      }
    });
    generalGroup.add(panelPositionRow);

    // Map Tile Zoom Factor
    const tileZoomSpinButton = new Gtk.SpinButton({
      adjustment: new Gtk.Adjustment({ lower: 7, upper: 13, step_increment: 1 }),
      climb_rate: 1,
      digits: 0,
      numeric: true,
      valign: Gtk.Align.CENTER,
      value: this._settings.get_int('tile-zoom')
    });
    tileZoomSpinButton.connect('notify::value', widget => {
      let newValue = widget.get_value();
      if (newValue !== this._settings.get_int('tile-zoom')) {
        this._settings.set_int('tile-zoom', newValue);
      }
    });
    const tileZoomRow = createActionRow(_('Map Tile Zoom Factor'), tileZoomSpinButton);
    generalGroup.add(tileZoomRow);

    // API Service selection (including "Custom")
    // (Assume: 0 = ipinfo.io, 1 = ip-api.com, 2 = Custom)
    const apiList = new Gtk.StringList();
    apiList.append(_('ipinfo.io'));
    apiList.append(_('ip-api.com'));
    apiList.append(_('Custom'));
    const apiMenu = new Gtk.DropDown({
      valign: Gtk.Align.CENTER,
      model: apiList,
      selected: this._settings.get_enum('api-service')
    });
    const apiRow = createActionRow(_('API Service'), apiMenu);
    apiMenu.connect('notify::selected', widget => {
      let newVal = widget.selected;
      if (newVal !== null && newVal !== this._settings.get_enum('api-service')) {
        this._settings.set_enum('api-service', newVal);
        // Update the custom API row visibility.
        this._customApiRow.set_sensitive(newVal === 2);
        this._customApiRow.visible = (newVal === 2);
      }
    });
    generalGroup.add(apiRow);

    // Custom API URL row (shown only when "Custom" is selected)
    this._customApiEntry = new Gtk.Entry({
      placeholder_text: _('Enter custom API URL'),
      text: this._settings.get_string('custom-api-url'),
      valign: Gtk.Align.CENTER
    });
    this._customApiEntry.connect('notify::text', widget => {
      let newText = widget.get_text();
      if (newText !== this._settings.get_string('custom-api-url')) {
        this._settings.set_string('custom-api-url', newText);
      }
    });
    this._customApiRow = createActionRow(_('Custom API URL'), this._customApiEntry);
    const currentApiService = this._settings.get_enum('api-service');
    this._customApiRow.visible = (currentApiService === 2);
    this._customApiRow.set_sensitive(currentApiService === 2);
    generalGroup.add(this._customApiRow);

    // ----- VPN Status Group -----
    const vpnGroup = new Adw.PreferencesGroup({ title: _('VPN Status') });
    this.add(vpnGroup);
    const showVPNStatusRow = new Adw.ExpanderRow({
      title: _('Show VPN Status'),
      subtitle: _('Attempts to display VPN status. Works best when connecting VPN through GNOME'),
      show_enable_switch: true,
      enable_expansion: this._settings.get_boolean('vpn-status')
    });
    vpnGroup.add(showVPNStatusRow);
    showVPNStatusRow.connect('notify::enable-expansion', widget => {
      this._settings.set_boolean('vpn-status', widget.enable_expansion);
    });

    // VPN Widgets Options
    const vpnWidgetsList = new Gtk.StringList();
    vpnWidgetsList.append(_('Icon on Panel + Text in Menu'));
    vpnWidgetsList.append(_('Icon on Panel'));
    vpnWidgetsList.append(_('Text in Menu'));
    const vpnWidgetsMenu = new Gtk.DropDown({
      valign: Gtk.Align.CENTER,
      model: vpnWidgetsList,
      selected: this._settings.get_enum('vpn-widgets')
    });
    const vpnWidgetsRow = createActionRow(_('VPN status display options'), vpnWidgetsMenu);
    vpnWidgetsMenu.connect('notify::selected', widget => {
      let newVal = widget.selected;
      if (newVal !== null && newVal !== this._settings.get_enum('vpn-widgets')) {
        this._settings.set_enum('vpn-widgets', newVal);
      }
    });
    showVPNStatusRow.add_row(vpnWidgetsRow);

    // Show VPN Only When Detected switch
    const showVPNOnlyWhenOnSwitch = new Gtk.Switch({
      active: this._settings.get_boolean('vpn-status-only-when-on'),
      valign: Gtk.Align.CENTER
    });
    showVPNOnlyWhenOnSwitch.connect('notify::active', widget => {
      this._settings.set_boolean('vpn-status-only-when-on', widget.get_active());
    });
    const showVPNOnlyWhenOnRow = createActionRow(_('Only show VPN status when VPN detected'), showVPNOnlyWhenOnSwitch);
    showVPNStatusRow.add_row(showVPNOnlyWhenOnRow);

    // Colorize VPN Icon switch
    const vpnIconColorSwitch = new Gtk.Switch({
      active: this._settings.get_boolean('vpn-icon-color'),
      valign: Gtk.Align.CENTER
    });
    vpnIconColorSwitch.connect('notify::active', widget => {
      this._settings.set_boolean('vpn-icon-color', widget.get_active());
    });
    const vpnIconColorRow = createActionRow(_('Colorize VPN Icon based on VPN status'), vpnIconColorSwitch);
    showVPNStatusRow.add_row(vpnIconColorRow);

    // Colorize IP Address based on VPN status switch
    const vpnAddressColorSwitch = new Gtk.Switch({
      active: this._settings.get_boolean('vpn-ip-address-color'),
      valign: Gtk.Align.CENTER
    });
    vpnAddressColorSwitch.connect('notify::active', widget => {
      this._settings.set_boolean('vpn-ip-address-color', widget.get_active());
    });
    const vpnAddressColorRow = createActionRow(_('Colorize IP Address based on VPN status'), vpnAddressColorSwitch);
    showVPNStatusRow.add_row(vpnAddressColorRow);

    // ----- VPN Connection Types Group -----
    const restoreVpnTypesButton = new Gtk.Button({
      icon_name: 'view-refresh-symbolic',
      tooltip_text: _('Reset VPN Connection Types'),
      css_classes: ['destructive-action'],
      valign: Gtk.Align.START
    });
    restoreVpnTypesButton.connect('clicked', () => {
      const dialog = new Gtk.MessageDialog({
        text: `<b>${_('Reset VPN Connection Types?')}</b>`,
        secondary_text: _('All VPN Connection Types will be reset to the default value.'),
        use_markup: true,
        buttons: Gtk.ButtonsType.YES_NO,
        message_type: Gtk.MessageType.WARNING,
        transient_for: this.get_root(),
        modal: true
      });
      dialog.connect('response', (widget, response) => {
        if (response === Gtk.ResponseType.YES) {
          for (const row of this._vpnConnectionTypeRows) {
            this.vpnTypesExpanderRow.remove(row);
          }
          this._vpnConnectionTypeRows = [];
          const defaultVpnTypes = this._settings.get_default_value('vpn-connection-types').deep_unpack();
          this._settings.set_strv('vpn-connection-types', defaultVpnTypes);
          for (const type of defaultVpnTypes) {
            this._addVpnConnectionType(type);
          }
        }
        dialog.destroy();
      });
      dialog.show();
    });
    const vpnTypesGroup = new Adw.PreferencesGroup({
      title: _('VPN Connection Types'),
      description: _('Connection types to be recognized as a VPN'),
      header_suffix: restoreVpnTypesButton
    });
    this.add(vpnTypesGroup);
    const addToVpnTypesEntry = new Gtk.Entry({ valign: Gtk.Align.CENTER });
    const addToVpnTypesButton = new Gtk.Button({ label: _('Add'), valign: Gtk.Align.CENTER });
    addToVpnTypesButton.connect('clicked', () => {
      let type = addToVpnTypesEntry.text.trim();
      if (!type || type.length === 0) return;
      let currentTypes = this._settings.get_strv('vpn-connection-types');
      if (currentTypes.includes(type)) return;
      this.vpnTypesExpanderRow.expanded = true;
      this._addVpnConnectionType(type);
      currentTypes.push(type);
      this._settings.set_strv('vpn-connection-types', currentTypes);
      addToVpnTypesEntry.set_text('');
    });
    const addToVpnTypesRow = new Adw.ActionRow({ title: _('Add new VPN Connection Type') });
    addToVpnTypesRow.add_suffix(addToVpnTypesEntry);
    addToVpnTypesRow.add_suffix(addToVpnTypesButton);
    vpnTypesGroup.add(addToVpnTypesRow);
    this.vpnTypesExpanderRow = new Adw.ExpanderRow({ title: _('VPN Connection Types') });
    vpnTypesGroup.add(this.vpnTypesExpanderRow);
    this._vpnConnectionTypeRows = [];
    const vpnConnectionTypes = this._settings.get_strv('vpn-connection-types');
    for (const type of vpnConnectionTypes) {
      this._addVpnConnectionType(type);
    }

    // ----- Whitelisted Connections Group -----
    const whiteListGroup = new Adw.PreferencesGroup({
      title: _('Whitelisted Connections'),
      description: _('Force a connection to be recognized as a VPN')
    });
    this.add(whiteListGroup);
    this.currentConnectionsMenu = new Gtk.DropDown({ valign: Gtk.Align.CENTER, halign: Gtk.Align.FILL });
    this._settings.connect('changed::current-connection-ids', () => {
      this._populateCurrentConnectionsMenu();
    });
    this._populateCurrentConnectionsMenu();
    const addToWhiteListButton = new Gtk.Button({ label: _('Add'), valign: Gtk.Align.CENTER });
    addToWhiteListButton.connect('clicked', () => {
      this.whiteListExpanderRow.expanded = true;
      const selectedItem = this.currentConnectionsMenu.get_selected_item();
      if (selectedItem) {
        const connectionId = selectedItem.string.trim();
        if (!connectionId) return;
        let whitelist = this._settings.get_strv('vpn-connections-whitelist');
        if (whitelist.includes(connectionId)) return;
        this._addConnectionToWhitelist(connectionId);
        whitelist.push(connectionId);
        this._settings.set_strv('vpn-connections-whitelist', whitelist);
      }
    });
    const addToWhiteListRow = new Adw.ActionRow({
      title: _('Choose a connection to add to VPN Whitelist'),
      activatable_widget: addToWhiteListButton
    });
    addToWhiteListRow.add_suffix(this.currentConnectionsMenu);
    addToWhiteListRow.add_suffix(addToWhiteListButton);
    this.whiteListExpanderRow = new Adw.ExpanderRow({ title: _('Whitelisted VPN Connections') });
    this._whitelistRows = [];
    const whitelist = this._settings.get_strv('vpn-connections-whitelist');
    for (const conn of whitelist) {
      this._addConnectionToWhitelist(conn);
    }
    whiteListGroup.add(addToWhiteListRow);
    whiteListGroup.add(this.whiteListExpanderRow);
  }

  _populateCurrentConnectionsMenu() {
    const currentConnectionsList = new Gtk.StringList();
    const currentConnectionIds = this._settings.get_strv('current-connection-ids');
    for (const id of currentConnectionIds) {
      currentConnectionsList.append(id);
    }
    this.currentConnectionsMenu.model = currentConnectionsList;
  }

  _addConnectionToWhitelist(title) {
    title = title.trim();
    for (const row of this._whitelistRows) {
      if (row.get_title() === title)
        return;
    }
    const deleteButton = new Gtk.Button({ label: _('Delete'), valign: Gtk.Align.CENTER });
    let connectionRow;
    deleteButton.connect('clicked', () => {
      this.whiteListExpanderRow.remove(connectionRow);
      this._whitelistRows = this._whitelistRows.filter(row => row !== connectionRow);
      let whitelist = this._settings.get_strv('vpn-connections-whitelist');
      const index = whitelist.indexOf(title);
      if (index >= 0) {
        whitelist.splice(index, 1);
        this._settings.set_strv('vpn-connections-whitelist', whitelist);
      }
    });
    connectionRow = new Adw.ActionRow({ title, activatable_widget: deleteButton });
    connectionRow.add_suffix(deleteButton);
    this.whiteListExpanderRow.add_row(connectionRow);
    this._whitelistRows.push(connectionRow);
  }

  _addVpnConnectionType(title) {
    title = title.trim();
    for (const row of this._vpnConnectionTypeRows) {
      if (row.get_title() === title)
        return;
    }
    const deleteButton = new Gtk.Button({ label: _('Delete'), valign: Gtk.Align.CENTER });
    let connectionRow;
    deleteButton.connect('clicked', () => {
      this.vpnTypesExpanderRow.remove(connectionRow);
      this._vpnConnectionTypeRows = this._vpnConnectionTypeRows.filter(row => row !== connectionRow);
      let types = this._settings.get_strv('vpn-connection-types');
      const index = types.indexOf(title);
      if (index >= 0) {
        types.splice(index, 1);
        this._settings.set_strv('vpn-connection-types', types);
      }
    });
    connectionRow = new Adw.ActionRow({ title, activatable_widget: deleteButton });
    connectionRow.add_suffix(deleteButton);
    this.vpnTypesExpanderRow.add_row(connectionRow);
    this._vpnConnectionTypeRows.push(connectionRow);
  }

  _showFileChooser(title, params, acceptBtn, acceptHandler) {
    const dialog = new Gtk.FileChooserDialog({
      title: _(title),
      transient_for: this.get_root(),
      modal: true,
      action: params.action
    });
    dialog.add_button(_('_Cancel'), Gtk.ResponseType.CANCEL);
    dialog.add_button(acceptBtn, Gtk.ResponseType.ACCEPT);
    dialog.connect('response', (self, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        try {
          const file = self.get_file();
          const filepath = file.get_path();
          file.load_contents_async(GLib.PRIORITY_DEFAULT, null, (file, res) => {
            try {
              const [ok, data] = file.load_contents_finish(res);
              if (!ok) throw new Error(_('Failed to read file contents.'));
              acceptHandler(filepath, data);
            } catch (e) {
              log(`Error loading settings: ${e.message}`);
            }
          });
        } catch (e) {
          log(`Error in file chooser: ${e.message}`);
        }
      }
      dialog.destroy();
    });
    dialog.show();
  }
}

var AboutPage = GObject.registerClass(
class IpFinderAboutPage extends Adw.PreferencesPage {
  _init(metadata) {
    super._init({
      title: _('About'),
      icon_name: 'help-about-symbolic',
      name: 'AboutPage'
    });
    const PROJECT_TITLE = _('IP Finder');
    const PROJECT_DESCRIPTION = _('Displays useful information about your public IP Address');
    const PROJECT_IMAGE = 'default_map';
    const SCHEMA_PATH = '/org/gnome/shell/extensions/ip-finder/';
    const projectHeaderGroup = new Adw.PreferencesGroup();
    const projectHeaderBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      hexpand: false,
      vexpand: false
    });
    const projectImage = new Gtk.Image({
      margin_bottom: 5,
      icon_name: PROJECT_IMAGE,
      pixel_size: 100
    });
    const projectTitleLabel = new Gtk.Label({
      label: _(PROJECT_TITLE),
      css_classes: ['title-1'],
      vexpand: true,
      valign: Gtk.Align.FILL
    });
    const projectDescriptionLabel = new Gtk.Label({
      label: _(PROJECT_DESCRIPTION),
      hexpand: false,
      vexpand: false
    });
    projectHeaderBox.append(projectImage);
    projectHeaderBox.append(projectTitleLabel);
    projectHeaderBox.append(projectDescriptionLabel);
    projectHeaderGroup.add(projectHeaderBox);
    this.add(projectHeaderGroup);
    const infoGroup = new Adw.PreferencesGroup();
    const projectVersionRow = new Adw.ActionRow({ title: _('IP Finder Version') });
    projectVersionRow.add_suffix(new Gtk.Label({
      label: metadata.version.toString(),
      css_classes: ['dim-label']
    }));
    infoGroup.add(projectVersionRow);
    if (metadata.commit) {
      const commitRow = new Adw.ActionRow({ title: _('Git Commit') });
      commitRow.add_suffix(new Gtk.Label({
        label: metadata.commit.toString(),
        css_classes: ['dim-label']
      }));
      infoGroup.add(commitRow);
    }
    const gnomeVersionRow = new Adw.ActionRow({ title: _('GNOME Version') });
    gnomeVersionRow.add_suffix(new Gtk.Label({
      label: Config.PACKAGE_VERSION.toString(),
      css_classes: ['dim-label']
    }));
    infoGroup.add(gnomeVersionRow);
    const osRow = new Adw.ActionRow({ title: _('OS Name') });
    const name = GLib.get_os_info('NAME');
    const prettyName = GLib.get_os_info('PRETTY_NAME');
    osRow.add_suffix(new Gtk.Label({
      label: prettyName ? prettyName : name,
      css_classes: ['dim-label']
    }));
    infoGroup.add(osRow);
    const sessionTypeRow = new Adw.ActionRow({ title: _('Windowing System') });
    sessionTypeRow.add_suffix(new Gtk.Label({
      label: GLib.getenv('XDG_SESSION_TYPE') === 'wayland' ? 'Wayland' : 'X11',
      css_classes: ['dim-label']
    }));
    infoGroup.add(sessionTypeRow);
    const gitlabRow = this._createLinkRow(_('IP Finder GitLab'), metadata.url);
    infoGroup.add(gitlabRow);
    this.add(infoGroup);
    const settingsGroup = new Adw.PreferencesGroup();
    const settingsRow = new Adw.ActionRow({ title: _('IP Finder Settings') });
    const loadButton = new Gtk.Button({ label: _('Load'), valign: Gtk.Align.CENTER });
    loadButton.connect('clicked', () => {
      this._showFileChooser(
        _('Load Settings'),
        { action: Gtk.FileChooserAction.OPEN },
        _('_Open'),
        (filename, data) => {
          try {
            const settingsFile = Gio.File.new_for_path(filename);
            // Implement loading logic…
          } catch (e) {
            log(`Error loading settings: ${e.message}`);
          }
        }
      );
    });
    const saveButton = new Gtk.Button({ label: _('Save'), valign: Gtk.Align.CENTER });
    saveButton.connect('clicked', () => {
      try {
        this._showFileChooser(
          _('Save Settings'),
          { action: Gtk.FileChooserAction.SAVE },
          _('_Save'),
          (filename) => {
            try {
              const file = Gio.File.new_for_path(filename);
              const [ok, data] = GLib.spawn_command_line_sync(`dconf dump ${SCHEMA_PATH}`);
              if (!ok || !data)
                throw new Error(_('Failed to dump settings from dconf.'));
              const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
              const out = Gio.BufferedOutputStream.new_sized(stream, 4096);
              out.write_all(data, null);
              out.close(null);
            } catch (error) {
              log(`Error saving settings: ${error.message}`);
            }
          }
        );
      } catch (error) {
        log(`Error initiating save: ${error.message}`);
      }
    });
    settingsRow.add_suffix(saveButton);
    settingsRow.add_suffix(loadButton);
    settingsGroup.add(settingsRow);
    this.add(settingsGroup);
    const creditsGroup = new Adw.PreferencesGroup({ title: _('Credits') });
    this.add(creditsGroup);
    const creditsRow = new Adw.PreferencesRow({ activatable: false, selectable: false });
    creditsRow.set_child(new Gtk.Label({
      label: '<a href="https://gitlab.com/LinxGem33">LinxGem33</a> (Founder/Maintainer/Graphic Designer)\n<a href="https://gitlab.com/AndrewZaech">AndrewZaech</a> (Developer)',
      use_markup: true,
      vexpand: true,
      valign: Gtk.Align.CENTER,
      margin_top: 5,
      margin_bottom: 20,
      hexpand: true,
      halign: Gtk.Align.FILL,
      justify: Gtk.Justification.CENTER
    }));
    creditsGroup.add(creditsRow);
    const gnuSoftwareGroup = new Adw.PreferencesGroup();
    const gnuSoftwareLabel = new Gtk.Label({
      label: '<span size="small">This program comes with absolutely no warranty.\nSee the <a href="https://gnu.org/licenses/old-licenses/gpl-2.0.html">GNU General Public License, version 2 or later</a> for details.</span>',
      use_markup: true,
      justify: Gtk.Justification.CENTER
    });
    const gnuSoftwareLabelBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      valign: Gtk.Align.END,
      vexpand: true
    });
    gnuSoftwareLabelBox.append(gnuSoftwareLabel);
    gnuSoftwareGroup.add(gnuSoftwareLabelBox);
    this.add(gnuSoftwareGroup);
  }

  _createLinkRow(title, uri) {
    const image = new Gtk.Image({ icon_name: 'adw-external-link-symbolic', valign: Gtk.Align.CENTER });
    const linkRow = new Adw.ActionRow({ title: _(title), activatable: true });
    linkRow.connect('activated', () => {
      Gtk.show_uri(this.get_root(), uri, Gdk.CURRENT_TIME);
    });
    linkRow.add_suffix(image);
    return linkRow;
  }
});

export default class IpFinderPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const iconPath = `${this.path}/icons`;
    const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    if (!iconTheme.get_search_path().includes(iconPath))
      iconTheme.add_search_path(iconPath);
    const settings = this.getSettings();
    window.set_search_enabled(true);
    window.add(new GeneralPage(settings));
    window.add(new AboutPage(this.metadata));
  }
}
