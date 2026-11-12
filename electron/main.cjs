const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let updateStatus = { state: 'idle' };
let googleImportInProgress = false;
const googleTokenPath = () => path.join(app.getPath('userData'), 'google-refresh-token.enc');
const googleSettingsPath = () => path.join(app.getPath('userData'), 'google-settings.enc');

function base64Url(value) {
  return value.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function readGoogleCredentials(clientId) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Die sichere lokale Speicherung ist nicht verfügbar.');
  }
  try {
    const encrypted = await fs.readFile(googleTokenPath());
    const saved = JSON.parse(safeStorage.decryptString(encrypted));
    return saved.clientId === clientId ? saved : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Das gespeicherte Google-Token konnte nicht gelesen werden.');
  }
}

async function saveGoogleCredentials(clientId, credentials) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Die sichere lokale Speicherung ist nicht verfügbar.');
  }
  const encrypted = safeStorage.encryptString(JSON.stringify({ clientId, ...credentials }));
  await fs.mkdir(path.dirname(googleTokenPath()), { recursive: true });
  await fs.writeFile(googleTokenPath(), encrypted, { mode: 0o600 });
}

async function readGoogleSettings() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Die sichere lokale Speicherung ist nicht verfügbar.');
  }
  try {
    return JSON.parse(safeStorage.decryptString(await fs.readFile(googleSettingsPath())));
  } catch (error) {
    if (error.code === 'ENOENT') return { clientId: '', clientSecret: '', spreadsheetUrl: '' };
    throw new Error('Die gespeicherten Google-Einstellungen konnten nicht gelesen werden.');
  }
}

async function saveGoogleSettings(settings) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Die sichere lokale Speicherung ist nicht verfügbar.');
  }
  const cleanSettings = {
    clientId: typeof settings?.clientId === 'string' ? settings.clientId.trim() : '',
    clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret.trim() : '',
    spreadsheetUrl: typeof settings?.spreadsheetUrl === 'string' ? settings.spreadsheetUrl.trim() : ''
  };
  if (Object.values(cleanSettings).some(value => value.length > 4096)) {
    throw new Error('Eine Google-Einstellung ist zu lang.');
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(cleanSettings));
  await fs.mkdir(path.dirname(googleSettingsPath()), { recursive: true });
  await fs.writeFile(googleSettingsPath(), encrypted, { mode: 0o600 });
  return cleanSettings;
}

ipcMain.handle('google-sheets:get-settings', () => readGoogleSettings());
ipcMain.handle('google-sheets:save-settings', (_event, settings) => saveGoogleSettings(settings));

async function exchangeGoogleToken(params, clientSecret) {
  if (clientSecret) params.client_secret = clientSecret;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.error_description?.toLowerCase().includes('client secret')) {
      throw new Error('Google verlangt das Client-Secret. Bitte tragen Sie es in den Einstellungen ein.');
    }
    const error = new Error(result.error_description || 'Die Google-Anmeldung ist fehlgeschlagen.');
    error.code = result.error;
    throw error;
  }
  return result;
}

function startGoogleSignIn(clientId) {
  return new Promise((resolve, reject) => {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64Url(crypto.randomBytes(32));
    const server = http.createServer();
    let redirectUri;
    const timeout = setTimeout(() => finish(new Error('Die Google-Anmeldung wurde wegen Zeitüberschreitung beendet.')), 180000);
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (server.listening) server.close();
      if (error) reject(error);
      else resolve(value);
    };

    server.on('request', async (request, response) => {
      const callback = new URL(request.url, 'http://127.0.0.1');
      if (callback.pathname !== '/oauth2callback') {
        response.writeHead(404).end();
        return;
      }
      if (callback.searchParams.get('state') !== state) {
        response.writeHead(400).end('Anmeldung fehlgeschlagen. Sie können dieses Fenster schließen.');
        finish(new Error('Die Google-Anmeldung konnte nicht bestätigt werden.'));
        return;
      }
      const code = callback.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Anmeldung abgebrochen. Sie können dieses Fenster schließen.');
        finish(new Error('Die Google-Anmeldung wurde abgebrochen.'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><meta charset="utf-8"><title>Anmeldung abgeschlossen</title><p>Anmeldung abgeschlossen. Sie können dieses Fenster schließen und zur Wartelisten-App zurückkehren.</p>');
      finish(null, { code, verifier, redirectUri });
    });

    server.on('error', () => finish(new Error('Der lokale Rückruf für die Google-Anmeldung konnte nicht gestartet werden.')));
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
      const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorizationUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline'
      }).toString();

      try {
        await shell.openExternal(authorizationUrl.toString());
      } catch {
        finish(new Error('Die Google-Anmeldeseite konnte nicht geöffnet werden.'));
      }
    });
  });
}

