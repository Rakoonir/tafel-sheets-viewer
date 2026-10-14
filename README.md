# Warteliste Viewer

Windows-Desktop-App zur lokalen Auswertung der Warteliste der Oldenburger Tafel e.V. Die importierten Tabellen werden lokal verarbeitet und nicht hochgeladen.

## Windows-App erstellen

Benötigt wird Node.js 22 oder neuer.

```powershell
npm ci
npm start
npm run dist
```

Der Installer wird unter `dist` erstellt. Die Anwendung verwendet das App-Symbol aus `assets/tafel-email-assistent.ico`.

## Updates veröffentlichen

Das GitHub-Repository muss öffentlich sein, damit installierte Apps Releases ohne eingebettete Zugangsdaten abrufen können. Ein GitHub-Release enthält den Installer und die Update-Metadaten.

1. Die Versionsnummer in `package.json` erhöhen.
2. Die Änderungen pushen.
3. Ein Tag anlegen und pushen, das der Paketversion entspricht, zum Beispiel `v1.0.1`.

```powershell
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions erstellt und veröffentlicht daraufhin den Windows-Installer. Installierte Apps prüfen beim Start automatisch auf Updates. Unter **Hilfe → Nach Updates suchen …** lässt sich die Prüfung manuell starten.
