const { app, BrowserWindow, session, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const TelemostAutoclick = require('./telemost-autoclick');
const VkAutoclick = require('./vk-autoclick');
const BotManager = require('./bot-manager');

var appVersion;
if (app.isPackaged) {
  appVersion = app.getVersion();
} else {
  appVersion = require('./package.json').version;
}
var hooksDir;
if (app.isPackaged) {
  hooksDir = path.join(process.resourcesPath, 'hooks');
} else {
  hooksDir = path.join(__dirname, '..', 'hooks');
}
var relayPath;
if (app.isPackaged) {
  if (process.platform === 'win32') {
    relayPath = path.join(process.resourcesPath, 'relay.exe');
  } else {
    relayPath = path.join(process.resourcesPath, 'relay');
  }
} else {
  if (process.platform === 'win32') {
    relayPath = path.join(__dirname, '..', 'relay', 'relay.exe');
  } else {
    relayPath = path.join(__dirname, '..', 'relay', 'relay');
  }
}
var headlessPath;
if (app.isPackaged) {
  if (process.platform === 'win32') {
    headlessPath = path.join(process.resourcesPath, 'headless-creator.exe');
  } else {
    headlessPath = path.join(process.resourcesPath, 'headless-creator');
  }
} else {
  if (process.platform === 'win32') {
    headlessPath = path.join(__dirname, '..', 'headless', 'headless-creator.exe');
  } else {
    headlessPath = path.join(__dirname, '..', 'headless', 'headless-creator');
  }
}
var logCapture = "...";
var tabs = new Map(); // tabId -> { relay, tunnelMode, platform, dcPort, pionPort, isBot }
var callStatusCache = new Map();
var nextPortBase = 10000;

var callStatusCache = new Map();
var nextPortBase = 10000;
var mainWindow = null;
var botManager = null;
var autoclickEnabled = true;
var autoclickers = new Map();
var tabToWebview = new Map();
var pendingWebviewTabId = null;

function isPortFree(port) {
  return new Promise(function(resolve) {
    var server = require('net').createServer();
    server.once('error', function() { resolve(false); });
    server.once('listening', function() { server.close(function() { resolve(true); }); });
    server.listen(port, '127.0.0.1');
  });
}

async function allocPorts() {
  while (true) {
    var dc = nextPortBase;
    var pion = nextPortBase + 1;
    nextPortBase += 2;
    var dcFree = await isPortFree(dc);
    var pionFree = await isPortFree(pion);
    if (dcFree && pionFree) return { dc: dc, pion: pion };
  }
}

async function getTab(tabId) {
  if (!tabs.has(tabId)) {
    var ports = await allocPorts();
    tabs.set(tabId, { relay: null, tunnelMode: 'dc', platform: 'vk', dcPort: ports.dc, pionPort: ports.pion });
  }
  return tabs.get(tabId);
}

function loadHook(url, tab) {
  var isTelemost = url.includes('telemost.yandex');
  var newPlatform = isTelemost ? 'telemost' : 'vk';
  if (newPlatform !== tab.platform && tab.tunnelMode.startsWith('pion')) {
    tab.platform = newPlatform;
    killRelay(tab);
    setTimeout(function() { startRelay(tab); }, 500);
  } else {
    tab.platform = newPlatform;
  }
  if (tab.tunnelMode === 'pion-video') {
    var hookFile = isTelemost ? 'video-telemost.js' : 'video-vk.js';
    var hook = fs.readFileSync(path.join(hooksDir, hookFile), 'utf8');
    return logCapture + 'window.PION_PORT=' + tab.pionPort + ';window.IS_CREATOR=true;' + hook;
  }
  var hookFile = isTelemost ? 'dc-creator-telemost.js' : 'dc-creator-vk.js';
  var hook = fs.readFileSync(path.join(hooksDir, hookFile), 'utf8');
  return logCapture + 'window.WS_PORT=' + tab.dcPort + ';' + hook;
}

async function getVKCookieString() {
  var ses = session.fromPartition('persist:creator');
  var all = await ses.cookies.get({});
  var vkCookies = all.filter(function(c) {
    return c.domain && (c.domain.indexOf('vk.com') !== -1 || c.domain.indexOf('vk.ru') !== -1);
  });
  return vkCookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
}

function startRelay(tab) {
  killRelay(tab);
  var port = tab.tunnelMode.startsWith('pion') ? tab.pionPort : tab.dcPort;
  var relayMode = 'dc-creator';
  if (tab.tunnelMode === 'pion-video') {
    relayMode = tab.platform === 'telemost' ? 'telemost-video-creator' : 'vk-video-creator';
  }
  var proc = spawn(relayPath, ['--mode', relayMode, '--ws-port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  tab.relay = proc;
  var tabId = null;
  tabs.forEach(function(t, id) { if (t === tab) tabId = id; });
  var onData = function(data) {
    data.toString().trim().split('\n').forEach(function(msg) {
      if (!msg) return;
      console.log('[relay:' + tabId + ']', msg);
      tab.relayLogs = (tab.relayLogs || '') + (tab.relayLogs ? '\n' : '') + msg;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('relay-log', { tabId: tabId, msg: msg });
      }
    });
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', function(code) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('relay-log', { tabId: tabId, msg: 'Relay exited with code ' + code });
    }
  });
}

