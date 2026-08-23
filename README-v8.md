# Partoches PWA — v8

Fichier principal : index.html
Ligne de départ : 1978
Ligne finale : 2793

Améliorations principales :
- Import dossier récursif avec showDirectoryPicker quand disponible.
- Fallback webkitdirectory pour navigateurs mobiles compatibles.
- Import séparé Fichiers et Photos.
- Dock d'import sticky et toujours visible, avec safe-area iPadOS/Android.
- Plein écran + fallback iOS.
- Wake Lock pendant auto-scroll quand le navigateur l'autorise.
- Bandeau tactile inférieur de navigation/zoom sur mobile.
- Persistance des préférences de zoom/luminosité/contraste.
- Diagnostic appareil dans console via window.PartochesDiagnostics.
- Manifest PWA + Service Worker.
- Famille d'icônes PNG et favicon.

Limites navigateur :
- iPadOS Safari ne donne pas toujours accès à File System Access API.
- La récursivité de dossier sur iPad dépend de la prise en charge de webkitdirectory.
- Dans le pire cas, les boutons Fichiers / Photos restent disponibles.
