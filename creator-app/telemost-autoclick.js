class TelemostAutoclick {
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
    this._callCreated = true;
    this._wvContents.executeJavaScript(`
      (function() {
        var clicked = false;
        function tryClick() {
          if (clicked) return true;
          var btn = document.querySelector('[data-testid="create-call-button"]')
            || document.querySelector('button.responsiveButton_NaQey, .responsiveButton_NaQey')
            || [...document.querySelectorAll('button')].find(x => x.textContent.includes('Новая видеовстреча'));
          if (btn) {
            btn.click();
            clicked = true;
            console.log('[BOT] Telemost: creating call...');
            return true;
          }
          return false;
        }
        if (tryClick()) return;
        var observer = new MutationObserver(function() {
          if (tryClick()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(function() { observer.disconnect(); }, 5000);
      })();
    `).catch(function() {});
  }

  _scan() {
    try {
      this._wvContents.mainFrame.framesInSubtree.forEach((frame) => {
        frame.executeJavaScript(`
          var admit = [...document.querySelectorAll('.Orb-Button, button, [role="button"], [role="link"]')]
            .find(x => x.textContent.includes('Впустить'));
          if (!admit) return 'idle';
          var name = [...document.querySelectorAll('[class*="participantName"]')]
            .find(x => !x.closest('[class*="selfView"]') && x.querySelector('[data-testid="show-moderation-popup"]'));
          if (name) { name.querySelector('[data-testid="show-moderation-popup"]').click(); return 'kick-open'; }
          admit.click();
          return 'admitted';
        `).then((r) => {
          if (r === 'kick-open') setTimeout(() => this._clickRemove(frame), 500);
          else if (r === 'admitted') console.log('[auto-accept] guest admitted');
        }).catch(function() {});
      });
    } catch(e) {}
  }

  _clickRemove(frame) {
    frame.executeJavaScript(`
      var el = document.querySelector('[title="Удалить со встречи"]');
      if (el) { el.click(); return true; }
    `).then((r) => {
      if (r) setTimeout(() => this._confirmRemove(frame), 500);
    }).catch(function() {});
  }

  _confirmRemove(frame) {
    frame.executeJavaScript(`
      var btn = [...(document.querySelector('[data-testid="orb-modal2"]')?.querySelectorAll('button')||[])].find(x => x.textContent.trim() === 'Удалить');
      if (btn) { btn.click(); return true; }
    `).then((r) => {
      if (r) console.log('[auto-accept] kicked previous participant');
    }).catch(function() {});
  }
}

module.exports = TelemostAutoclick;