function killRelay(tab) {
  if (tab.relay) {
    tab.relay.kill();
    tab.relay = null;
  }
}

function killAllRelays() {
  tabs.forEach(function(tab) { killRelay(tab); });
}

function stripCSP(ses) {
  ses.webRequest.onHeadersReceived(function(details, callback) {
    var headers = Object.assign({}, details.responseHeaders);
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['Content-Security-Policy-Report-Only'];
    callback({ responseHeaders: headers });
  });
}

function createWindow() {
  var ses = session.fromPartition('persist:creator');
  stripCSP(ses);
  ses.setPermissionRequestHandler(function(wc, perm, cb) { cb(true); });
  ses.setPermissionCheckHandler(function() { return true; });
  ses.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  app.on('session-created', stripCSP);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', function() { mainWindow = null; });

  mainWindow.webContents.on('did-attach-webview', function(e, wvContents) {
    wvContents.setMaxListeners(Infinity);
    var wvId = wvContents.id;
    var wvListeners = {};
    
    if (pendingWebviewTabId !== null) {
      tabToWebview.set(pendingWebviewTabId, wvId);
      pendingWebviewTabId = null;
    }
    
    wvListeners.beforeInput = function(e, input) {
      if (input.key === 'F12') wvContents.openDevTools();
    };
    wvContents.on('before-input-event', wvListeners.beforeInput);
    
    wvListeners.didNavigate = function(e, url) {
      if (!autoclickers.has(wvId)) {
        autoclickers.set(wvId, { telemost: new TelemostAutoclick(), vk: new VkAutoclick() });
      }
      var ac = autoclickers.get(wvId);
      if (!autoclickEnabled) {
        ac.telemost.stop();
        ac.vk.stop();
        return;
      }
      
      var tabId = null;
      tabToWebview.forEach(function(v, k) { if (v === wvId) tabId = k; });
      var tab = tabId ? tabs.get(tabId) : null;
      var isBotTab = tab && tab.isBot === true;
      
      if (url.includes('telemost.yandex')) {
        ac.vk.stop();
        ac.telemost.attach(wvContents, isBotTab);
        startCallLinkPolling(wvContents, tabId, 'telemost');
      } else if (url.includes('vk.com')) {
        ac.telemost.stop();
        ac.vk.attach(wvContents, isBotTab);
        startCallLinkPolling(wvContents, tabId, 'vk');
      } else {
        ac.telemost.stop();
        ac.vk.stop();
      }
    };
    wvContents.on('did-navigate', wvListeners.didNavigate);
    
    function startCallLinkPolling(wvContents, tabId, platform) {
      if (!tabId) return;
      
      var pollInterval = setInterval(function() {
        if (!wvContents || wvContents.isDestroyed()) {
          clearInterval(pollInterval);
          return;
        }
        var tab = tabs.get(tabId);
        if (tab && tab.callLink) {
          clearInterval(pollInterval);
          return;
        }
        var script;
        if (platform === 'vk') {
          script = "try{var s=Calls?.store?.getState?.();var l=s?.join?.joinLink;if(l)window.bridge.onCallLinkCaptured('" + tabId + "','https://vk.com/call/join/'+l)}catch(e){}";
        } else {
          script = "try{var u=window.location.href;if(u.includes('/j/')||u.includes('/join/'))window.bridge.onCallLinkCaptured('" + tabId + "',u)}catch(e){}";
        }
        wvContents.executeJavaScript(script).catch(function() {});
      }, 1000);
    }
    
    wvListeners.consoleMsg = function(e, level, msg) {
      if (msg.indexOf('state: disconnected') !== -1 || msg.indexOf('state: failed') !== -1) {
        var ac = autoclickers.get(wvContents.id);
        if (ac) ac.vk.kickDisconnected();
      }
      if (msg.indexOf('[CALL_STATUS]') !== -1 && msg.indexOf(':') !== -1) {
        var parts = msg.split('[CALL_STATUS] ')[1];
        var colonIndex = parts.indexOf(':');
        if (colonIndex !== -1) {
          var tabId = parts.substring(0, colonIndex);
          var status = parts.substring(colonIndex + 1);
          callStatusCache.set(tabId, status);
        }
      }
    };
    wvContents.on('console-message', wvListeners.consoleMsg);
    
    wvListeners.destroyed = function() {
      wvContents.removeListener('before-input-event', wvListeners.beforeInput);
      wvContents.removeListener('did-navigate', wvListeners.didNavigate);
      wvContents.removeListener('console-message', wvListeners.consoleMsg);
      wvContents.removeListener('destroyed', wvListeners.destroyed);
      var wvId = wvContents.id;
      var ac = autoclickers.get(wvId);
      if (ac) { ac.telemost.stop(); ac.vk.stop(); autoclickers.delete(wvId); }
      tabToWebview.forEach(function(v, k) { if (v === wvId) tabToWebview.delete(k); });
    };
    wvContents.on('destroyed', wvListeners.destroyed);
  });
}

