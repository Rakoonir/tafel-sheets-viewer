const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updates', {
  getStatus: () => ipcRenderer.invoke('updates:get-status'),
  check: () => ipcRenderer.invoke('updates:check'),
  install: () => ipcRenderer.invoke('updates:install'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  }
});
