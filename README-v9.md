# Partoches PWA v9 — iPadOS complete

Lignes version précédente : 2793
Lignes version finale : 3460

Restauration / amélioration des 4 fonctions demandées :
1. Barre alphabétique
2. Drag & Drop
3. Zoom par pincement
4. Navigation par scroll tactile / molette / trackpad

Les fonctions de la v8 sont conservées : scan récursif, fichiers/photos, fallback
iPadOS, PDF/images, zoom persistant, plein écran, dessin, luminosité/contraste,
setlists, auto-scroll, Wake Lock, PWA, safe-area et diagnostics.

Point important iPadOS :
- Le body n'est plus verrouillé en `touch-action:none`.
- Le conteneur de lecture accepte `pan-x pan-y pinch-zoom`.
- Le scroll reste natif dès que possible.
- Le pinch utilise les Pointer Events avec maintien du point sous les doigts.
- La barre alphabétique est horizontale et tactile.
