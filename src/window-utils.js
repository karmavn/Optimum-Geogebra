/**
 * Shared Electron window foregrounding helper.
 */
function bringWindowToFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  win.setAlwaysOnTop(false);
}

module.exports = { bringWindowToFront };