async function getGoogleAccessToken(clientId, suppliedClientSecret) {
  const savedCredentials = await readGoogleCredentials(clientId);
  const clientSecret = suppliedClientSecret || savedCredentials?.clientSecret;
  if (!clientSecret) {
    throw new Error('Bitte tragen Sie das Client-Secret aus der Google-Cloud-Konsole in den Einstellungen ein.');
  }
  if (savedCredentials?.refreshToken) {
    try {
      const result = await exchangeGoogleToken({
        client_id: clientId,
        refresh_token: savedCredentials.refreshToken,
        grant_type: 'refresh_token'
      }, clientSecret);
      if (clientSecret !== savedCredentials.clientSecret) {
        await saveGoogleCredentials(clientId, { refreshToken: savedCredentials.refreshToken, clientSecret });
      }
      return result.access_token;
    } catch (error) {
      if (error.code !== 'invalid_grant') throw error;
      await fs.rm(googleTokenPath(), { force: true });
    }
  }

  const authorization = await startGoogleSignIn(clientId);
  const result = await exchangeGoogleToken({
    client_id: clientId,
    code: authorization.code,
    code_verifier: authorization.verifier,
    grant_type: 'authorization_code',
    redirect_uri: authorization.redirectUri
  }, clientSecret);
  await saveGoogleCredentials(clientId, { refreshToken: result.refresh_token, clientSecret });
  return result.access_token;
}

function spreadsheetIdFromUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Bitte einen gültigen Google-Sheets-Link eintragen.');
  }
  const match = url.protocol === 'https:' && url.hostname === 'docs.google.com'
    && url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Der Link muss zu einer Google-Tabelle führen.');
  return { id: match[1], tabId: url.searchParams.get('gid') || url.hash.match(/(?:^#|&)gid=(\d+)/)?.[1] };
}

async function googleApiGet(url, accessToken) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) throw new Error('Die Google-Anmeldung ist abgelaufen. Bitte erneut anmelden.');
    if (response.status === 403) throw new Error('Kein Zugriff auf die Tabelle. Bitte prüfen Sie das angemeldete Google-Konto und die Sheets API.');
    if (response.status === 404) throw new Error('Die Tabelle oder das Tabellenblatt wurde nicht gefunden.');
    throw new Error(result.error?.message || 'Die Tabelle konnte nicht von Google abgerufen werden.');
  }
  return result;
}

async function fetchGoogleSheet({ clientId, clientSecret, spreadsheetUrl }) {
  if (typeof clientId !== 'string' || !/^[^\s]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Bitte in den Einstellungen eine gültige OAuth-Client-ID eintragen.');
  }
  const { id, tabId } = spreadsheetIdFromUrl(spreadsheetUrl);
  const accessToken = await getGoogleAccessToken(clientId, clientSecret);
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
  const metadata = await googleApiGet(`${baseUrl}?fields=sheets.properties(sheetId,title)`, accessToken);
  const sheets = metadata.sheets || [];
  const selectedSheet = tabId ? sheets.find(sheet => String(sheet.properties.sheetId) === tabId) : sheets[0];
  if (!selectedSheet) throw new Error('Das Tabellenblatt aus dem Link wurde nicht gefunden.');
  const range = `'${selectedSheet.properties.title.replace(/'/g, "''")}'!A:ZZ`;
  const values = await googleApiGet(`${baseUrl}/values/${encodeURIComponent(range)}`, accessToken);
  if (!Array.isArray(values.values) || values.values.length < 2) {
    throw new Error('Im ausgewählten Tabellenblatt wurden keine Wartelisten-Daten gefunden.');
  }
  return values.values;
}

ipcMain.handle('google-sheets:load', async (_event, config) => {
  if (googleImportInProgress) throw new Error('Ein Google-Abruf läuft bereits.');
  googleImportInProgress = true;
  try {
    return await fetchGoogleSheet(config || {});
  } finally {
    googleImportInProgress = false;
  }
});

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
