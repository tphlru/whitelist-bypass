class VkAutoclick {
  constructor() {
    this._interval = null;
    this._wvContents = null;
    this._domReadyHandler = null;
    this._destroyedHandler = null;
    this._autoCreate = false;
    this._callCreated = false;
  }

  attach(wvContents, autoCreate) {
    this.stop();
    this._wvContents = wvContents;
    this._autoCreate = autoCreate || false;
    this._interval = setInterval(() => this._scan(), 2000);
    
    this._domReadyHandler = () => {
      if (this._autoCreate) {
        this._autoCreate = false;
        this._waitForButtonAndClick();
      }
    };
    this._destroyedHandler = () => this.stop();
    wvContents.on('dom-ready', this._domReadyHandler);
    wvContents.on('destroyed', this._destroyedHandler);
    
    if (this._autoCreate) {
      this._waitForButtonAndClick();
    }
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    if (this._wvContents) {
      if (this._domReadyHandler) {
        this._wvContents.removeListener('dom-ready', this._domReadyHandler);
      }
      if (this._destroyedHandler) {
        this._wvContents.removeListener('destroyed', this._destroyedHandler);
      }
    }
    this._domReadyHandler = null;
    this._destroyedHandler = null;
    this._autoCreate = false;
    this._callCreated = false;
    this._wvContents = null;
  }

  clickCreateCall() {
    if (!this._wvContents) return;
    if (this._callCreated) return;
    this._waitForButtonAndClick();
  }

  _waitForButtonAndClick() {
    if (!this._wvContents || this._callCreated) return;
    this._wvContents.executeJavaScript(`
      (function() {
        function tryClickCreate() {
          var btn = document.querySelector('.vkuiButtonGroup__host > button')
            || document.querySelector('[data-testid="calls_create_call_button"]')
            || [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Создать звонок');
          if (btn) {
            btn.click();
            console.log('[BOT] VKCalls: clicked create call button');
            return true;
          }
          return false;
        }
        function tryClickStart() {
          var modal = document.querySelector('.CreateCallByLinkModal, .BaseModal, [class*="modal"]');
          if (modal) {
            var start = [...modal.querySelectorAll('button')].find(x => /Начать|Создать/.test(x.textContent));
            if (start) {
              start.click();
              console.log('[BOT] VKCalls: clicked start call button');
              return true;
            }
          }
          return false;
        }
        function tryFullFlow() {
          if (tryClickCreate()) {
            setTimeout(function() {
              if (!tryClickStart()) {
                var observer = new MutationObserver(function() {
                  if (tryClickStart()) observer.disconnect();
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(function() { observer.disconnect(); }, 5000);
              }
            }, 500);
            return true;
          }
          return false;
        }
        if (tryFullFlow()) return;
        var observer = new MutationObserver(function() {
          if (tryFullFlow()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(function() { observer.disconnect(); }, 5000);
      })();
    `).catch(function() {});
    this._callCreated = true;
  }

  _scan() {
    try {
      this._wvContents.mainFrame.framesInSubtree.forEach((frame) => {
        frame.executeJavaScript(`
          var admit = document.querySelector('[data-testid="calls_waiting_hall_promote"]');
          if (!admit) return 'idle';
          var menus = document.querySelectorAll('[data-testid="calls_participant_list_item_menu_button"]');
          if (menus.length > 1) { menus[menus.length-1].click(); return 'kick-open'; }
          admit.click();
          return 'admitted';
        `).then((r) => {
          if (r === 'kick-open') setTimeout(() => this._clickKick(frame), 500);
          else if (r === 'admitted') console.log('[auto-accept] VK guest admitted');
        }).catch(function() {});
      });
    } catch(e) {}
  }

  _clickKick(frame) {
    frame.executeJavaScript(`
      var btn = document.querySelector('[data-testid="calls_participant_actions_kick"]');
      if (btn) { btn.click(); return true; }
    `).then((r) => {
      if (r) setTimeout(() => this._confirmKick(frame), 500);
    }).catch(function() {});
  }

  _confirmKick(frame) {
    frame.executeJavaScript(`
      var btn = document.querySelector('[data-testid="calls_call_kick_submit"]');
      if (btn) { btn.click(); return true; }
    `).then((r) => {
      if (r) console.log('[auto-accept] VK kicked previous participant');
    }).catch(function() {});
  }

  kickDisconnected() {
    if (!this._wvContents) return;
    try {
      this._wvContents.mainFrame.framesInSubtree.forEach((frame) => {
        frame.executeJavaScript(`
          var menus = document.querySelectorAll('[data-testid="calls_participant_list_item_menu_button"]');
          if (menus.length > 1) { menus[menus.length-1].click(); return true; }
        `).then((r) => {
          if (r) setTimeout(() => this._clickKick(frame), 500);
        }).catch(function() {});
      });
    } catch(e) {}
  }
}

module.exports = VkAutoclick;
