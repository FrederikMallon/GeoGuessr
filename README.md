# Logbuch — GeoGuessr Statistiken

Ein kleines, eigenständiges Web-Tool (nur HTML/CSS/JS, kein Build-Schritt) zum
händischen Erfassen und Auswerten deiner GeoGuessr-Ergebnisse.

## Struktur

```
geoguessr-tracker/
├── index.html          Die App (Eingabe, Auswertung, Einstellungen)
├── style.css
├── app.js               Logik, Rendering, Charts, GitHub-Sync
├── countries.js         Länderliste fürs Dropdown
└── data/
    └── results.json      Datendatei (siehe unten)
```

## In Betrieb nehmen (GitHub Pages)

1. Repository auf GitHub anlegen, diesen Ordnerinhalt hochladen/pushen.
2. **Settings → Pages** → Source auf den Branch (z.B. `main`) und Root-Ordner stellen.
3. Nach kurzer Zeit ist die Seite unter `https://DEIN-USERNAME.github.io/DEIN-REPO/` erreichbar.

Das Tool funktioniert auch komplett offline / lokal, indem du `index.html` einfach
im Browser öffnest (Doppelklick).

## Wie die Daten gespeichert werden

Es gibt zwei Ebenen, bewusst getrennt, damit das Tool ohne jede Einrichtung
sofort funktioniert:

1. **localStorage (Standard, automatisch).** Jede gespeicherte Partie landet
   sofort im localStorage deines Browsers. Kein Setup nötig. Nachteil: die
   Daten bleiben an dieses Gerät/diesen Browser gebunden.
2. **`data/results.json` im Repository (optional).** Im Tab **Einstellungen**
   kannst du unter "GitHub-Synchronisierung" dein Repo hinterlegen und die
   Daten per Knopfdruck direkt in `data/results.json` im Repo schreiben
   (über die GitHub-API) bzw. von dort laden. Damit wird die JSON-Datei im
   Repo zum "echten", geräteübergreifenden Datenstand — z.B. wenn du vom
   Handy und vom Laptop aus einträgst, oder die Rohdaten einfach versionieren
   möchtest.

Für Punkt 2 brauchst du ein **fine-grained Personal Access Token** von GitHub:

- GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- Repository access: nur auf dieses eine Repo beschränken
- Permissions: **Contents → Read and write**
- Den Token im Tab "Einstellungen" eintragen und "Konfiguration speichern" klicken

Der Token wird ausschließlich lokal im Browser (localStorage) abgelegt und nur
direkt an `api.github.com` gesendet — nirgendwo sonst hin. Trotzdem: fine-grained
Token mit möglichst engem Scope verwenden, und den Token nicht mit anderen teilen.

Zusätzlich gibt es im Tab "Einstellungen" jederzeit einen manuellen
**JSON-Export/-Import** als einfaches Backup, unabhängig von GitHub.

## Nutzung

### Eingabe
- Eine **Partie** besteht aus 2 oder mehr **Runden**.
- Datum ist automatisch auf heute gesetzt, aber änderbar (gilt für die ganze Partie).
- Pro Runde: Land (Dropdown), Distanz deines Tipps zur echten Position in km,
  und die relativen Punkte (dein Punktevorsprung/-rückstand gegenüber dem Gegner
  in dieser Runde — negative Werte sind erlaubt).
- Mit "+ Runde hinzufügen" beliebig viele weitere Runden ergänzen.

### Auswertung
- Kennzahlen-Karten: Anzahl Partien/Runden, Ø Distanz, Ø relative Punkte,
  beste Runde nach Distanz und nach Punkten.
- Filter nach Land und Zeitraum (wirkt auf alle Grafiken, Tabellen und Kennzahlen).
- Diagramme: Verlauf von Ø Distanz/Punkten pro Partie, Distanz-vs-Punkte-Streudiagramm,
  sowie Balkendiagramme Ø Distanz bzw. Ø Punkte je Land.
- Crosstab-Tabelle je Land (Rundenanzahl, Ø Distanz, Ø Punkte, beste Werte) — Spalten
  anklickbar zum Sortieren.
- Vollständige, sortierbare Tabelle aller einzelnen Runden.

## Anpassungen

- **Länderliste erweitern**: `countries.js` bearbeiten (z.B. weitere
  GeoGuessr-Sondergebiete ergänzen).
- **Design**: Farben/Schriften liegen als CSS-Variablen ganz oben in `style.css`.
