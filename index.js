



        const i18n = {
            fr: {
                nav_lib: "Répertoire", nav_set: "Setlists", nav_view: "Visionneuse",
                scan_title: "Importer une bibliothèque", btn_scan_folder: "📁 Dossier récursif",
                btn_scan_files: "📄 Fichiers", btn_scan_photos: "📷 Photos",
                btn_fullscreen: "Plein écran", scan_folder_hint: "Dossier récursif disponible selon le navigateur",
                btn_restore: "Rétablir Accès", btn_scan: "Scanner Dossier",
                set_title: "Programmation", btn_save_set: "Enregistrer Set", btn_clear: "Vider",
                btn_close: "✕ Fermer", btn_settings: "Filtres", btn_draw: "Dessin",
                fx_bright: "Lum", fx_contrast: "Cont", btn_del: "Gomme",
                btn_prev: "Précédent", btn_next: "Suivant", btn_add: "Ajouter", btn_home: "🏠 Accueil",
                btn_autoscroll: "Scroll ▶", scroll_title: "Auto-Scroll", scroll_speed: "Vitesse", scroll_chain: "Enchaîner Setlist"
            },
            en: {
                nav_lib: "Library", nav_set: "Setlists", nav_view: "Viewer",
                scan_title: "Import library", btn_scan_folder: "📁 Recursive folder",
                btn_scan_files: "📄 Files", btn_scan_photos: "📷 Photos",
                btn_fullscreen: "Fullscreen", scan_folder_hint: "Recursive folder support depends on browser",
                btn_restore: "Restore Access", btn_scan: "Scan Folder",
                set_title: "Setlists", btn_save_set: "Save Setlist", btn_clear: "Clear",
                btn_close: "✕ Close", btn_settings: "Filters", btn_draw: "Draw",
                fx_bright: "Bright", fx_contrast: "Cont", btn_del: "Eraser",
                btn_prev: "Previous", btn_next: "Next", btn_add: "Add", btn_home: "🏠 Home",
                btn_autoscroll: "Scroll ▶", scroll_title: "Auto-Scroll", scroll_speed: "Speed", scroll_chain: "Chain Setlist"
            }
        };

        let currentLang = localStorage.getItem('part_lang') || 'fr';
        let files = [], setFiles = [], currentIndex = 0, sources = [];
        let uiVisible = true, currentZoom = 1.0, isDrawingMode = false, isFxMode = false;
        let annoColor = '#ccff00', annoSize = 7;
        let annotations = JSON.parse(localStorage.getItem('part_annos_v3') || '{}');
        let undoStack = [];
        let currentRotation = 0;  // 0, 90, 180, 270 — reset à chaque partition
        let zoomMemory = 1.0;     // Zoom conservé entre partitions d'un même set
        
        let tpCache = [];
        let startDist = 0;
        let startZoom = 1.0;

        // =====================================================================
        // NOUVEAU v7 — ÉTAT DE L'AUTO-SCROLL
        // =====================================================================
        // Le moteur repose sur requestAnimationFrame pour un défilement fluide
        // indépendant du taux de rafraîchissement de l'écran (60/120 Hz sur
        // iPad Pro/Air ProMotion notamment). La vitesse est exprimée en
        // pixels/seconde afin de rester cohérente quel que soit le framerate.
        let autoScrollOn = false;                 // état marche/arrêt
        let autoScrollSpeed = parseFloat(localStorage.getItem('part_autoscroll_speed') || '28'); // px/s
        let autoScrollChain = localStorage.getItem('part_autoscroll_chain') === '1'; // enchaîner la setlist en fin de page
        let autoScrollRAF = null;                 // handle requestAnimationFrame en cours
        let autoScrollLastTs = null;               // timestamp de la frame précédente
        let autoScrollPausedForDraw = false;      // vrai pendant un trait de dessin actif
        let autoScrollPausedForTouch = false;     // vrai pendant une interaction tactile manuelle (scroll/pinch)
        let autoScrollResumeTimer = null;         // timer de reprise différée après interaction manuelle
        let autoScrollProgrammatic = false;       // vrai pendant la frame où c'est NOUS qui modifions scrollTop
        const AUTOSCROLL_MIN = 6, AUTOSCROLL_MAX = 140; // bornes de vitesse (px/s)

        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

        function setLang(lang) {
            currentLang = lang; localStorage.setItem('part_lang', lang);
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                el.innerText = i18n[lang][key] || key;
            });
            document.querySelectorAll('.lang-switch').forEach(el => el.classList.remove('active'));
            document.getElementById('lang-' + lang).classList.add('active');
            renderLibrary();
            renderSavedSets();
            updateScanSupportHint();
        }

        const DB_NAME = "PartochesDB_Ultimate";
        async function openDB() { 
            return new Promise((r) => { 
                const req = indexedDB.open(DB_NAME, 1); 
                req.onupgradeneeded = (e) => e.target.result.createObjectStore("sources"); 
                req.onsuccess = (e) => r(req.result); 
            }); 
        }


        // =====================================================================
        // PARTOCHES v8 — IMPORT UNIFIÉ MULTI-PLATEFORME
        // =====================================================================
        // Objectifs :
        //  • PC : showDirectoryPicker quand disponible.
        //  • iPadOS / Android : webkitdirectory pour les dossiers si exposé,
        //    sinon sélection multiple de fichiers sans blocage.
        //  • Photos : sélection de la photothèque/caméra sans dépendre du
        //    File System Access API.
        //  • Chaque entrée garde son chemin relatif pour éviter les collisions
        //    entre deux partitions portant le même nom.
        // =====================================================================

        const SUPPORTED_SCORE_EXT = /\.(pdf|png|jpg|jpeg|webp)$/i;

        function getEntryDisplayName(file) {
            return file.webkitRelativePath || file.name;
        }

        function makeVirtualEntry(file) {
            const displayName = getEntryDisplayName(file);
            return {
                entry: {
                    name: displayName,
                    baseName: file.name,
                    relativePath: file.webkitRelativePath || file.name,
                    _blob: file,
                    kind: 'file',
                    getFile: () => Promise.resolve(file)
                }
            };
        }

        function mergeVirtualFiles(newFiles, sourceLabel) {
            const accepted = [];
            const seen = new Set(
                files.map(f => String(f.entry.relativePath || f.entry.name).toLowerCase())
            );

            for (const file of newFiles) {
                if (!SUPPORTED_SCORE_EXT.test(file.name)) continue;
                const key = String(file.webkitRelativePath || file.name).toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                accepted.push(makeVirtualEntry(file));
            }

            if (!accepted.length) {
                showToast(currentLang === 'fr'
                    ? 'Aucun PDF ou fichier image compatible.'
                    : 'No compatible PDF or image file.');
                return 0;
            }

            let src = sources.find(s => s._virtual && s.name === sourceLabel);
            if (!src) {
                src = { name: sourceLabel, _virtual: true, _files: [] };
                sources.push(src);
            }

            src._files = (src._files || []).concat(accepted);
            files.push(...accepted);
            renderLibrary();
            renderSourcesUI();

            showToast(currentLang === 'fr'
                ? `${accepted.length} fichier(s) ajouté(s)`
                : `${accepted.length} file(s) added`);

            return accepted.length;
        }

        function scanFilesEntry() {
            const input = document.getElementById('file-input-files');
            if (!input) return;
            input.value = '';
            input.onchange = () => {
                const chosen = Array.from(input.files || []);
                mergeVirtualFiles(chosen,
                    currentLang === 'fr' ? 'Fichiers sélectionnés' : 'Selected Files');
            };
            input.click();
        }

        function scanPhotosEntry() {
            const input = document.getElementById('file-input-photos');
            if (!input) return;
            input.value = '';
            input.onchange = () => {
                const chosen = Array.from(input.files || []);
                mergeVirtualFiles(chosen,
                    currentLang === 'fr' ? 'Photos' : 'Photos');
            };
            input.click();
        }

        async function scanFolderEntry() {
            // 1. Desktop Chromium / Android Chromium quand l'API est exposée.
            if (typeof window.showDirectoryPicker === 'function') {
                try {
                    const h = await window.showDirectoryPicker({ mode: 'read' });
                    if (sources.some(s => !s._virtual && s.name === h.name)) {
                        showToast(currentLang === 'fr'
                            ? 'Ce dossier est déjà ajouté.'
                            : 'This folder is already added.');
                        return;
                    }

                    const db = await openDB();
                    db.transaction("sources", "readwrite")
                        .objectStore("sources").put(h, h.name);

                    sources.push(h);
                    await refreshFiles();
                    showToast(currentLang === 'fr'
                        ? 'Dossier récursif ajouté ✓'
                        : 'Recursive folder added ✓');
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                    console.warn('[Partoches v8] showDirectoryPicker:', e);
                }
            }

            // 2. Fallback navigateur : webkitdirectory = sélection récursive.
            const input = document.getElementById('file-input-recursive');
            if (input) {
                input.value = '';
                input.onchange = () => {
                    const chosen = Array.from(input.files || []);
                    if (!chosen.length) return;
                    const count = mergeVirtualFiles(chosen,
                        currentLang === 'fr'
                            ? 'Dossier sélectionné'
                            : 'Selected Folder');

                    if (count) {
                        showToast(currentLang === 'fr'
                            ? `${count} fichier(s) importé(s) récursivement`
                            : `${count} file(s) imported recursively`);
                    }
                };
                input.click();
                return;
            }

            // 3. Dernier filet de sécurité.
            scanFilesEntry();
        }

        function updateScanSupportHint() {
            const el = document.getElementById('scan-support-hint');
            if (!el) return;

            const hasFS = typeof window.showDirectoryPicker === 'function';
            const hasWebkitDir = 'webkitdirectory' in document.createElement('input');

            let msg;
            if (hasFS) {
                msg = currentLang === 'fr'
                    ? 'Dossier natif + récursivité'
                    : 'Native folder + recursion';
            } else if (hasWebkitDir) {
                msg = currentLang === 'fr'
                    ? 'Dossier récursif via sélecteur système'
                    : 'Recursive folder via system picker';
            } else {
                msg = currentLang === 'fr'
                    ? 'Dossier non disponible : utilisez Fichiers / Photos'
                    : 'Folder unavailable: use Files / Photos';
            }

            el.textContent = msg;
        }

        // =====================================================================
        // v8 — PLEIN ÉCRAN + VERROUILLAGE DE VEILLE
        // =====================================================================
        let wakeLockHandle = null;

        async function requestWakeLock() {
            if (!('wakeLock' in navigator)) return false;
            try {
                wakeLockHandle = await navigator.wakeLock.request('screen');
                wakeLockHandle.addEventListener?.('release', () => {
                    wakeLockHandle = null;
                });
                return true;
            } catch (e) {
                console.warn('[Partoches] Wake Lock non disponible:', e);
                return false;
            }
        }

        async function releaseWakeLock() {
            if (!wakeLockHandle) return;
            try { await wakeLockHandle.release(); } catch (_) {}
            wakeLockHandle = null;
        }

        async function toggleFullscreen() {
            const target = document.getElementById('sec-view') || document.documentElement;
            try {
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    if (document.exitFullscreen) await document.exitFullscreen();
                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                } else {
                    if (target.requestFullscreen) {
                        await target.requestFullscreen({ navigationUI: 'hide' });
                    } else if (target.webkitRequestFullscreen) {
                        target.webkitRequestFullscreen();
                    } else {
                        // iOS Safari n'autorise pas le fullscreen générique de la même
                        // façon : on masque les barres de l'application et on utilise
                        // la hauteur visualViewport déjà corrigée.
                        document.body.classList.add('ios-fullscreen-fallback');
                        uiVisible = true;
                        showToast(currentLang === 'fr'
                            ? 'Mode lecture optimisé activé'
                            : 'Optimized reading mode enabled');
                    }
                }
                updateFullscreenButton();
            } catch (e) {
                console.warn('[Partoches] Fullscreen:', e);
                showToast(currentLang === 'fr'
                    ? 'Plein écran non autorisé par le navigateur'
                    : 'Fullscreen blocked by browser');
            }
        }

        function updateFullscreenButton() {
            const btn = document.getElementById('fullscreen-toggle');
            if (!btn) return;
            const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
            btn.innerText = active ? '⛶' : '⛶';
            btn.setAttribute('aria-pressed', String(active));
        }

        function resetViewerView() {
            currentZoom = 1.0;
            zoomMemory = 1.0;
            currentRotation = 0;
            updateZoomLabel();
            applyPageScales();
            applyRotation();
            const sc = document.getElementById('scroll-container');
            if (sc) {
                sc.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            }
            showToast(currentLang === 'fr' ? 'Vue réinitialisée' : 'View reset');
        }

        // =====================================================================
        // v8 — PRÉFÉRENCES DE LECTURE
        // =====================================================================
        const VIEW_PREFS_KEY = 'part_view_prefs_v8';

        function loadViewPreferences() {
            try {
                const p = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || '{}');
                if (Number.isFinite(p.zoom)) {
                    zoomMemory = Math.max(0.4, Math.min(3.5, p.zoom));
                    currentZoom = zoomMemory;
                }
                if (Number.isFinite(p.bright)) {
                    document.documentElement.style.setProperty('--page-bright', p.bright);
                }
                if (Number.isFinite(p.contrast)) {
                    document.documentElement.style.setProperty('--page-contrast', p.contrast);
                }
            } catch (e) {
                console.warn('[Partoches] Préférences invalides:', e);
            }
        }

        function saveViewPreferences() {
            try {
                const root = getComputedStyle(document.documentElement);
                localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify({
                    zoom: currentZoom,
                    bright: parseFloat(root.getPropertyValue('--page-bright')) || 1,
                    contrast: parseFloat(root.getPropertyValue('--page-contrast')) || 1
                }));
            } catch (_) {}
        }

        function updateZoomLabel() {
            const label = document.getElementById('zoom-level');
            if (label) label.textContent = Math.round(currentZoom * 100) + '%';
        }

        // Renforcement de adjustZoom existant sans supprimer sa logique.
        const _adjustZoomV7 = adjustZoom;
        adjustZoom = function(delta) {
            _adjustZoomV7(delta);
            updateZoomLabel();
            saveViewPreferences();
        };

        // Renforcement de updateFX existant : persistance des réglages.
        const _updateFXV7 = updateFX;
        updateFX = function(type, value) {
            _updateFXV7(type, value);
            saveViewPreferences();
        };

        // =====================================================================
        // v8 — RESTAURATION APRÈS RETOUR D'ARRIÈRE / SUSPENSION iPadOS
        // =====================================================================
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible') {
                setAppVH();
                if (autoScrollOn) {
                    await requestWakeLock();
                }
            } else {
                // Le navigateur peut suspendre requestAnimationFrame.
                autoScrollLastTs = null;
            }
        });

        document.addEventListener('fullscreenchange', updateFullscreenButton);
        document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

        // Recalage plus fin quand Safari change de hauteur sans déclencher resize.
        if (window.visualViewport) {
            window.visualViewport.addEventListener('scroll', setAppVH, { passive: true });
        }

        // =====================================================================
        // v8 — DIAGNOSTIC D'ENVIRONNEMENT, visible dans la console pour QA
        // =====================================================================
        function getPlatformProfile() {
            const ua = navigator.userAgent || '';
            const touch = navigator.maxTouchPoints || 0;
            const isIPad = /iPad/i.test(ua) ||
                (navigator.platform === 'MacIntel' && touch > 1);
            const isAndroid = /Android/i.test(ua);
            const largeTablet = Math.min(window.innerWidth, window.innerHeight) >= 768;
            return {
                iPad: isIPad,
                android: isAndroid,
                largeTablet,
                touchPoints: touch,
                dpr: window.devicePixelRatio || 1,
                viewport: `${window.innerWidth}x${window.innerHeight}`,
                visualViewport: window.visualViewport
                    ? `${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)}`
                    : null,
                fullscreen: !!(document.fullscreenEnabled || document.webkitFullscreenEnabled),
                directoryPicker: typeof window.showDirectoryPicker === 'function',
                webkitDirectory: 'webkitdirectory' in document.createElement('input')
            };
        }

        function logPlatformProfile() {
            console.info('[Partoches v8] Profil appareil:', getPlatformProfile());
        }


        // =====================================================================
        // v10 — IPAD STABLE INTERACTION EXTENSIONS
        // =====================================================================

        /*
         * Alphabet
         * --------
         * v8 already had generateAlphaBar(). We keep that function and wrap it
         * only to make regeneration safe and the targets touch-friendly.
         */
        function refreshAlphaBarV10() {
            const bar = document.getElementById('alpha-bar');
            if (!bar) return;
            const previous = bar.dataset.v10Ready === '1';
            if (!previous) bar.dataset.v10Ready = '1';

            // Rebuild only when the bar is empty. This avoids duplicate letters
            // if the original v8 init calls generateAlphaBar more than once.
            if (bar.children.length === 0) {
                "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('').forEach(letter => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.innerText = letter;
                    b.setAttribute('aria-label',
                        (currentLang === 'fr' ? 'Aller aux partitions commençant par ' :
                         'Go to scores beginning with ') + letter);
                    b.onclick = () => {
                        renderLibrary(letter);
                        requestAnimationFrame(() => {
                            const first = document.querySelector('#library-list .file-row');
                            if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        });
                    };
                    bar.appendChild(b);
                });
            }
        }

        // Keep the original renderLibrary and simply make the alpha bar resilient.
        function installAlphaResilienceV10() {
            refreshAlphaBarV10();
            if (typeof renderLibrary === 'function' && !renderLibrary.__v10AlphaWrapped) {
                const originalRenderLibraryV10 = renderLibrary;
                const wrappedRenderLibraryV10 = function(...args) {
                    const result = originalRenderLibraryV10.apply(this, args);
                    requestAnimationFrame(refreshAlphaBarV10);
                    return result;
                };
                wrappedRenderLibraryV10.__v10AlphaWrapped = true;
                renderLibrary = wrappedRenderLibraryV10;
            }
        }

        /*
         * Drag & Drop
         * -----------
         * Desktop: normal dragover/drop.
         * iPadOS: Safari can receive a file dragged from the Files app when the
         * browser surface advertises a drop target. We never replace the
         * existing file pickers; this is an additional route.
         */
        function createV10DropHint() {
            if (document.getElementById('v10-drop-hint')) return;
            const hint = document.createElement('div');
            hint.id = 'v10-drop-hint';
            hint.className = 'v10-drop-hint';
            hint.textContent = currentLang === 'fr'
                ? 'RELÂCHER POUR IMPORTER'
                : 'DROP TO IMPORT';
            document.body.appendChild(hint);
        }

        async function importDroppedFilesV10(fileList) {
            const list = Array.from(fileList || []);
            if (!list.length) return;

            const accepted = list.filter(file => {
                const n = file.name.toLowerCase();
                return /\.(pdf|png|jpe?g|webp)$/i.test(n);
            });

            if (!accepted.length) {
                showToast(currentLang === 'fr'
                    ? 'Aucun PDF ou fichier image compatible.'
                    : 'No compatible PDF or image file.');
                return;
            }

            // Use the application's existing merge/import pipeline.
            await mergeVirtualFiles(accepted,
                currentLang === 'fr' ? 'Glisser-déposer' : 'Drag & Drop');
            requestAnimationFrame(() => {
                refreshAlphaBarV10();
                renderLibrary('');
            });
        }

        function installDragDropV10() {
            if (document.body.dataset.v10DndReady === '1') return;
            document.body.dataset.v10DndReady = '1';
            createV10DropHint();

            const targets = [
                document.getElementById('sec-lib'),
                document.getElementById('library-list'),
                document.getElementById('source-list')
            ].filter(Boolean);

            let dragDepth = 0;

            targets.forEach(target => {
                target.addEventListener('dragenter', e => {
                    if (!e.dataTransfer) return;
                    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
                    e.preventDefault();
                    dragDepth++;
                    target.classList.add('v10-drag-over');
                    document.body.classList.add('v10-drop-active');
                });

                target.addEventListener('dragover', e => {
                    if (!e.dataTransfer) return;
                    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    target.classList.add('v10-drag-over');
                    document.body.classList.add('v10-drop-active');
                });

                target.addEventListener('dragleave', e => {
                    dragDepth = Math.max(0, dragDepth - 1);
                    if (dragDepth === 0) {
                        targets.forEach(t => t.classList.remove('v10-drag-over'));
                        document.body.classList.remove('v10-drop-active');
                    }
                });

                target.addEventListener('drop', async e => {
                    e.preventDefault();
                    dragDepth = 0;
                    targets.forEach(t => t.classList.remove('v10-drag-over'));
                    document.body.classList.remove('v10-drop-active');
                    await importDroppedFilesV10(e.dataTransfer?.files);
                });
            });

            window.addEventListener('dragend', () => {
                dragDepth = 0;
                targets.forEach(t => t.classList.remove('v10-drag-over'));
                document.body.classList.remove('v10-drop-active');
            }, { passive: true });
        }

        /*
         * Pinch
         * -----
         * v8 already implements pinch. The important v10 change is not to replace
         * it: we restore Safari's gesture arbitration via CSS and add a very
         * small, non-invasive fallback for browsers that expose Pointer Events
         * but deliver incomplete TouchEvent sequences.
         */
        function installPinchFallbackV10() {
            const el = document.getElementById('scroll-container');
            if (!el || el.dataset.v10PinchReady === '1') return;
            el.dataset.v10PinchReady = '1';

            let active = false;
            let baseDistance = 0;
            let baseZoom = 1;

            const distance = (a, b) =>
                Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

            el.addEventListener('touchstart', e => {
                if (e.touches.length !== 2) return;
                active = true;
                baseDistance = distance(e.touches[0], e.touches[1]);
                baseZoom = currentZoom;
            }, { passive: true });

            el.addEventListener('touchmove', e => {
                if (!active || e.touches.length !== 2 || !baseDistance) return;

                const factor = distance(e.touches[0], e.touches[1]) / baseDistance;
                const next = Math.max(.5, Math.min(3.0, baseZoom * factor));

                // The original setupPinchZoom remains the primary implementation.
                // Only use this fallback when its zoom value has not changed yet.
                if (Math.abs(currentZoom - baseZoom) < 0.0001) {
                    currentZoom = next;
                    applyPageScales();
                }
            }, { passive: true });

            const stop = () => {
                active = false;
                baseDistance = 0;
            };
            el.addEventListener('touchend', stop, { passive: true });
            el.addEventListener('touchcancel', stop, { passive: true });
        }

        /*
         * Native scroll
         * -------------
         * Do not implement a fake scroll loop: Safari's native scroll is smoother
         * and integrates correctly with momentum scrolling. This layer merely
         * makes the intended surface explicit and restores wheel behavior.
         */
        function installNativeScrollV10() {
            const el = document.getElementById('scroll-container');
            if (!el || el.dataset.v10ScrollReady === '1') return;
            el.dataset.v10ScrollReady = '1';

            el.style.overflow = 'auto';
            el.style.webkitOverflowScrolling = 'touch';
            el.style.touchAction = 'pan-x pan-y pinch-zoom';

            el.addEventListener('wheel', e => {
                // Keep v8's handleWheel() as the main wheel handler.
                // This is only a safety path for trackpads/browsers where the
                // inline handler is not invoked.
                if (typeof handleWheel !== 'function') {
                    el.scrollTop += e.deltaY;
                    el.scrollLeft += e.deltaX;
                }
            }, { passive: true });

            // iPad Safari: after a viewport/URL-bar resize, explicitly restore
            // the scroll surface without changing the current scroll position.
            const restoreScrollSurface = () => {
                const top = el.scrollTop;
                const left = el.scrollLeft;
                requestAnimationFrame(() => {
                    el.style.overflow = 'auto';
                    el.scrollTop = top;
                    el.scrollLeft = left;
                });
            };
            window.addEventListener('orientationchange', restoreScrollSurface, { passive: true });
            window.visualViewport?.addEventListener('resize', restoreScrollSurface, { passive: true });
        }

        function installV10StableIPadLayer() {
            installAlphaResilienceV10();
            installDragDropV10();
            installPinchFallbackV10();
            installNativeScrollV10();
        }


        async function init() {
            setLang(currentLang);
            loadViewPreferences();
            updateScanSupportHint();
            logPlatformProfile();

            // Adapter le label du bouton selon le support de l'API
            const btnScan = document.querySelector('[data-i18n="btn_scan"]');
            if (typeof window.showDirectoryPicker === 'undefined') {
                // iOS Safari ou navigateur sans File System Access API
                btnScan.setAttribute('data-i18n-ios', '1');
                const iosLabel = { fr: '+ Ajouter Fichiers', en: '+ Add Files' };
                btnScan.innerText = iosLabel[currentLang];
                btnScan.title = currentLang === 'fr'
                    ? 'Sur iOS, sélectionnez des fichiers individuels (PDF, images)'
                    : 'On iOS, select individual files (PDF, images)';
            }

            const db = await openDB();
            const req = db.transaction("sources", "readonly").objectStore("sources").getAll();
            req.onsuccess = async () => { 
                sources = req.result; 
                if(sources.length > 0) {
                    try {
                        let needsReauth = false;
                        for(const h of sources) { 
                            if (!h._virtual) {
                                const perm = await h.queryPermission({ mode: 'read' });
                                if(perm !== 'granted') needsReauth = true;
                            }
                        }
                        if (needsReauth) document.getElementById('btn-restore').classList.remove('hidden');
                        await refreshFiles();
                    } catch(e) { console.error("Restauration échouée:", e); }
                }
            };
            renderSavedSets();
            generateAlphaBar();
            setupPinchZoom();
            setupAutoScrollGuards();
            initViewportHeightFix();

            // v10: additive iPad/Android stability layer. Original v8 handlers
            // remain active; these only restore the browser gesture surface.
            requestAnimationFrame(installV10StableIPadLayer);

            // Restaurer les préférences d'auto-scroll (vitesse + enchaînement)
            const speedSlider = document.getElementById('autoscroll-speed-slider');
            if (speedSlider) { speedSlider.value = autoScrollSpeed; setAutoScrollSpeed(autoScrollSpeed); }
            const chainBox = document.getElementById('autoscroll-chain');
            if (chainBox) chainBox.checked = autoScrollChain;
            
            new Sortable(document.getElementById('sidebar-items'), {
                animation: 180,
                onEnd: function (evt) {
                    const movedItem = setFiles.splice(evt.oldIndex, 1)[0];
                    setFiles.splice(evt.newIndex, 0, movedItem);
                    if (currentIndex === evt.oldIndex) {
                        currentIndex = evt.newIndex;
                    } else if (currentIndex > evt.oldIndex && currentIndex <= evt.newIndex) {
                        currentIndex--;
                    } else if (currentIndex < evt.oldIndex && currentIndex >= evt.newIndex) {
                        currentIndex++;
                    }
                    document.getElementById('page-info').innerText = (currentIndex + 1) + " / " + setFiles.length;
                    renderSidebar();
                }
            });
            
            // Réaligner l'UI mobile lors d'un changement d'orientation
            window.addEventListener("orientationchange", () => {
                setTimeout(() => { setAppVH(); applyPageScales(); }, 350);
            });
            window.addEventListener("resize", () => {
                setTimeout(() => { setAppVH(); applyPageScales(); }, 100);
            });

            // NOUVEAU v7 : recalcule --app-vh quand le clavier virtuel Android
            // apparaît/disparaît ou que la barre Safari se rétracte au scroll,
            // via visualViewport si disponible (bien supporté iPadOS/Android récents).
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', () => setAppVH());
            }
        }

        // =====================================================================
        // NOUVEAU v7 — CORRECTIF DE HAUTEUR DE VIEWPORT iOS/ANDROID
        // =====================================================================
        // Le fameux problème "100vh" sur mobile : les barres d'adresse
        // rétractables de Safari iOS et Chrome Android changent la hauteur
        // réelle disponible sans redéclencher un vrai "resize" fiable, ce qui
        // provoque un contenu tronqué ou un espace blanc en bas d'écran.
        // Solution standard : mesurer window.innerHeight en JS et l'exposer
        // comme variable CSS --app-vh (1% de la hauteur réelle), utilisée à
        // la place de 100vh partout où c'est critique (voir <style> plus haut).
        function setAppVH() {
            const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.01;
            document.documentElement.style.setProperty('--app-vh', vh + 'px');
        }
        function initViewportHeightFix() {
            setAppVH();
            window.addEventListener('resize', setAppVH);
        }

        // --- AJOUT DE SOURCE AVEC FALLBACK iOS/SAFARI ---
        // showDirectoryPicker n'est pas disponible sur iOS Safari.
        // Sur iOS, on propose un input file multiple comme alternative.
        async function addSource() {
            // Vérification support File System Access API
            if (typeof window.showDirectoryPicker === 'undefined') {
                // Fallback iOS/Safari : sélection multiple de fichiers
                addSourceFallbackIOS();
                return;
            }
            try {
                const h = await window.showDirectoryPicker({ mode: 'read' });
                if(sources.find(s => s.name === h.name)) {
                    alert(currentLang === 'fr' ? "Ce dossier est déjà ajouté." : "This folder is already added.");
                    return;
                }
                const db = await openDB();
                db.transaction("sources", "readwrite").objectStore("sources").put(h, h.name);
                sources.push(h);
                await refreshFiles();
            } catch(e) {
                if (e.name === 'AbortError') return; // Utilisateur a annulé
                // Erreur inattendue → proposer le fallback
                if (confirm(
                    currentLang === 'fr'
                        ? "Impossible d'accéder aux dossiers dans ce navigateur.\nVoulez-vous sélectionner vos fichiers manuellement ?"
                        : "Cannot access folders in this browser.\nDo you want to select your files manually?"
                )) {
                    addSourceFallbackIOS();
                }
            }
        }

        // Fallback : input file multiple pour iOS Safari et navigateurs sans File System Access API
        function addSourceFallbackIOS() {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf';
            input.style.display = 'none';
            document.body.appendChild(input);
            input.onchange = async () => {
                if (!input.files || input.files.length === 0) { input.remove(); return; }
                const newFiles = [];
                for (const file of input.files) {
                    if (file.name.match(/\.(pdf|png|jpg|jpeg|webp)$/i)) {
                        // Créer un objet compatible avec le reste du code
                        newFiles.push({ entry: { name: file.name, _blob: file, getFile: () => Promise.resolve(file) } });
                    }
                }
                // Source virtuelle pour le fallback
                const virtualSourceName = currentLang === 'fr' ? 'Fichiers sélectionnés' : 'Selected Files';
                // Ajouter une source fictive pour l'affichage
                if (!sources.find(s => s.name === virtualSourceName)) {
                    sources.push({ name: virtualSourceName, _virtual: true, _files: [] });
                }
                const vsrc = sources.find(s => s.name === virtualSourceName);
                vsrc._files = (vsrc._files || []).concat(newFiles);
                files.push(...newFiles);
                renderLibrary();
                renderSourcesUI();
                input.remove();
                if (newFiles.length > 0) {
                    const msg = currentLang === 'fr'
                        ? `${newFiles.length} fichier(s) ajouté(s) avec succès.`
                        : `${newFiles.length} file(s) added successfully.`;
                    // Feedback visuel subtil
                    const banner = document.createElement('div');
                    banner.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:var(--neon-lime);color:#000;font-weight:bold;font-size:11px;padding:8px 20px;border-radius:6px;z-index:9999;letter-spacing:1px;';
                    banner.innerText = msg;
                    document.body.appendChild(banner);
                    setTimeout(() => banner.remove(), 2500);
                }
            };
            input.click();
        }

        async function removeSource(name) {
            if(!confirm(currentLang === 'fr' ? "Supprimer l'accès à ce dossier ?" : "Remove access to this folder?")) return;
            const src = sources.find(s => s.name === name);
            if (src && !src._virtual) {
                // Source réelle File System Access API
                const db = await openDB();
                db.transaction("sources", "readwrite").objectStore("sources").delete(name);
            }
            sources = sources.filter(s => s.name !== name);
            await refreshFiles();
        }

        async function refreshFiles() {
            files = [];
            // Activer le pré-cache contenu sur mobile (handles FileSystem Access stables pendant le scan)
            mobilePrecacheEnabled = shouldPrecacheOnMobile();
            if (mobilePrecacheEnabled) {
                console.log('[Partoches] Mode pré-cache mobile activé — lecture anticipée des fichiers');
            }
            for(const h of sources) {
                try {
                    if (h._virtual) {
                        // Source iOS fallback : fichiers déjà en mémoire
                        if (h._files) files.push(...h._files);
                    } else {
                        const results = await scanFolder(h);
                        files.push(...results);
                    }
                } catch(e) { console.warn("Dossier inaccessible", h.name, e); }
            }
            renderLibrary();
            renderSourcesUI();
        }

        async function scanFolder(handle) {
            // Déléguer au scanner avec cache pour permettre le re-scan sur NotFoundError
            return scanFolderWithCache(handle, null);
        }

        function renderSourcesUI() {
            const container = document.getElementById('source-list'); container.innerHTML = '';
            sources.forEach(s => {
                const tag = document.createElement('div'); tag.className = 'source-tag';
                tag.innerHTML = `${s.name} <span class="source-delete" onclick="removeSource('${s.name}')">✕</span>`;
                container.appendChild(tag);
            });
        }

        async function restoreAccess() {
            try {
                for(const h of sources) { 
                    if (!h._virtual) await h.requestPermission({ mode: 'read' }); 
                }
                document.getElementById('btn-restore').classList.add('hidden');
                refreshFiles();
            } catch(e) { 
                alert(currentLang === 'fr' ? "Permission refusée." : "Permission denied."); 
            }
        }

        function renderLibrary(filter = '') {
            const l = document.getElementById('library-list'); l.innerHTML = '';
            files.filter(x => !filter || x.entry.name.toUpperCase().startsWith(filter))
                 .sort((a,b) => a.entry.name.localeCompare(b.entry.name))
                 .forEach(file => {
                    const row = document.createElement('div');
                    row.className = "file-row flex justify-between items-center p-3 px-4";
                    row.innerHTML = `<div class="flex-grow font-medium text-zinc-300 text-[12px] truncate pr-4" onclick="viewSingle('${file.entry.name.replace(/'/g, "\\'")}')">${file.entry.name}</div>
                                     <button onclick="handleSelectLibraryItem(this, '${file.entry.name.replace(/'/g, "\\'")}')" class="btn-jazz !py-1 transition-all duration-200">${i18n[currentLang].btn_add}</button>`;
                    l.appendChild(row);
                 });
        
            if (typeof refreshAlphaBarV10 === 'function') requestAnimationFrame(refreshAlphaBarV10);
        }

        function handleSelectLibraryItem(buttonEl, filename) {
            addToSet(filename);
            buttonEl.classList.add('btn-add-success');
            const originalText = buttonEl.innerText;
            buttonEl.innerText = currentLang === 'fr' ? "Ajouté ✔" : "Added ✔";
            setTimeout(() => {
                buttonEl.classList.remove('btn-add-success');
                buttonEl.innerText = originalText;
            }, 800);
        }

        function generateAlphaBar() {
            const bar = document.getElementById('alpha-bar');
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('').forEach(l => {
                const b = document.createElement('button'); b.innerText = l;
                b.onclick = () => renderLibrary(l); bar.appendChild(b);
            });
        }

        function addToSet(name) {
            const div = document.createElement('div');
            div.className = "flex justify-between items-center bg-[#141419] p-3 mb-2 rounded border border-white/5 cursor-move";
            div.dataset.name = name;
            div.innerHTML = `<span class="text-[11px] text-zinc-300 font-bold truncate pr-3">${name}</span> 
                             <button onclick="this.parentElement.remove()" class="text-pink-500 font-bold px-2">✕</button>`;
            document.getElementById('set-list-current').appendChild(div);
            new Sortable(document.getElementById('set-list-current'), { animation: 150 });
        }

        function saveCurrentSet() {
            const name = prompt(currentLang === 'fr' ? "Nom de la Setlist :" : "Setlist Name :");
            if (!name) return;
            const items = Array.from(document.getElementById('set-list-current').children).map(c => c.dataset.name);
            localStorage.setItem('part_set_' + name, JSON.stringify(items));
            renderSavedSets();
        }

        function clearCurrentSet() { if(confirm("Vider la liste actuelle ?")) document.getElementById('set-list-current').innerHTML = ''; }

        function renderSavedSets() {
            const list = document.getElementById('saved-sets-list'); list.innerHTML = '';
            Object.keys(localStorage).filter(k => k.startsWith('part_set_')).forEach(key => {
                const name = key.replace('part_set_', '');
                const div = document.createElement('div');
                div.className = "flex justify-between items-center bg-zinc-900/30 border border-white/5 p-3 rounded";
                div.innerHTML = `<div class="font-bold text-lime-400 cursor-pointer text-[11px] truncate pr-4" onclick="loadSet('${key}')">${name}</div>
                                 <button onclick="deleteSet('${key}')" class="text-zinc-600 hover:text-white transition uppercase text-[9px] font-bold">Supprimer</button>`;
                list.appendChild(div);
            });
        }

        function deleteSet(key) { if(confirm("Supprimer ce set ?")) { localStorage.removeItem(key); renderSavedSets(); } }

        function loadSet(key) {
            const names = JSON.parse(localStorage.getItem(key));
            setFiles = []; document.getElementById('set-list-current').innerHTML = '';
            names.forEach(n => {
                const f = files.find(file => file.entry.name === n);
                if (f) { setFiles.push(f); addToSet(n); }
            });
            if (setFiles.length > 0) { currentIndex = 0; openFile(setFiles[0]); }
        }

        // --- CONSERVATION DU ZOOM ENTRE PARTITIONS DU MÊME SET ---
        // On conserve le zoom courant lors de la navigation entre partitions
        // --- DÉTECTION MOBILE ROBUSTE ---
        function isMobilePlatform() {
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                || (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform)); // iPad iOS 13+
        }

        // =====================================================================
        // COUCHE D'ABSTRACTION LECTURE FICHIER — ROBUSTE MULTI-PLATEFORME
        // =====================================================================
        //
        // Diagnostic de l'erreur "NotFoundError" sur mobile :
        //
        //  Sur Chrome Android et iOS Safari avec l'API File System Access,
        //  un FileSystemFileHandle peut devenir "stale" (périmé) dès lors que :
        //   • La page a été mise en arrière-plan quelques secondes
        //   • L'application a été suspendue par l'OS mobile (économie batterie)
        //   • La permission d'accès au dossier a expiré silencieusement
        //   • Un autre onglet a verrouillé le fichier (rare, mais possible)
        //
        //  Dans ce cas, fileHandle.getFile() lève NotFoundError même si le fichier
        //  existe bien sur le disque. C'est un bug/comportement documenté des
        //  navigateurs mobiles avec l'Origin Private File System.
        //
        //  STRATÉGIE DE RÉSOLUTION EN 3 NIVEAUX :
        //   1. Vérifier/redemander la permission sur le handle parent (dossier source)
        //   2. Relancer getFile() après un délai court (le navigateur peut avoir besoin
        //      d'un tick pour rafraîchir le handle)
        //   3. Si toujours NotFoundError : re-scanner le dossier source pour obtenir
        //      un handle frais sur le même fichier, par nom
        //
        // =====================================================================

        // =====================================================================
        // STRATÉGIE CACHE CONTENU FICHIER POUR MOBILE
        // =====================================================================
        //
        //  Sur Android Chrome avec l'API File System Access, un FileSystemFileHandle
        //  devient invalide ("stale") entre deux ouvertures de fichier dans la session,
        //  notamment après que l'OS a suspendu le processus ou que la permission
        //  a expiré silencieusement. Le résultat : NotFoundError dans FileReader.
        //
        //  SOLUTION DÉFINITIVE :
        //  Sur mobile, on lit le contenu de chaque fichier IMMÉDIATEMENT lors du scan
        //  initial (pendant que la permission est fraîche) et on le met en cache en RAM.
        //  Lors de l'affichage, on utilise ce cache plutôt que de re-lire le handle.
        //
        //  Sur PC, on ne fait PAS ce pré-chargement (inutile et coûteux en mémoire
        //  pour de grandes bibliothèques) : les handles y restent stables.
        //
        //  Cache structure : Map<fileName, { arrayBuffer?: ArrayBuffer, dataUrl?: string }>
        // =====================================================================
        const fileContentCache = new Map();
        const fileHandleParentCache = new Map(); // Map<fileName, { dirHandle, sourceHandle }>
        let mobilePrecacheEnabled = false; // activé uniquement sur mobile après détection

        // Détecte si on est sur mobile et active le pré-cache si nécessaire
        function shouldPrecacheOnMobile() {
            return isMobilePlatform() && typeof window.showDirectoryPicker !== 'undefined';
        }

        // Pré-lit le contenu d'un fichier et le met en cache (mobile uniquement)
        async function precacheFileContent(entry) {
            if (!mobilePrecacheEnabled) return;
            if (fileContentCache.has(entry.name)) return; // déjà en cache

            try {
                const file = await entry.getFile();
                const isPdf = entry.name.toLowerCase().endsWith('.pdf');
                if (isPdf) {
                    const buf = await file.arrayBuffer();
                    fileContentCache.set(entry.name, { arrayBuffer: buf, type: 'pdf' });
                } else {
                    // Pour les images : dataURL via FileReader
                    const dataUrl = await new Promise((res, rej) => {
                        const fr = new FileReader();
                        fr.onload  = e => res(e.target.result);
                        fr.onerror = e => rej(e.target.error);
                        fr.readAsDataURL(file);
                    });
                    fileContentCache.set(entry.name, { dataUrl, type: 'image' });
                }
                console.log('[Partoches] Pré-cache OK:', entry.name);
            } catch (e) {
                // Pré-cache échoue silencieusement : sera retentée à l'ouverture
                console.warn('[Partoches] Pré-cache échoué pour', entry.name, e.name);
            }
        }

        // Scanner récursif avec cache de dossier parent ET pré-cache contenu sur mobile
        async function scanFolderWithCache(handle, parentHandle) {
            const results = [];
            for await (const entry of handle.values()) {
                if (entry.kind === 'file' && entry.name.match(/\.(pdf|png|jpg|jpeg|webp)$/i)) {
                    results.push({ entry });
                    // Mémoriser le dossier contenant ce fichier (pour re-scan sur NotFoundError)
                    fileHandleParentCache.set(entry.name, { dirHandle: handle, sourceHandle: parentHandle || handle });
                    // Sur mobile : pré-lire le contenu pendant que la permission est fraîche
                    if (mobilePrecacheEnabled) {
                        await precacheFileContent(entry);
                    }
                } else if (entry.kind === 'directory') {
                    results.push(...(await scanFolderWithCache(entry, parentHandle || handle)));
                }
            }
            return results;
        }

        // Tenter de retrouver un handle frais par re-scan du dossier parent
        async function refreshFileHandle(fileName) {
            const cached = fileHandleParentCache.get(fileName);
            if (!cached) return null;
            try {
                // Re-scanner uniquement le dossier direct contenant le fichier
                for await (const entry of cached.dirHandle.values()) {
                    if (entry.kind === 'file' && entry.name === fileName) {
                        console.log('[Partoches] Handle rafraîchi via re-scan pour:', fileName);
                        return entry;
                    }
                }
            } catch (e) {
                console.warn('[Partoches] Re-scan échoué:', e);
            }
            return null;
        }

        // Lecture robuste d'un File depuis un FileSystemFileHandle avec cache + retry + re-scan
        // Ordre de priorité :
        //   1. Cache contenu (mobile pré-cache) → pas besoin de handle du tout
        //   2. getFile() direct → fonctionne si handle encore valide
        //   3. Re-permission + retry → handle redevient valide après permission
        //   4. Re-scan dossier parent → nouveau handle frais
        async function getFileRobust(fileEntry) {
            // Priorité 0 : blob direct (fallback iOS sans File System Access API)
            if (fileEntry._blob) return fileEntry._blob;

            // Priorité 1 : CACHE CONTENU MOBILE
            // Si le contenu a été pré-lu lors du scan, on retourne un File synthétique
            // construit depuis le cache — aucun handle nécessaire, aucun NotFoundError possible
            if (mobilePrecacheEnabled && fileContentCache.has(fileEntry.name)) {
                const cached = fileContentCache.get(fileEntry.name);
                console.log('[Partoches] Lecture depuis cache mobile:', fileEntry.name);
                // Reconstruire un File depuis le cache pour que FileReader puisse le lire
                if (cached.type === 'pdf' && cached.arrayBuffer) {
                    const blob = new Blob([cached.arrayBuffer], { type: 'application/pdf' });
                    return new File([blob], fileEntry.name, { type: 'application/pdf' });
                }
                if (cached.type === 'image' && cached.dataUrl) {
                    // Décoder le dataURL → Blob → File
                    const res    = await fetch(cached.dataUrl);
                    const blob   = await res.blob();
                    return new File([blob], fileEntry.name, { type: blob.type });
                }
            }

            // Priorité 2 : lecture directe du handle (comportement normal, PC et mobile frais)
            try {
                const file = await fileEntry.getFile();
                if (file && file.size >= 0) return file;
            } catch (err1) {
                console.warn('[Partoches] getFile() tentative 1 échouée:', err1.name, err1.message);

                if (err1.name === 'NotFoundError' || err1.name === 'SecurityError' || err1.name === 'NotAllowedError') {

                    // Priorité 3 : re-demander la permission sur les sources parentes
                    for (const src of sources) {
                        if (src._virtual) continue;
                        try {
                            const perm = await src.queryPermission({ mode: 'read' });
                            if (perm !== 'granted') {
                                console.log('[Partoches] Re-demande permission pour:', src.name);
                                await src.requestPermission({ mode: 'read' });
                            }
                        } catch (permErr) {
                            console.warn('[Partoches] requestPermission échoué:', permErr);
                        }
                    }

                    // Délai court : laisser le navigateur traiter la permission
                    await new Promise(r => setTimeout(r, 150));

                    // Retry après permission
                    try {
                        const file = await fileEntry.getFile();
                        if (file && file.size >= 0) {
                            console.log('[Partoches] getFile() OK après re-permission');
                            // Mettre à jour le cache pour la prochaine fois
                            if (mobilePrecacheEnabled) precacheFileContent(fileEntry);
                            return file;
                        }
                    } catch (err2) {
                        console.warn('[Partoches] getFile() tentative 2 échouée:', err2.name);

                        // Priorité 4 : re-scan du dossier parent → handle neuf
                        const freshHandle = await refreshFileHandle(fileEntry.name);
                        if (freshHandle) {
                            try {
                                const file = await freshHandle.getFile();
                                if (file && file.size >= 0) {
                                    console.log('[Partoches] getFile() OK via handle frais (re-scan)');
                                    // Mettre à jour le handle dans setFiles
                                    const idx = setFiles.findIndex(f => f.entry.name === fileEntry.name);
                                    if (idx >= 0) setFiles[idx].entry = freshHandle;
                                    // Pré-cacher le contenu pour éviter une 5ème tentative
                                    if (mobilePrecacheEnabled) await precacheFileContent(freshHandle);
                                    return file;
                                }
                            } catch (err3) {
                                console.error('[Partoches] Toutes tentatives épuisées:', err3);
                                throw new Error(`NotFoundError: impossible d'accéder à "${fileEntry.name}" — ${err3.message}`);
                            }
                        }

                        throw new Error(`NotFoundError: "${fileEntry.name}" inaccessible — ${err2.message}`);
                    }
                } else {
                    throw err1;
                }
            }
        }

        // Lit un fichier et retourne un ArrayBuffer
        // Optimisation mobile : utilise directement le cache ArrayBuffer si disponible
        // (évite le round-trip File → FileReader → ArrayBuffer)
        async function readFileAsArrayBuffer(fileEntry) {
            // Court-circuit pour les PDF en cache mobile : ArrayBuffer déjà disponible
            if (mobilePrecacheEnabled && fileContentCache.has(fileEntry.name)) {
                const cached = fileContentCache.get(fileEntry.name);
                if (cached.type === 'pdf' && cached.arrayBuffer) {
                    console.log('[Partoches] PDF depuis cache ArrayBuffer direct:', fileEntry.name);
                    // Copie obligatoire : pdfjsLib transfère le buffer (detach)
                    return cached.arrayBuffer.slice(0);
                }
            }
            const file = await getFileRobust(fileEntry);
            // Utiliser file.arrayBuffer() si disponible (plus rapide que FileReader)
            if (typeof file.arrayBuffer === 'function') {
                try {
                    return await file.arrayBuffer();
                } catch (e) {
                    // Fallback FileReader si arrayBuffer() échoue (Safari < 14)
                }
            }
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = (e) => resolve(e.target.result);
                reader.onerror = (e) => {
                    const errName = e.target.error ? e.target.error.name : 'unknown';
                    const errMsg  = e.target.error ? e.target.error.message : 'FileReader error';
                    reject(new Error(`FileReader [${errName}]: ${errMsg}`));
                };
                reader.onabort = () => reject(new Error('FileReader: lecture annulée'));
                reader.readAsArrayBuffer(file);
            });
        }

        // Lit un fichier et retourne une base64 dataURL
        // Optimisation mobile : utilise directement le cache dataUrl si disponible
        async function readFileAsDataURL(fileEntry) {
            // Court-circuit pour les images en cache mobile : dataURL déjà disponible
            if (mobilePrecacheEnabled && fileContentCache.has(fileEntry.name)) {
                const cached = fileContentCache.get(fileEntry.name);
                if (cached.type === 'image' && cached.dataUrl) {
                    console.log('[Partoches] Image depuis cache dataURL direct:', fileEntry.name);
                    return cached.dataUrl;
                }
            }
            const file = await getFileRobust(fileEntry);
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = (e) => resolve(e.target.result);
                reader.onerror = (e) => {
                    const errName = e.target.error ? e.target.error.name : 'unknown';
                    const errMsg  = e.target.error ? e.target.error.message : 'FileReader error';
                    reject(new Error(`FileReader [${errName}]: ${errMsg}`));
                };
                reader.onabort = () => reject(new Error('FileReader: lecture annulée'));
                reader.readAsDataURL(file);
            });
        }

        // --- AFFICHAGE DU SPINNER DE CHARGEMENT ---
        function showLoadingSpinner(container, label) {
            const msg = label || (currentLang === 'fr' ? 'Chargement...' : 'Loading...');
            container.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;gap:20px;">
                    <div style="width:48px;height:48px;border:3px solid #1a1a22;border-top-color:var(--neon-lime);
                                border-radius:50%;animation:spin 0.75s linear infinite;"></div>
                    <div style="color:var(--neon-lime);font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">${msg}</div>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>`;
        }

        // --- AFFICHAGE D'UNE ERREUR AVEC DIAGNOSTIC ET ACTIONS ---
        function showFileError(container, err, fileName) {
            console.error('[Partoches] Erreur lecture fichier:', fileName, err);

            const isNotFound   = err.message && (err.message.includes('NotFoundError') || err.message.includes('NotFound'));
            const isPermission = err.message && (err.message.includes('NotAllowedError') || err.message.includes('SecurityError') || err.message.includes('permission'));
            const isMem        = err.message && (err.message.includes('out of memory') || err.message.includes('QuotaExceeded'));

            let title, detail, action = '';
            if (isNotFound) {
                title  = currentLang === 'fr' ? 'Fichier introuvable' : 'File not found';
                detail = currentLang === 'fr'
                    ? `Le handle du fichier "<b>${fileName}</b>" est devenu invalide. Cela arrive sur mobile quand l'appli a été mise en veille. Retournez au Répertoire et réouvrez le fichier.`
                    : `The file handle for "<b>${fileName}</b>" became invalid. This happens on mobile when the app was suspended. Go back to Library and reopen the file.`;
                action = `<button onclick="switchTab('lib')" class="btn-jazz" style="margin-top:10px;">
                            ${currentLang === 'fr' ? '→ Répertoire' : '→ Library'}
                          </button>`;
            } else if (isPermission) {
                title  = currentLang === 'fr' ? 'Permission expirée' : 'Permission expired';
                detail = currentLang === 'fr'
                    ? 'L\'accès au dossier a expiré. Appuyez sur "Rétablir Accès" pour continuer.'
                    : 'Folder access has expired. Press "Restore Access" to continue.';
                action = `<button onclick="switchTab('lib'); document.getElementById('btn-restore').classList.remove('hidden')" class="btn-jazz" style="margin-top:10px;">
                            ${currentLang === 'fr' ? '→ Rétablir Accès' : '→ Restore Access'}
                          </button>`;
            } else if (isMem) {
                title  = currentLang === 'fr' ? 'Mémoire insuffisante' : 'Out of memory';
                detail = currentLang === 'fr'
                    ? 'Ce fichier est trop volumineux pour être chargé. Fermez d\'autres onglets et réessayez.'
                    : 'This file is too large to load. Close other tabs and try again.';
            } else {
                title  = currentLang === 'fr' ? 'Erreur lecture' : 'Read error';
                detail = `<small style="color:#888;font-family:monospace;font-size:10px;">${err.message || err}</small>`;
            }

            container.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                            min-height:50vh;gap:16px;padding:30px;text-align:center;">
                    <div style="font-size:38px;">⚠️</div>
                    <div style="color:var(--neon-orange);font-weight:900;font-size:14px;letter-spacing:1px;text-transform:uppercase;">${title}</div>
                    <div style="color:#c0c0cc;font-size:12px;max-width:320px;line-height:1.7;">${detail}</div>
                    ${action}
                </div>`;
        }

        // =====================================================================
        // OUVERTURE ET RENDU D'UN FICHIER — TOUTES PLATEFORMES
        // =====================================================================
        async function openFile(obj) {
            if(!obj) return;
            switchTab('view');

            const container = document.getElementById('viewer-content');

            // Conserver le zoom entre les fichiers d'un même set (> 1 fichier)
            const zoomToApply = (setFiles.length > 1) ? zoomMemory : 1.0;

            // Rotation toujours réinitialisée à 0 pour chaque nouvelle partition
            currentRotation = 0;
            const rotLabel = document.getElementById('rotate-label');
            if (rotLabel) rotLabel.innerText = '↺↻';

            showLoadingSpinner(container);

            const isMobile = isMobilePlatform();
            const fileName = obj.entry.name;
            const fileExt  = fileName.toLowerCase();

            try {
                if (fileExt.endsWith('.pdf')) {
                    // -------------------------------------------------------
                    // RENDU PDF
                    // Passage par ArrayBuffer : évite toute object URL bloquée
                    // sur iOS Safari et Chrome Android (politiques cross-origin)
                    // -------------------------------------------------------
                    showLoadingSpinner(container, currentLang === 'fr' ? 'Lecture PDF...' : 'Reading PDF...');

                    const pdfRaw = await readFileAsArrayBuffer(obj.entry);

                    showLoadingSpinner(container, currentLang === 'fr' ? 'Décodage PDF...' : 'Decoding PDF...');

                    // Copie obligatoire : pdfjsLib.getDocument() transfère
                    // la propriété du buffer (ArrayBuffer devient detached)
                    const pdfBuffer = pdfRaw.slice(0);
                    const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;

                    // Vider le spinner seulement après décodage réussi
                    container.innerHTML = '';

                    // ---------------------------------------------------------
                    // NOUVEAU v7 — Échelle de rendu adaptée par CLASSE d'appareil
                    // ---------------------------------------------------------
                    // Trois profils distincts, pensés pour équilibrer netteté et
                    // consommation mémoire (crucial sur Safari iOS, qui tue les
                    // onglets trop gourmands) :
                    //   • Téléphone (largeur < 430px)         → qualité modérée
                    //   • Grande tablette (iPad Air 13", Android ≥ 768px)
                    //                                          → qualité élevée,
                    //     l'iPad Air 13" (2064×2752 px, ~2.6 dpr) profite d'un
                    //     rendu net sans exploser la mémoire grâce au clamp DPR.
                    //   • Ordinateur (souris/trackpad)         → qualité maximale
                    const isLargeTablet = isMobile && window.innerWidth >= 768;
                    const dpr = Math.min(window.devicePixelRatio || 1, isLargeTablet ? 2.5 : (isMobile ? 2 : 3));
                    let pdfScale;
                    if (isMobile && !isLargeTablet) {
                        // Téléphone : on vise ~1.3–1.6 "points logiques" avant application du DPR
                        pdfScale = (window.innerWidth < 430 ? 1.3 * dpr : 1.6 * dpr) / dpr;
                    } else if (isLargeTablet) {
                        // Tablette grand format (iPad Air 13" & équivalents Android) :
                        // on augmente sensiblement la base pour une lecture nette
                        // à distance de pupitre, tout en restant raisonnable en mémoire.
                        pdfScale = (window.innerWidth < 1080 ? 2.0 * dpr : 2.3 * dpr) / dpr;
                    } else {
                        pdfScale = (window.innerWidth < 1024 ? 1.9 : 2.2);
                    }

                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page     = await pdf.getPage(i);
                        const viewport = page.getViewport({ scale: pdfScale });

                        const wrapper = document.createElement('div');
                        wrapper.className = "page-wrapper";

                        const canvas = document.createElement('canvas');
                        canvas.width  = viewport.width;
                        canvas.height = viewport.height;

                        const anno = document.createElement('canvas');
                        anno.className = "anno-canvas";
                        anno.width  = canvas.width;
                        anno.height = canvas.height;

                        wrapper.appendChild(canvas);
                        wrapper.appendChild(anno);
                        container.appendChild(wrapper);

                        await page.render({
                            canvasContext: canvas.getContext('2d'),
                            viewport
                        }).promise;

                        setupDrawing(anno, fileName, i);
                    }

                } else {
                    // -------------------------------------------------------
                    // RENDU IMAGE (PNG / JPG / JPEG / WEBP)
                    // Base64 dataURL : seul format garanti sans restriction
                    // d'origine sur iOS Safari et Chrome Android
                    // -------------------------------------------------------
                    showLoadingSpinner(container, currentLang === 'fr' ? 'Lecture image...' : 'Reading image...');

                    const dataUrl = await readFileAsDataURL(obj.entry);

                    // Vider le spinner seulement après lecture réussie
                    container.innerHTML = '';

                    const wrapper = document.createElement('div');
                    wrapper.className = "page-wrapper";

                    const img = document.createElement('img');
                    img.alt = fileName;
                    img.draggable = false;
                    img.oncontextmenu = (e) => e.preventDefault(); // Empêche menu long-press mobile

                    const anno = document.createElement('canvas');
                    anno.className = "anno-canvas";

                    wrapper.appendChild(img);
                    wrapper.appendChild(anno);
                    container.appendChild(wrapper);

                    // Assigner src APRÈS avoir inséré dans le DOM
                    img.onload = () => {
                        anno.width  = img.naturalWidth  || img.offsetWidth  || 800;
                        anno.height = img.naturalHeight || img.offsetHeight || 600;
                        setupDrawing(anno, fileName, 0);
                    };

                    img.onerror = () => {
                        showFileError(container, new Error('Image decode failed'), fileName);
                    };

                    img.src = dataUrl;
                }

            } catch (err) {
                showFileError(container, err, fileName);
            }

            // Appliquer le zoom mémorisé ou initial
            currentZoom = zoomToApply;
            applyPageScales();

            document.getElementById('scroll-container').scrollTop = 0;
            document.getElementById('scroll-container').scrollLeft = 0;
            document.getElementById('page-info').innerText = (currentIndex + 1) + " / " + setFiles.length;
            renderSidebar();
        }

        function viewSingle(name) {
            const f = files.find(x => x.entry.name === name);
            if(f) { setFiles = [f]; currentIndex = 0; openFile(f); }
        }

        function nextFile() { 
            if(setFiles.length > 0) { 
                zoomMemory = currentZoom; 
                currentIndex = (currentIndex + 1) % setFiles.length; 
                openFile(setFiles[currentIndex]); 
            } 
        }
        function prevFile() { 
            if(setFiles.length > 0) { 
                zoomMemory = currentZoom; 
                currentIndex = (currentIndex - 1 + setFiles.length) % setFiles.length; 
                openFile(setFiles[currentIndex]); 
            } 
        }
        function goToHome() { 
            zoomMemory = 1.0;
            stopAutoScroll(); // NOUVEAU v7 : on n'auto-scrolle pas dans le vide hors de la visionneuse
            releaseWakeLock();
            switchTab('lib'); 
        }

        window.addEventListener('keydown', (e) => {
            if(document.activeElement.tagName === 'INPUT') return;
            const sc = document.getElementById('scroll-container');
            if(e.code === "Space") { e.preventDefault(); nextFile(); }
            if(e.key === "ArrowRight") nextFile();
            if(e.key === "ArrowLeft") prevFile();
            if(e.key === "ArrowDown") { sc.scrollBy(0, 180); if (autoScrollOn) pauseAutoScrollForManualInteraction(); }
            if(e.key === "ArrowUp")   { sc.scrollBy(0, -180); if (autoScrollOn) pauseAutoScrollForManualInteraction(); }
            // NOUVEAU v7 — raccourcis clavier auto-scroll (PC uniquement, sans conflit
            // avec les raccourcis existants) : "A" démarre/coupe, "[" / "]" ajustent la vitesse.
            if(e.key === "a" || e.key === "A") { e.preventDefault(); toggleAutoScroll(); }
            if(e.key === "[") { const s=document.getElementById('autoscroll-speed-slider'); if(s){ s.value = Math.max(AUTOSCROLL_MIN, autoScrollSpeed-6); setAutoScrollSpeed(s.value);} }
            if(e.key === "]") { const s=document.getElementById('autoscroll-speed-slider'); if(s){ s.value = Math.min(AUTOSCROLL_MAX, autoScrollSpeed+6); setAutoScrollSpeed(s.value);} }
        });

        // --- MOTEUR DE TRACÉ ROBUSTE ANTI-CONFLIT TACTILE ---
        function setupDrawing(canvas, fileName, pIdx) {
            const ctx = canvas.getContext('2d');
            const key = fileName + "_" + pIdx;
            
            if(annotations[key]) {
                const img = new Image(); img.src = annotations[key];
                img.onload = () => ctx.drawImage(img,0,0);
            }
            let isPainting = false;
            
            const getCanvasCoordinate = (e) => {
                const rect = canvas.getBoundingClientRect();
                let clientX, clientY;
                
                if (e.touches && e.touches.length > 0) {
                    clientX = e.touches[0].clientX;
                    clientY = e.touches[0].clientY;
                } else {
                    clientX = e.clientX;
                    clientY = e.clientY;
                }
                
                const x = (clientX - rect.left) * (canvas.width / rect.width);
                const y = (clientY - rect.top) * (canvas.height / rect.height);
                return { x, y };
            };
            
            const start = (e) => {
                if(!isDrawingMode) return; 
                isPainting = true;

                // NOUVEAU v7 : un trait de dessin met immédiatement l'auto-scroll
                // en pause — condition explicite du cahier des charges pour que
                // le défilement automatique ne "perturbe jamais le dessin".
                if (autoScrollOn) pauseAutoScrollForDrawing();

                // Bloque le défilement de la page sur mobile pendant le dessin
                if(e.cancelable) e.preventDefault(); 
                
                undoStack.push({key, data: canvas.toDataURL()});
                if(undoStack.length > 40) undoStack.shift();
                
                const pos = getCanvasCoordinate(e); 
                ctx.beginPath(); 
                ctx.moveTo(pos.x, pos.y);
            };
            
            const draw = (e) => {
                if(!isPainting || !isDrawingMode) return;
                if(e.cancelable) e.preventDefault();
                
                const pos = getCanvasCoordinate(e); 
                ctx.lineCap = 'round'; 
                ctx.lineJoin = 'round';
                
                if(annoColor === 'eraser') { 
                    ctx.globalCompositeOperation = 'destination-out'; 
                    ctx.lineWidth = annoSize * 4; 
                } else { 
                    ctx.globalCompositeOperation = 'source-over'; 
                    ctx.strokeStyle = annoColor; 
                    ctx.lineWidth = annoSize; 
                }
                ctx.lineTo(pos.x, pos.y); 
                ctx.stroke(); 
            };
            
            const stop = (e) => { 
                if(!isPainting) return; 
                isPainting = false; 
                annotations[key] = canvas.toDataURL();
                localStorage.setItem('part_annos_v3', JSON.stringify(annotations));
                // NOUVEAU v7 : la reprise de l'auto-scroll est différée de
                // quelques centaines de ms pour absorber une série de petits
                // traits rapprochés sans faire repartir/re-pauser le défilement en boucle.
                if (autoScrollOn) resumeAutoScrollAfterDrawing();
            };
            
            canvas.addEventListener('mousedown', start); 
            canvas.addEventListener('mousemove', draw);
            window.addEventListener('mouseup', stop);
            
            canvas.addEventListener('touchstart', start, {passive:false}); 
            canvas.addEventListener('touchmove', draw, {passive:false});
            canvas.addEventListener('touchend', stop);
        }

        function undoLast() {
            if(undoStack.length === 0) return;
            const last = undoStack.pop();
            const canvases = document.querySelectorAll('.anno-canvas');
            canvases.forEach(c => {
                const ctx = c.getContext('2d');
                const img = new Image();
                img.src = last.data;
                img.onload = () => { ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(img,0,0); };
            });
        }

        function clearCurrentPage() { 
            if(confirm("Effacer définitivement vos annotations sur ce document ?")) { 
                document.querySelectorAll('.anno-canvas').forEach(c => c.getContext('2d').clearRect(0,0,c.width,c.height)); 
                if(setFiles[currentIndex]) {
                    for (let key in annotations) {
                        if (key.startsWith(setFiles[currentIndex].entry.name)) delete annotations[key];
                    }
                    localStorage.setItem('part_annos_v3', JSON.stringify(annotations));
                }
            } 
        }

        function setupPinchZoom() {
            const el = document.getElementById('scroll-container');
            
            el.addEventListener('touchstart', (e) => {
                if (e.touches.length === 2) {
                    tpCache = [e.touches[0], e.touches[1]];
                    startDist = Math.hypot(tpCache[0].clientX - tpCache[1].clientX, tpCache[0].clientY - tpCache[1].clientY);
                    startZoom = currentZoom;
                }
            }, { passive: true });

            el.addEventListener('touchmove', (e) => {
                if (e.touches.length === 2 && startDist > 0) {
                    const curDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                    const factor = curDist / startDist;
                    currentZoom = Math.max(0.5, Math.min(3.0, startZoom * factor));
                    applyPageScales();
                }
            }, { passive: true });

            el.addEventListener('touchend', (e) => { if (e.touches.length < 2) startDist = 0; }, { passive: true });
        }

        function switchTab(id) { 
            // NOUVEAU v7 : quitter la visionneuse coupe systématiquement l'auto-scroll,
            // qu'on parte via "Accueil", "✕", ou un autre onglet.
            if (id !== 'view' && autoScrollOn) stopAutoScroll();
            ['lib','set','view'].forEach(t => { 
                document.getElementById('sec-'+t).classList.add('hidden'); 
                document.getElementById('tab-'+t).classList.remove('tab-active'); 
            });
            document.getElementById('sec-'+id).classList.remove('hidden'); 
            document.getElementById('tab-'+id).classList.add('tab-active');
            if(id==='view') document.getElementById('tab-view').classList.remove('opacity-20');
        }

        function toggleSidebar() { document.getElementById('viewer-sidebar').classList.toggle('collapsed'); }

        function renderSidebar() {
            const container = document.getElementById('sidebar-items'); container.innerHTML = '';
            setFiles.forEach((f, i) => {
                const div = document.createElement('div');
                div.className = `sidebar-item ${i === currentIndex ? 'active' : ''}`;
                div.innerHTML = `<div class="flex items-center truncate"><span class="opacity-40 mr-2.5 font-bold text-[10px]">${i+1}</span>
                                 <span class="truncate pr-2">${f.entry.name}</span></div>
                                 <span class="text-zinc-600 font-bold text-[10px] select-none">☰</span>`;
                div.onclick = (e) => { 
                    if(e.target.innerText === '☰') return;
                    currentIndex = i; 
                    openFile(f); 
                };
                container.appendChild(div);
            });
        }

        function applyPageScales() {
            const wrappers = document.querySelectorAll('.page-wrapper');

            wrappers.forEach(w => {
                const isRotated90 = (currentRotation === 90 || currentRotation === 270);

                // --- ZOOM via transform scale ---
                // transform: scale() ne modifie pas le flux du document, la page garde
                // sa taille "naturelle" dans le layout. Pour compenser et éviter le 
                // chevauchement entre pages successives, on calcule le surplus de hauteur
                // créé par le scale et on l'ajoute en margin-bottom.
                w.style.transform = `scale(${currentZoom})`;
                w.style.transformOrigin = 'top center';

                const naturalH = w.offsetHeight;
                const naturalW = w.offsetWidth;

                // Surplus vertical créé par le scale
                const scaledH    = naturalH * currentZoom;
                const scaledW    = naturalW * currentZoom;
                const surplusH   = scaledH - naturalH;

                // Lorsque la page est tournée de 90°/270°, la hauteur perçue devient
                // la largeur naturelle × zoom, ce qui crée un espace encore plus grand.
                // On doit alors compenser différemment.
                let marginBottom;
                if (isRotated90) {
                    // Page tournée : la dimension verticale visible = largeur × zoom
                    // La hauteur dans le DOM reste naturalH (non-rotated)
                    // On ajoute la différence entre la dimension horizontale scalée
                    // (qui devient verticale après rotation) et la hauteur DOM.
                    const visibleH = scaledW; // après rotation 90°, la largeur devient la hauteur
                    marginBottom = Math.max(0, visibleH - naturalH) + 40;
                } else {
                    marginBottom = Math.max(0, surplusH) + 40;
                }
                w.style.marginBottom = marginBottom + 'px';
                // Aussi compenser la largeur si nécessaire (scroll horizontal)
                w.style.marginLeft  = '0px';
                w.style.marginRight = '0px';
            });

            if (currentZoom > 1.05) {
                document.getElementById('viewer-header').style.opacity = "1";
                document.getElementById('viewer-header').style.pointerEvents = "auto";
                document.getElementById('viewer-nav').style.opacity = "1";
                uiVisible = true;
            }

            document.getElementById('zoom-level').innerText = Math.round(currentZoom * 100) + "%";
        }

        // --- ROTATION DES PARTITIONS ---
        // La rotation est appliquée page par page via CSS transform.
        // Elle n'est PAS conservée d'une partition à l'autre (reset à chaque openFile).
        function rotatePage(direction) {
            // direction : +1 = horaire, -1 = antihoraire
            currentRotation = (currentRotation + direction * 90 + 360) % 360;
            applyRotation();
        }

        function applyRotation() {
            const wrappers = document.querySelectorAll('.page-wrapper');
            wrappers.forEach(w => {
                // On combine zoom et rotation dans un seul transform
                // pour éviter les conflits CSS
                w.style.transform = `scale(${currentZoom}) rotate(${currentRotation}deg)`;
                w.style.transformOrigin = 'center center';

                const naturalH   = w.offsetHeight;
                const naturalW   = w.offsetWidth;
                const isRotated90 = (currentRotation === 90 || currentRotation === 270);

                // Après rotation 90°/270°, les dimensions width/height s'inversent.
                // On calcule la marge de compensation en tenant compte de cet échange.
                let marginBottom;
                if (isRotated90) {
                    const visibleH   = naturalW * currentZoom; // largeur × zoom = hauteur visible après rotation
                    marginBottom = Math.max(0, visibleH - naturalH) + 60;
                } else if (currentRotation === 180) {
                    const surplusH = naturalH * currentZoom - naturalH;
                    marginBottom = Math.max(0, surplusH) + 40;
                } else {
                    const surplusH = naturalH * currentZoom - naturalH;
                    marginBottom = Math.max(0, surplusH) + 40;
                }
                w.style.marginBottom = marginBottom + 'px';
            });
            document.getElementById('zoom-level').innerText = Math.round(currentZoom * 100) + "%";
            // Afficher l'angle dans le bouton de rotation
            const rotLabel = document.getElementById('rotate-label');
            if (rotLabel) rotLabel.innerText = currentRotation === 0 ? '↺↻' : currentRotation + '°';
        }

        function adjustZoom(d) { 
            currentZoom = Math.max(0.4, Math.min(3.5, currentZoom + d)); 
            // Si une rotation est active, applyRotation recalcule tout (zoom + rotation)
            if (currentRotation !== 0) {
                applyRotation();
            } else {
                applyPageScales();
            }
        }

        function handleWheel(e) {
            if(e.ctrlKey) { e.preventDefault(); adjustZoom(e.deltaY > 0 ? -0.05 : 0.05); return; }
            // Un coup de molette manuel doit suspendre temporairement l'auto-scroll
            // pour ne jamais entrer en conflit avec le geste de l'utilisateur.
            if (autoScrollOn) pauseAutoScrollForManualInteraction();
        }

        // =====================================================================
        // NOUVEAU v7 — MOTEUR D'AUTO-SCROLL
        // =====================================================================
        // Principes de conception (répond au cahier des charges : "ne doit
        // perturber ni l'affichage, ni le dessin") :
        //
        //   1. On ne touche JAMAIS aux transforms (zoom/rotation) : seul
        //      scroll-container.scrollTop est modifié, comme un doigt qui
        //      glisserait lentement sur l'écran. Le rendu des pages, le zoom
        //      mémorisé et la rotation restent donc parfaitement intacts.
        //   2. Pendant un trait de dessin (isPainting sur un anno-canvas),
        //      l'auto-scroll se met automatiquement en pause : impossible de
        //      dessiner correctement si la page bouge sous le doigt/stylet.
        //   3. Toute interaction tactile manuelle sur la zone de lecture
        //      (scroll, pincer-zoomer) suspend aussi l'auto-scroll quelques
        //      instants, puis celui-ci reprend tout seul sans surprise.
        //   4. En fin de partition, si "Enchaîner Setlist" est coché et qu'il
        //      reste des morceaux dans la setlist en cours, on avance
        //      automatiquement au fichier suivant (comme un tourneur de pages
        //      humain) ; sinon l'auto-scroll s'arrête proprement.
        // =====================================================================

        function toggleScrollToolbar() {
            const bar = document.getElementById('scroll-toolbar');
            const willShow = bar.style.display !== 'flex';
            bar.style.display = willShow ? 'flex' : 'none';
            if (willShow) {
                // Un seul panneau d'outils affiché à la fois pour ne pas surcharger l'écran
                isFxMode = false; document.getElementById('fx-toolbar').style.display = 'none';
                document.getElementById('fx-toggle-btn').style.background = '';
                document.getElementById('fx-toggle-btn').style.color = '';
                isDrawingMode = false;
                document.getElementById('scroll-container').classList.remove('anno-active');
                document.getElementById('anno-toolbar').style.display = 'none';
                document.getElementById('draw-toggle').style.background = '';
                document.getElementById('draw-toggle').style.color = '';
            }
        }

        function toggleAutoScroll() { autoScrollOn ? stopAutoScroll() : startAutoScroll(); }

        function startAutoScroll() {
            if (autoScrollOn) return;
            autoScrollOn = true;
            requestWakeLock();
            autoScrollLastTs = null;
            autoScrollPausedForTouch = false;
            updateAutoScrollUI();
            showToast(currentLang === 'fr' ? '▶ Auto-scroll activé' : '▶ Auto-scroll started');
            autoScrollRAF = requestAnimationFrame(autoScrollStep);
        }

        function stopAutoScroll() {
            const wasOn = autoScrollOn;
            autoScrollOn = false;
            releaseWakeLock();
            if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
            autoScrollRAF = null;
            if (autoScrollResumeTimer) clearTimeout(autoScrollResumeTimer);
            updateAutoScrollUI();
            if (wasOn) showToast(currentLang === 'fr' ? '❚❚ Auto-scroll en pause' : '❚❚ Auto-scroll paused');
        }

        // Petit "toast" néon discret pour confirmer un changement d'état sans
        // bloquer l'interface (disparaît tout seul après 1.4s).
        let toastTimer = null;
        function showToast(message) {
            let el = document.getElementById('neon-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'neon-toast';
                el.className = 'toast-neon';
                document.body.appendChild(el);
            }
            el.innerText = message;
            el.style.display = 'block';
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { el.style.display = 'none'; }, 1400);
        }

        function updateAutoScrollUI() {
            const btn = document.getElementById('autoscroll-play');
            const dockBtn = document.getElementById('scroll-toggle-btn');
            if (!btn) return;
            btn.classList.toggle('on', autoScrollOn);
            btn.innerText = autoScrollOn ? '❚❚' : '▶';
            if (dockBtn) {
                dockBtn.style.background = autoScrollOn ? 'var(--neon-purple)' : '';
                dockBtn.style.color = autoScrollOn ? '#fff' : '';
                dockBtn.style.borderColor = autoScrollOn ? 'var(--neon-purple)' : '';
            }
        }

        // Boucle principale : appelée à chaque frame tant que autoScrollOn est vrai.
        function autoScrollStep(ts) {
            if (!autoScrollOn) return;
            if (autoScrollLastTs === null) autoScrollLastTs = ts;
            const dtSeconds = Math.min((ts - autoScrollLastTs) / 1000, 0.25); // clamp anti-saut (onglet en veille)
            autoScrollLastTs = ts;

            if (!autoScrollPausedForDraw && !autoScrollPausedForTouch) {
                const sc = document.getElementById('scroll-container');
                if (sc) {
                    // Le flag "programmatic" évite que notre propre incrément de
                    // scrollTop soit interprété par setupAutoScrollGuards() comme
                    // une interaction manuelle de l'utilisateur (ce qui aurait mis
                    // l'auto-scroll en pause à chaque frame — bug classique).
                    autoScrollProgrammatic = true;
                    sc.scrollTop += autoScrollSpeed * dtSeconds;

                    const reachedBottom = (sc.scrollTop + sc.clientHeight) >= (sc.scrollHeight - 4);
                    if (reachedBottom) {
                        if (autoScrollChain && setFiles.length > 1 && currentIndex < setFiles.length - 1) {
                            // Enchaînement setlist : on avance au morceau suivant en conservant
                            // l'auto-scroll actif — openFile() remet scrollTop à 0 pour nous,
                            // ce qui redonne bien "le retour à la première page" à chaque partition.
                            stopAutoScroll();
                            nextFile();
                            setTimeout(() => { if (!autoScrollOn) startAutoScroll(); }, 450);
                        } else {
                            stopAutoScroll();
                        }
                    }
                }
            }
            autoScrollRAF = requestAnimationFrame(autoScrollStep);
        }

        function setAutoScrollSpeed(v) {
            autoScrollSpeed = Math.max(AUTOSCROLL_MIN, Math.min(AUTOSCROLL_MAX, parseFloat(v)));
            localStorage.setItem('part_autoscroll_speed', String(autoScrollSpeed));
            const pct = Math.round(((autoScrollSpeed - AUTOSCROLL_MIN) / (AUTOSCROLL_MAX - AUTOSCROLL_MIN)) * 100);
            const lbl = document.getElementById('val-scrollspeed');
            if (lbl) lbl.innerText = pct + '%';
        }

        function setAutoScrollChain(checked) {
            autoScrollChain = checked;
            localStorage.setItem('part_autoscroll_chain', checked ? '1' : '0');
        }

        // Pause déclenchée par le dessin (voir setupDrawing) : pas de reprise
        // automatique tant que l'utilisateur n'a pas relâché le trait depuis
        // un court instant, pour éviter les à-coups pendant une série de traits rapprochés.
        function pauseAutoScrollForDrawing() {
            autoScrollPausedForDraw = true;
        }
        function resumeAutoScrollAfterDrawing() {
            clearTimeout(autoScrollResumeTimer);
            autoScrollResumeTimer = setTimeout(() => { autoScrollPausedForDraw = false; }, 500);
        }

        // Pause déclenchée par une interaction tactile manuelle (scroll au doigt,
        // pincer-zoomer, molette). Reprise automatique après une courte pause
        // d'inactivité pour rendre la main à l'utilisateur sans qu'il ait besoin
        // de relancer manuellement l'auto-scroll à chaque fois.
        function pauseAutoScrollForManualInteraction() {
            autoScrollPausedForTouch = true;
            clearTimeout(autoScrollResumeTimer);
            autoScrollResumeTimer = setTimeout(() => { autoScrollPausedForTouch = false; }, 900);
        }

        // Initialise les écouteurs qui permettent à l'auto-scroll de "sentir"
        // les interactions manuelles sans jamais bloquer le scroll natif.
        function setupAutoScrollGuards() {
            const sc = document.getElementById('scroll-container');
            if (!sc) return;
            ['touchstart', 'touchmove'].forEach(evt => {
                sc.addEventListener(evt, () => { if (autoScrollOn) pauseAutoScrollForManualInteraction(); }, { passive: true });
            });
            sc.addEventListener('scroll', () => {
                // Ignore les événements de scroll générés par l'auto-scroll lui-même
                if (autoScrollProgrammatic) { autoScrollProgrammatic = false; return; }
                // Un scroll natif (barre de défilement souris, trackpad) suspend aussi
                if (autoScrollOn && !autoScrollPausedForDraw) pauseAutoScrollForManualInteraction();
            }, { passive: true });
        }

        function toggleDrawingMode() {
            isDrawingMode = !isDrawingMode;
            document.getElementById('scroll-container').classList.toggle('anno-active', isDrawingMode);
            
            const btn = document.getElementById('draw-toggle');
            btn.style.background = isDrawingMode ? 'var(--neon-pink)' : '';
            btn.style.borderColor = isDrawingMode ? 'var(--neon-pink)' : '';
            btn.style.color = isDrawingMode ? '#fff' : '';
            
            document.getElementById('anno-toolbar').style.display = isDrawingMode ? 'flex' : 'none';
            
            if (isDrawingMode) {
                isFxMode = false;
                document.getElementById('fx-toolbar').style.display = 'none';
                document.getElementById('fx-toggle-btn').style.background = '';
                document.getElementById('fx-toggle-btn').style.color = '';
                // NOUVEAU v7 : un seul panneau d'outils visible à la fois
                document.getElementById('scroll-toolbar').style.display = 'none';
                document.getElementById('scroll-toggle-btn').style.background = autoScrollOn ? 'var(--neon-purple)' : '';
            }
        }

        function toggleFX() { 
            isFxMode = !isFxMode;
            const fxBar = document.getElementById('fx-toolbar');
            fxBar.style.display = isFxMode ? 'flex' : 'none';
            
            const btn = document.getElementById('fx-toggle-btn');
            btn.style.background = isFxMode ? 'var(--neon-blue)' : '';
            btn.style.borderColor = isFxMode ? 'var(--neon-blue)' : '';
            btn.style.color = '#000';

            if (isFxMode) {
                isDrawingMode = false;
                document.getElementById('scroll-container').classList.remove('anno-active');
                document.getElementById('anno-toolbar').style.display = 'none';
                document.getElementById('draw-toggle').style.background = '';
                document.getElementById('draw-toggle').style.color = '';
                // NOUVEAU v7 : referme le panneau auto-scroll s'il était ouvert
                document.getElementById('scroll-toolbar').style.display = 'none';
            }
        }

        function toggleUI() {
            if (isDrawingMode || isFxMode || currentZoom > 1.05) {
                return; 
            }
            uiVisible = !uiVisible;
            document.getElementById('viewer-header').style.opacity = uiVisible ? "1" : "0";
            document.getElementById('viewer-header').style.pointerEvents = uiVisible ? "auto" : "none";
            document.getElementById('viewer-nav').style.opacity = uiVisible ? "1" : "0";
        }

        function updateFX(t, v) {
            const r = document.documentElement;
            if(t==='bright') { r.style.setProperty('--page-bright', v); document.getElementById('val-bright').innerText = Math.round(v*100)+'%'; }
            if(t==='contrast') { r.style.setProperty('--page-contrast', v); document.getElementById('val-contrast').innerText = Math.round(v*100)+'%'; }
        }

        function setAnnoColor(c, el) { 
            annoColor = c; 
            document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active')); 
            if(el) el.classList.add('active'); 
        }
        
        function setAnnoSize(s, el) { 
            annoSize = s; 
            document.querySelectorAll('.size-btn').forEach(d => d.classList.remove('active')); 
            if(el) el.classList.add('active'); 
        }


        // =====================================================================
        // v8 — GARDE-FOU D'INTERFACE : les contrôles ne peuvent pas être
        // "perdus" sous une barre système après rotation ou redimensionnement.
        // =====================================================================
        function refreshResponsiveShell() {
            setAppVH();
            updateScanSupportHint();
            updateZoomLabel();

            const view = document.getElementById('sec-view');
            const header = document.getElementById('viewer-header');

            if (view && !view.classList.contains('hidden') && header) {
                header.style.paddingTop =
                    `max(6px, calc(6px + var(--safe-top)))`;
            }

            requestAnimationFrame(() => {
                applyPageScales();
                if (currentRotation !== 0) applyRotation();
            });
        }

        window.addEventListener('resize', refreshResponsiveShell, { passive: true });
        window.addEventListener('orientationchange', () => {
            window.setTimeout(refreshResponsiveShell, 250);
            window.setTimeout(refreshResponsiveShell, 700);
        });

        // Prévenir les doubles gestes de zoom navigateur autour du lecteur.
        document.addEventListener('gesturestart', e => {
            if (e.target.closest?.('#scroll-container')) e.preventDefault();
        }, { passive: false });

        document.addEventListener('gesturechange', e => {
            if (e.target.closest?.('#scroll-container')) e.preventDefault();
        }, { passive: false });

        // Raccourci PC : F = plein écran, 0 = reset vue.
        window.addEventListener('keydown', e => {
            if (document.activeElement?.tagName === 'INPUT') return;
            if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                if (!document.getElementById('sec-view').classList.contains('hidden')) {
                    toggleFullscreen();
                }
            }
            if (e.key === '0') {
                if (!document.getElementById('sec-view').classList.contains('hidden')) {
                    e.preventDefault();
                    resetViewerView();
                }
            }
        });

        // Protection contre les promesses IndexedDB silencieusement rejetées.
        window.addEventListener('unhandledrejection', e => {
            console.warn('[Partoches] Promise non gérée:', e.reason);
        });

        // Expose un petit diagnostic volontairement non intrusif pour les tests QA.
        window.PartochesDiagnostics = {
            profile: getPlatformProfile,
            refresh: refreshResponsiveShell,
            scanFolder: scanFolderEntry,
            scanFiles: scanFilesEntry,
            scanPhotos: scanPhotosEntry,
            resetView: resetViewerView,
            fullscreen: toggleFullscreen
        };


        // PWA shell : service worker uniquement en contexte sécurisé.
        if ('serviceWorker' in navigator &&
            (location.protocol === 'https:' || location.hostname === 'localhost')) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js', { scope: './' })
                    .then(reg => console.info('[Partoches] Service Worker actif:', reg.scope))
                    .catch(err => console.warn('[Partoches] Service Worker:', err));
            });
        }

        window.onload = init;
    