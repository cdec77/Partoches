# Partoches v10 — V8 conservée + iPad stable

Base exacte : Partoches PWA v8.

Lignes V8 : 2793
Lignes v10 : 3190

Objectif : ne supprimer aucune fonctionnalité V8. Les corrections sont additives.

Fonctions iPad restaurées/améliorées :
- barre alphabétique A-Z existante, rendue réellement tactile et horizontale ;
- drag & drop de fichiers vers la bibliothèque, sans supprimer les sélecteurs existants ;
- pinch-to-zoom V8 conservé + couche de compatibilité ;
- scroll natif iPadOS/Android du lecteur, sans faux scroll JS ;
- auto-scroll V8 conservé ;
- dessin V8 conservé ;
- navigation boutons/molette/clavier V8 conservée ;
- safe-area et barres système conservées.

Correction critique :
- V8 utilisait touch-action:none sur body.
- V10 conserve le body non-défilant mais autorise explicitement
  pan-x pan-y pinch-zoom sur #scroll-container.
- Le canvas d'annotation ne capture les gestes que lorsque le mode dessin est actif.

Icône :
- vraie note de musique beamed/eighth-note, avec portée, néon lime/cyan ;
- PNG multi-tailles ;
- maskable Android ;
- favicon ICO/PNG ;
- Apple Touch Icons.