ipcMain.handle('get-hook-code', async function(e, tabId, url) {
  var tab = await getTab(tabId);
  return loadHook(url, tab);
});

ipcMain.handle('get-call-creator-code', function(e, scriptFile) {
  var filePath = path.join(__dirname, scriptFile || 'call-checker.js');
  return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('set-tunnel-mode', function(e, tabId, mode) {
  var tab = tabs.get(tabId);
  if (!tab) return;
  if (['dc', 'pion-video'].indexOf(mode) === -1) return;
  tab.tunnelMode = mode;
  if (tab.relay) killRelay(tab);
  setTimeout(function() { startRelay(tab); }, 500);
});

ipcMain.handle('start-relay', async function(e, tabId) {
  var tab = await getTab(tabId);
  startRelay(tab);
});

ipcMain.handle('start-headless', async function(e, tabId) {
  var tab = await getTab(tabId);
  tab.tunnelMode = 'headless-vk';
  var cookieStr = await getVKCookieString();
  if (!cookieStr) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('relay-log', { tabId: tabId, msg: 'No VK cookies found. Please log into VK first.' });
    }
    return;
  }
  killRelay(tab);
  var args = ['--cookie-string', cookieStr, '--resources', 'default'];
  var proc = spawn(headlessPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  tab.relay = proc;
  var onData = function(data) {
    data.toString().trim().split('\n').forEach(function(msg) {
      if (!msg) return;
      console.log('[headless:' + tabId + ']', msg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('relay-log', { tabId: tabId, msg: msg });
      }
    });
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', function(code) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('relay-log', { tabId: tabId, msg: 'Headless exited with code ' + code });
    }
  });
});

ipcMain.handle('close-tab', function(e, tabId) {
  var tab = tabs.get(tabId);
  if (tab) {
    killRelay(tab);
    tabs.delete(tabId);
    callStatusCache.delete(tabId);
  }
});

// Bot IPC
ipcMain.handle('start-bot', function(e, settings) {
  if (botManager) {
    botManager.stop();
  }
  botManager = new BotManager(settings, async function(tabConfig) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    var tabId = 'bot-tab-' + Date.now();
    var ports = await allocPorts();
    tabs.set(tabId, { relay: null, tunnelMode: tabConfig.mode, platform: tabConfig.platform || 'vk', dcPort: ports.dc, pionPort: ports.pion, peerId: tabConfig.peerId, isBot: true });

    mainWindow.webContents.send('create-bot-tab', { tabId: tabId, mode: tabConfig.mode, peerId: tabConfig.peerId, platform: tabConfig.platform || 'vk' });
    console.log('[BOT] Created tab:', tabId, 'mode:', tabConfig.mode, 'platform:', tabConfig.platform, 'peerId:', tabConfig.peerId);
  }, function() {
    var result = [];
    tabs.forEach(function(tab, tabId) {
      result.push({ 
        id: tabId, 
        platform: tab.platform, 
        mode: tab.tunnelMode, 
        isBot: tab.isBot === true,
        isApi: tab.isApi === true,
        callStatus: callStatusCache.get(tabId) || 'inactive'
      });
    });
    return result;
  }, function(tabId) {
    var tab = tabs.get(tabId);
    if (tab) {
      killRelay(tab);
      tabs.delete(tabId);
      callStatusCache.delete(tabId);
      console.log('[BOT] Closed tab:', tabId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('close-bot-tab', { tabId: tabId });
      }
    }
  });
  botManager.onError = function(msg) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot-error', msg);
    }
  };
  botManager.start();
  return { success: true };
});

