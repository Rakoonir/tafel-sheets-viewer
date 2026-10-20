const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let updateStatus = { state: 'idle' };

function publishUpdateStatus(status) {
  updateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updates:status', status);
  }
}

function checkForUpdates() {
  if (!app.isPackaged) {
    publishUpdateStatus({ state: 'unavailable' });
    return;
  }

  publishUpdateStatus({ state: 'checking' });
  autoUpdater.checkForUpdates().catch((error) => {
    console.error('Updateprüfung fehlgeschlagen:', error);
    publishUpdateStatus({ state: 'error' });
  });
}

ipcMain.handle('updates:get-status', () => updateStatus);
ipcMain.handle('updates:check', () => checkForUpdates());
ipcMain.handle('updates:install', () => {
  if (updateStatus.state !== 'downloaded') {
    throw new Error('Es ist kein heruntergeladenes Update zur Installation bereit.');
  }
  autoUpdater.quitAndInstall();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 860,
    minHeight: 640,
    title: 'Warteliste – Oldenburger Tafel e.V.',
    icon: path.join(__dirname, '..', 'assets', 'tafel-email-assistent.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const pagePath = path.resolve(__dirname, '..', 'warteliste-viewer.html');
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') || path.resolve(fileURLToPath(url)) !== pagePath) {
      event.preventDefault();
    }
  });
  mainWindow.loadFile(pagePath);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = console;

autoUpdater.on('update-available', (info) => {
  publishUpdateStatus({ state: 'available', version: info.version });
});

autoUpdater.on('update-not-available', () => {
  publishUpdateStatus({ state: 'up-to-date' });
});

autoUpdater.on('download-progress', (progress) => {
  publishUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) });
});

autoUpdater.on('update-downloaded', (info) => {
  publishUpdateStatus({ state: 'downloaded', version: info.version });
});

autoUpdater.on('error', (error) => {
  console.error('Updater-Fehler:', error);
  publishUpdateStatus({ state: 'error' });
});

app.whenReady().then(() => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Datei',
      submenu: [{ role: 'quit', label: 'Beenden' }]
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'Nach Updates suchen …',
          click: () => checkForUpdates()
        },
        { type: 'separator' },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false
        }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
  createWindow();
  setTimeout(() => checkForUpdates(), 4000);
});

app.on('window-all-closed', () => {
  app.quit();
});
