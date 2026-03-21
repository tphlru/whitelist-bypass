const { app, BrowserWindow, session, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

var hooksDir = app.isPackaged
  ? path.join(process.resourcesPath, 'hooks')
  : path.join(__dirname, '..', 'hooks');
const hookVk = fs.readFileSync(path.join(hooksDir, 'creator-vk.js'), 'utf8');
const hookTelemost = fs.readFileSync(path.join(hooksDir, 'creator-telemost.js'), 'utf8');
const logCapture = "window.__hookLogs=window.__hookLogs||[];var _ol=console.log;console.log=function(){_ol.apply(console,arguments);var m=Array.prototype.slice.call(arguments).join(' ');if(m.indexOf('[HOOK]')!==-1)window.__hookLogs.push(m)};";

let mainWindow;
let relayProcess;

function startRelay() {
  const net = require('net');
  const sock = new net.Socket();
  sock.setTimeout(1000);
  sock.on('connect', () => {
    sock.destroy();
    console.log('[relay] already running on :9000');
    if (mainWindow) mainWindow.webContents.send('relay-log', 'Using existing relay on :9000');
  });
  sock.on('error', () => {
    sock.destroy();
    spawnRelay();
  });
  sock.on('timeout', () => {
    sock.destroy();
    spawnRelay();
  });
  sock.connect(9000, '127.0.0.1');
}

function spawnRelay() {
  var relayName = process.platform === 'win32' ? 'relay.exe' : 'relay';
  var relayPath = app.isPackaged
    ? path.join(process.resourcesPath, relayName)
    : path.join(__dirname, '..', 'relay', relayName);
  relayProcess = spawn(relayPath, ['--mode', 'creator'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  relayProcess.stdout.on('data', (data) => {
    data.toString().trim().split('\n').forEach((msg) => {
      if (!msg) return;
      console.log('[relay]', msg);
      if (mainWindow) mainWindow.webContents.send('relay-log', msg);
    });
  });
  relayProcess.stderr.on('data', (data) => {
    data.toString().trim().split('\n').forEach((msg) => {
      if (!msg) return;
      console.log('[relay]', msg);
      if (mainWindow) mainWindow.webContents.send('relay-log', msg);
    });
  });
  relayProcess.on('close', (code) => {
    if (mainWindow) mainWindow.webContents.send('relay-log', 'Relay exited with code ' + code);
  });
}

function stripCSP(ses) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    var headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['Content-Security-Policy-Report-Only'];
    callback({ responseHeaders: headers });
  });
}

function createWindow() {
  const ses = session.fromPartition('persist:creator');
  stripCSP(ses);
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  ses.setPermissionCheckHandler(() => true);

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

  ses.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  app.on('session-created', stripCSP);

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

function killRelay() {
  if (relayProcess) {
    relayProcess.kill();
    relayProcess = null;
  }
}


ipcMain.handle('get-hook-code', (e, url) => {
  var hook = url.includes('telemost.yandex') ? hookTelemost : hookVk;
  return logCapture + hook;
});

app.whenReady().then(() => {
  startRelay();
  createWindow();
});

app.on('window-all-closed', () => {
  killRelay();
  app.quit();
});

app.on('before-quit', killRelay);
process.on('exit', killRelay);
process.on('SIGINT', () => { killRelay(); process.exit(); });
process.on('SIGTERM', () => { killRelay(); process.exit(); });