ipcMain.handle('stop-bot', function() {
  if (botManager) {
    botManager.stop();
    botManager = null;
  }
  return { success: true };
});

ipcMain.on('set-autoclick-enabled', function(e, enabled) {
  autoclickEnabled = enabled;
  console.log('[MAIN] Autoclick enabled:', enabled);
});

ipcMain.on('expect-webview', function(e, tabId) {
  pendingWebviewTabId = tabId;
});

ipcMain.on('trigger-create-call', function(e, tabId) {
  var wvId = tabToWebview.get(tabId);
  if (!wvId) return;
  var ac = autoclickers.get(wvId);
  if (!ac) return;
  var tab = tabs.get(tabId);
  if (!tab) return;
  if (tab.platform === 'telemost') {
    ac.telemost.clickCreateCall();
  } else {
    ac.vk.clickCreateCall();
  }
});

ipcMain.on('call-link-captured', async function(e, tabId, link) {
  var tab = tabs.get(tabId);
  if (tab) {
    tab.callLink = link;
    console.log('[CALL_LINK] Captured:', link);
    
    if (tab.isBot && tab.peerId && botManager) {
      await botManager.sendMessage(tab.peerId, '🔗 Call link: ' + link);
    }
  }
});

// HTTP API Server
var apiEnabled = true;
var apiPort = parseInt(process.env.CREATOR_API_PORT) || 8080;
var apiKey = process.env.CREATOR_API_KEY || '';
var apiUseSecret = false;
var apiServer = null;

ipcMain.handle('get-env-vars', function() {
  return {
    apiPort: process.env.CREATOR_API_PORT || '',
    apiKey: process.env.CREATOR_API_KEY || ''
  };
});

