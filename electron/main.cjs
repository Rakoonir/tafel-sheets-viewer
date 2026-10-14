const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let manualUpdateCheck = false;

function checkForUpdates(manual = false) {
  manualUpdateCheck = manual;

  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'Updates können in der installierten Anwendung geprüft werden.'
      });
    }
    return;
  }

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('Updateprüfung fehlgeschlagen:', error);
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Updateprüfung fehlgeschlagen',
        message: 'Die GitHub-Releases konnten nicht geprüft werden.',
        detail: error.message
      });
    }
    manualUpdateCheck = false;
  });
}

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
      sandbox: true
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
  if (manualUpdateCheck) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update verfügbar',
      message: `Version ${info.version} wird im Hintergrund heruntergeladen.`
    });
  }
});

autoUpdater.on('update-not-available', () => {
  if (manualUpdateCheck) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Kein Update verfügbar',
      message: 'Sie verwenden bereits die aktuelle Version.'
    });
  }
  manualUpdateCheck = false;
});

autoUpdater.on('update-downloaded', async (info) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['Jetzt neu starten', 'Später'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update bereit',
    message: `Version ${info.version} wurde heruntergeladen.`,
    detail: 'Die Anwendung muss neu gestartet werden, um das Update zu installieren.'
  });

  if (response === 0) {
    autoUpdater.quitAndInstall();
  }
});

autoUpdater.on('error', (error) => {
  console.error('Updater-Fehler:', error);
  if (manualUpdateCheck && mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Update fehlgeschlagen',
      message: 'Das Update konnte nicht geladen werden.',
      detail: error.message
    });
  }
  manualUpdateCheck = false;
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
          click: () => checkForUpdates(true)
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
