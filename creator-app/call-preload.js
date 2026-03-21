const { webFrame } = require('electron');
const fs = require('fs');
const path = require('path');

const url = window.location.href;
const hookFile = url.includes('telemost.yandex') ? 'creator-telemost.js' : 'creator-vk.js';
const hookCode = fs.readFileSync(path.join(__dirname, '..', 'hooks', hookFile), 'utf8');

const logCapture = `
window.__hookLogs = window.__hookLogs || [];
var _origLog = console.log;
console.log = function() {
  _origLog.apply(console, arguments);
  var m = Array.prototype.slice.call(arguments).join(' ');
  if (m.indexOf('[HOOK]') !== -1) window.__hookLogs.push(m);
};
`;

webFrame.executeJavaScript(logCapture + hookCode);
