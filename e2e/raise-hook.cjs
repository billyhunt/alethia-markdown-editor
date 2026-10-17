// Loaded with `-r` ahead of the app's main module in end-to-end runs only.
//
// Which window is on top is a property of the desktop, and macOS reports no
// focused window at all while another app is active (the normal state when a
// test runner owns the terminal). So instead of asking the OS, this records
// every time main raises a window. The last raised window that still exists is
// the one in front once the app is active.
const { BrowserWindow } = require('electron')

globalThis.__alethiaRaised = []
for (const method of ['show', 'focus', 'moveTop', 'restore']) {
  const original = BrowserWindow.prototype[method]
  BrowserWindow.prototype[method] = function (...args) {
    globalThis.__alethiaRaised.push(this.id)
    return original.apply(this, args)
  }
}