function parseBody(req) {
  return new Promise(function(resolve, reject) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function checkAuth(req) {
  if (!apiUseSecret) return true;
  if (!apiKey) return true;
  var auth = req.headers['authorization'] || '';
  if (auth === 'Bearer ' + apiKey || auth === apiKey) return true;
  return false;
}

async function handleApi(req, res) {
  var url = req.url.split('?')[0];
  var method = req.method;

  if (method === 'OPTIONS') {
    sendJson(res, 200, {});
    return;
  }

  if (!checkAuth(req)) {
    sendJson(res, 401, { error: 'Unauthorized. Missing or invalid API secret in Authorization header.' });
    return;
  }

  // GET /api/health
  if (url === '/api/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok', version: appVersion });
    return;
  }

  // GET /api/calls - list all calls
  if (url === '/api/calls' && method === 'GET') {
    var calls = [];
    tabs.forEach(function(tab, tabId) {
      calls.push({
        tabId: tabId,
        platform: tab.platform,
        mode: tab.tunnelMode,
        relayRunning: !!tab.relay,
        isBot: tab.isBot === true,
        isApi: tab.isApi === true,
        peerId: tab.peerId || null,
        callLink: tab.callLink || null,
        callStatus: callStatusCache.get(tabId) || 'inactive'
      });
    });
    sendJson(res, 200, { calls: calls });
    return;
  }

  // POST /api/call/create - create new call
  if (url === '/api/call/create' && method === 'POST') {
    try {
      var body = await parseBody(req);
      var platform = body.platform || 'vk';
      var mode = body.mode || 'dc';
      if (['vk', 'telemost'].indexOf(platform) === -1) {
        sendJson(res, 400, { error: 'Invalid platform. Use vk or telemost' });
        return;
      }
      if (['dc', 'pion-video'].indexOf(mode) === -1) {
        sendJson(res, 400, { error: 'Invalid mode. Use dc or pion-video' });
        return;
      }

      var tabId = 'api-tab-' + Date.now();
      var ports = await allocPorts();
      tabs.set(tabId, { relay: null, tunnelMode: mode, platform: platform, dcPort: ports.dc, pionPort: ports.pion, url: '', isBot: false, isApi: true });
      startRelay(tabs.get(tabId));

      var callUrl;
if (platform === 'telemost') {
  callUrl = 'https://telemost.yandex.ru/';
} else {
  callUrl = 'https://vk.com/calls';
}

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('api-create-tab', { tabId: tabId, url: callUrl, mode: mode, platform: platform, isApi: true });
      }

      sendJson(res, 200, { tabId: tabId, url: callUrl, platform: platform, mode: mode });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // POST /api/call/join - join existing call by URL
  if (url === '/api/call/join' && method === 'POST') {
    try {
      var body = await parseBody(req);
      var callUrl = body.url;
      var mode = body.mode || 'dc';

      if (!callUrl) {
        sendJson(res, 400, { error: 'Missing url' });
        return;
      }
      if (['dc', 'pion-video'].indexOf(mode) === -1) {
        sendJson(res, 400, { error: 'Invalid mode. Use dc or pion-video' });
        return;
      }

      var platform = callUrl.includes('telemost.yandex') ? 'telemost' : 'vk';

      var tabId = 'api-tab-' + Date.now();
      var ports = await allocPorts();
      tabs.set(tabId, { relay: null, tunnelMode: mode, platform: platform, dcPort: ports.dc, pionPort: ports.pion, url: callUrl, isBot: false, isApi: true });
      startRelay(tabs.get(tabId));

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('api-create-tab', { tabId: tabId, url: callUrl, mode: mode, platform: platform, isApi: true });
      }

      sendJson(res, 200, { tabId: tabId, url: callUrl, platform: platform, mode: mode });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // DELETE /api/call/:tabId - close call
  var closeMatch = url.match(/^\/api\/call\/([^/]+)$/);
  if (closeMatch && method === 'DELETE') {
    var tabId = closeMatch[1];
    var tab = tabs.get(tabId);
    if (!tab) {
      sendJson(res, 404, { error: 'Tab not found' });
      return;
    }
    killRelay(tab);
    tabs.delete(tabId);
    callStatusCache.delete(tabId);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('api-close-tab', { tabId: tabId });
    }

    sendJson(res, 200, { success: true });
    return;
  }

  // GET /api/call/:tabId/logs - get logs
  var logsMatch = url.match(/^\/api\/call\/([^/]+)\/logs$/);
  if (logsMatch && method === 'GET') {
    var tabId = logsMatch[1];
    var tab = tabs.get(tabId);
    if (!tab) {
      sendJson(res, 404, { error: 'Tab not found' });
      return;
    }
    sendJson(res, 200, { relayLogs: tab.relayLogs || '' });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function startApiServer() {
  if (apiServer) {
    apiServer.close();
    apiServer = null;
  }
  if (!apiEnabled) {
    console.log('[API] Server disabled');
    return;
  }
  apiServer = http.createServer(handleApi);
  apiServer.listen(apiPort, function() {
    console.log('[API] Server running on port', apiPort);
    if (apiUseSecret && apiKey) {
      console.log('[API] API secret required for access');
    } else {
      console.log('[API] No secret required - open access');
    }
  });
}

ipcMain.on('set-api-settings', function(e, enabled, port, secret, useSecret) {
  var needRestart = (enabled !== apiEnabled) || (port !== apiPort);
  apiEnabled = enabled;
  apiPort = port;
  apiKey = secret;
  apiUseSecret = useSecret;
  console.log('[MAIN] API settings updated - enabled:', apiEnabled, 'port:', apiPort, 'useSecret:', apiUseSecret);
  if (needRestart) {
    startApiServer();
  }
});

ipcMain.handle('get-cookies', async function(e, domain) {
  var ses = session.fromPartition('persist:creator');
  var all = await ses.cookies.get({});
  var vkCookies = all.filter(function(c) {
    return c.domain && (c.domain.indexOf('vk.com') !== -1 || c.domain.indexOf('vk.ru') !== -1);
  });
  console.log('[COOKIES] total:', all.length, 'vk:', vkCookies.length); // ← добавить
  return vkCookies;
});
app.whenReady().then(function() {
  createWindow();
  startApiServer();
});

app.on('window-all-closed', function() { killAllRelays(); app.quit(); });
app.on('before-quit', killAllRelays);
process.on('exit', killAllRelays);
process.on('SIGINT', function() { killAllRelays(); process.exit(); });
process.on('SIGTERM', function() { killAllRelays(); process.exit(); });
