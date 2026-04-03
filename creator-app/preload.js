const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  onRelayLog: function(cb) { ipcRenderer.on('relay-log', function(e, data) { cb(data.tabId, data.msg); }); },
  getHookCode: function(tabId, url) { return ipcRenderer.invoke('get-hook-code', tabId, url); },
  setTunnelMode: function(tabId, mode) { return ipcRenderer.invoke('set-tunnel-mode', tabId, mode); },
  startRelay: function(tabId) { return ipcRenderer.invoke('start-relay', tabId); },
  closeTab: function(tabId) { return ipcRenderer.invoke('close-tab', tabId); },
  startBot: function(settings) { return ipcRenderer.invoke('start-bot', settings); },
  stopBot: function() { return ipcRenderer.invoke('stop-bot'); },
  onCreateBotTab: function(cb) { ipcRenderer.on('create-bot-tab', function(e, data) { cb(data); }); },
  getCallCreatorCode: function(scriptFile) { return ipcRenderer.invoke('get-call-creator-code', scriptFile); },
  onBotError: function(cb) { ipcRenderer.on('bot-error', function(e, msg) { cb(msg); }); },
  getCookies: function(domain) { return ipcRenderer.invoke('get-cookies', domain); },
  startHeadless: function(tabId) { return ipcRenderer.invoke('start-headless', tabId); },
  onCloseBotTab: function(cb) { ipcRenderer.on('close-bot-tab', function(e, data) { cb(data); }); },
  setAutoclickEnabled: function(enabled) { ipcRenderer.send('set-autoclick-enabled', enabled); },
  onApiCreateTab: function(cb) { ipcRenderer.on('api-create-tab', function(e, data) { cb(data); }); },
  onApiCloseTab: function(cb) { ipcRenderer.on('api-close-tab', function(e, data) { cb(data); }); },
  setApiSettings: function(enabled, port, secret, useSecret) { ipcRenderer.send('set-api-settings', enabled, port, secret, useSecret); },
  getCookies: function(domain) { return ipcRenderer.invoke('get-cookies', domain); },
  onCloseBotTab: function(cb) { ipcRenderer.on('close-bot-tab', function(e, data) { cb(data); }); },
  triggerCreateCall: function(tabId) { ipcRenderer.send('trigger-create-call', tabId); },
  expectWebview: function(tabId) { ipcRenderer.send('expect-webview', tabId); },
  onCallLinkCaptured: function(tabId, link) { ipcRenderer.send('call-link-captured', tabId, link); },
  getEnvVars: function() { return ipcRenderer.invoke('get-env-vars'); }
});
