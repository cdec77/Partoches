// =============================================================================
// PARTOCHES — SERVICE WORKER — v7 "AUTOSCROLL & IPAD EDITION"
// =============================================================================
// Changelog v6 -> v7 :
//   • Version de cache incrémentée (partoches-v7) pour forcer la mise à jour
//     des utilisateurs déjà installés en PWA (sinon l'ancien index.html en
//     cache resterait servi indéfiniment sur iPad/Android).
//   • Toutes les icônes PNG (16 à 512px) + favicon.ico + manifest ajoutées au
//     pré-cache, pour un fonctionnement 100% hors-ligne dès la première visite.
//   • Stratégie "cache d'abord, réseau en secours, mise à jour silencieuse en
//     arrière-plan" (stale-while-revalidate simplifiée) pour les ressources
//     de l'application, afin d'obtenir les mises à jour sans page blanche.
//   • Nettoyage automatique des anciens caches (v1 à v6) à l'activation.
// =============================================================================

const CACHE_NAME = 'partoches-v7';

const ASSETS = [
  'index.html',
  'manifest.json',
  'icon-16.png',
  'icon-32.png',
  'icon-57.png',
  'icon-60.png',
  'icon-72.png',
  'icon-76.png',
  'icon-96.png',
  'icon-120.png',
  'icon-128.png',
  'icon-144.png',
  'icon-152.png',
  'icon-167.png',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'favicon.ico',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;500;700&family=Outfit:wght@200;400;900&display=swap'
];

// --- INSTALLATION : pré-cache de la coquille applicative complète ---
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(err => console.warn('[SW] Pré-cache partiel (ressource distante indisponible ?)', err))
  );
  // Active la nouvelle version immédiatement, sans attendre la fermeture
  // de tous les onglets — important pour recevoir vite les correctifs sur iPad.
  self.skipWaiting();
});

// --- ACTIVATION : purge des anciennes versions de cache ---
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Suppression ancien cache :', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// --- FETCH : cache d'abord, puis réseau, avec mise à jour silencieuse ---
self.addEventListener('fetch', (e) => {
  // On ne gère que les requêtes GET (les autres, ex. lectures de fichiers
  // locaux via File System Access API, ne passent pas par le réseau ici).
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(response => {
        // Met à jour le cache en arrière-plan si la ressource est valide,
        // pour que la prochaine ouverture bénéficie de la version la plus récente.
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => cached); // Hors-ligne : on retombe sur le cache s'il existe

      // Sert le cache immédiatement si présent (rapide, fonctionne hors-ligne),
      // sinon attend la réponse réseau.
      return cached || networkFetch;
    })
  );
});
