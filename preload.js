const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveGgbDialog: (base64) => ipcRenderer.invoke('save-ggb-dialog', base64),
  onLoadGgbFile: (callback) => ipcRenderer.on('load-ggb-file', (_event, base64) => callback(base64)),
  onRequestSaveGgb: (callback) => ipcRenderer.on('request-save-ggb', () => callback())
});
