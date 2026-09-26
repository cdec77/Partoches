/* Additive interface improvements. Original storage and reading engines retained. */
(() => {
    'use strict';
    const text = (fr, en) => currentLang === 'fr' ? fr : en;
    const button = (label, action, className = 'btn-jazz') => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = className;
        element.textContent = label;
        element.onclick = action;
        return element;
    };
    let libraryFilter = '';
    function selectionCounts() {
        const counts = new Map();
        document.querySelectorAll('#set-list-current > [data-name]').forEach(row => {
            counts.set(row.dataset.name, (counts.get(row.dataset.name) || 0) + 1);
        });
        return counts;
    }
    function refreshSelection() {
        const counts = selectionCounts();
        document.querySelectorAll('#library-list .file-row').forEach(row => {
            const count = counts.get(row.dataset.name) || 0;
            row.classList.toggle('score-selected', count > 0);
            row.querySelector('.score-badge').textContent = count ? `✓ ×${count}` : '';
        });
    }
    renderLibrary = function(filter = '') {
        libraryFilter = filter;
        const list = document.getElementById('library-list');
        list.replaceChildren();
        files.filter(f => !filter || f.entry.name.toUpperCase().startsWith(filter))
            .sort((a, b) => a.entry.name.localeCompare(b.entry.name))
            .forEach(file => {
                const row = document.createElement('div');
                row.className = 'file-row flex items-center p-3 px-4';
                row.dataset.name = file.entry.name;
                const title = button(file.entry.name, () => viewSingle(file.entry.name), 'score-title');
                const badge = document.createElement('span');
                badge.className = 'score-badge';
                badge.setAttribute('aria-live', 'polite');
                const actions = document.createElement('div');
                actions.className = 'score-actions';
                actions.append(button(text('Aperçu', 'Preview'), () => preview(file)),
                    button(i18n[currentLang].btn_add, e => handleSelectLibraryItem(e.currentTarget, file.entry.name)));
                row.append(title, badge, actions);
                list.append(row);
            });
        refreshSelection();
        requestAnimationFrame(refreshAlphaBarV10);
    };
    // Mutation observation includes removals, loading, clearing and duplicate entries.
    new MutationObserver(refreshSelection).observe(document.getElementById('set-list-current'), { childList: true });
    addToSet = function(name) {
        // Keep sortable behavior, but use textContent for arbitrary file names.
        const list = document.getElementById('set-list-current');
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center bg-[#141419] p-3 mb-2 rounded border border-white/5 cursor-move';
        row.dataset.name = name;
        const title = document.createElement('span');
        title.className = 'score-title';
        title.textContent = name;
        row.append(title, button(text('Aperçu', 'Preview'), () => {
            const file = files.find(f => f.entry.name === name);
            if (file) preview(file);
        }), button('✕', () => row.remove(), 'score-remove'));
        list.append(row);
        if (!Sortable.get(list)) new Sortable(list, { animation: 150 });
        refreshSelection();
    };
    function createDialog(title) {
        const dialog = document.createElement('dialog');
        dialog.className = 'score-dialog';
        const header = document.createElement('header');
        const heading = document.createElement('h2');
        heading.textContent = title;
        dialog.setAttribute('aria-label', title);
        header.append(heading, button(text('Fermer', 'Close'), () => dialog.close()));
        dialog.append(header);
        // Within the fullscreen element so dialogs also work in fullscreen mode.
        (document.fullscreenElement || document.webkitFullscreenElement || document.body).append(dialog);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.showModal();
        return dialog;
    }
    async function preview(file, onAdd = () => addToSet(file.entry.name)) {
        const dialog = createDialog(file.entry.name);
        const content = document.createElement('div');
        content.className = 'score-preview';
        content.textContent = text('Chargement…', 'Loading…');
        dialog.append(content, button(text('Ajouter au set', 'Add to set'), () => {
            onAdd();
            showToast(text('Partition ajoutée', 'Score added'));
        }));
        let pdf = null;
        let render = null;
        let url = null;
        dialog.addEventListener('close', () => {
            if (render) render.cancel();
            if (pdf) pdf.destroy();
            if (url) URL.revokeObjectURL(url);
        }, { once: true });
        try {
            if (/\.pdf$/i.test(file.entry.name)) {
                const data = await readFileAsArrayBuffer(file.entry);
                if (!dialog.open) return;
                pdf = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
                if (!dialog.open) { await pdf.destroy(); return; }
                const page = await pdf.getPage(1);
                if (!dialog.open) return;
                const base = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: Math.min(1.5, 800 / base.width) });
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                canvas.setAttribute('aria-label', text('Aperçu de la première page', 'First page preview'));
                render = page.render({ canvasContext: canvas.getContext('2d'), viewport });
                await render.promise;
                if (!dialog.open) return;
                const caption = document.createElement('p');
                caption.textContent = text('Page 1 sur ', 'Page 1 of ') + pdf.numPages;
                content.replaceChildren(canvas, caption);
            } else {
                const blob = await getFileRobust(file.entry);
                if (!dialog.open) return;
                url = URL.createObjectURL(blob);
                const img = new Image();
                img.alt = file.entry.name;
                img.src = url;
                await img.decode();
                if (dialog.open) content.replaceChildren(img);
            }
        } catch (error) {
            if (dialog.open) content.textContent = text('Aperçu indisponible. Vérifiez l’accès au fichier.', 'Preview unavailable. Check file access.');
        }
    }
    function addLive(file) {
        setFiles.push(file);
        renderSidebar();
        document.getElementById('page-info').textContent = `${currentIndex + 1} / ${setFiles.length}`;
    }
    function chooseLive() {
        const dialog = createDialog(text('Ajouter à la liste de lecture', 'Add to reading list'));
        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'score-search';
        search.placeholder = text('Rechercher une partition', 'Search scores');
        search.setAttribute('aria-label', search.placeholder);
        const list = document.createElement('div');
        dialog.append(search, list);
        const refresh = () => {
            list.replaceChildren();
            files.filter(f => f.entry.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))
                .forEach(file => {
                    const row = document.createElement('div');
                    row.className = 'score-picker-row';
                    const title = document.createElement('span');
                    title.className = 'score-title';
                    const count = setFiles.filter(f => f === file).length;
                    title.textContent = `${count ? `✓ ×${count} · ` : ''}${file.entry.name}`;
                    const add = () => { addLive(file); refresh(); };
                    row.append(title, button(text('Aperçu', 'Preview'), () => preview(file, add)),
                        button(text('Ajouter', 'Add'), add));
                    list.append(row);
                });
            if (!list.children.length) list.textContent = text('Aucune partition. Importez des fichiers depuis le répertoire.', 'No scores. Import files from the library.');
        };
        search.oninput = refresh;
        refresh();
        search.focus();
    }
    const controls = document.createElement('div');
    controls.className = 'viewer-set-actions';
    controls.append(button('+ ' + text('Ajouter une partition', 'Add a score'), chooseLive));
    document.getElementById('sidebar-items').before(controls);
    const originalSidebar = renderSidebar;
    renderSidebar = function() {
        originalSidebar();
        document.querySelectorAll('#sidebar-items > .sidebar-item').forEach((row, index) => {
            row.setAttribute('aria-current', index === currentIndex ? 'true' : 'false');
            const remove = button('✕', event => {
                event.stopPropagation();
                const wasCurrent = index === currentIndex;
                setFiles.splice(index, 1);
                if (index < currentIndex) currentIndex--;
                currentIndex = Math.max(0, Math.min(currentIndex, setFiles.length - 1));
                if (!setFiles.length) {
                    document.getElementById('viewer-content').replaceChildren();
                    document.getElementById('page-info').textContent = '0 / 0';
                    goToHome();
                } else if (wasCurrent) openFile(setFiles[currentIndex]);
                document.getElementById('page-info').textContent = setFiles.length ? `${currentIndex + 1} / ${setFiles.length}` : '0 / 0';
                renderSidebar();
            }, 'score-remove');
            remove.setAttribute('aria-label', text('Retirer de la lecture : ', 'Remove from reading list: ') + setFiles[index].entry.name);
            row.append(remove);
        });
    };
    // One-finger horizontal swipes; leave pinch, annotation and zoom panning intact.
    const surface = document.getElementById('scroll-container');
    let gesture = null;
    let suppressClickUntil = 0;
    surface.addEventListener('touchstart', event => {
        gesture = null;
        if (event.touches.length !== 1 || isDrawingMode || currentZoom > 1.05 || document.querySelector('dialog[open]')) return;
        const touch = event.touches[0];
        gesture = { x: touch.clientX, y: touch.clientY, time: performance.now() };
    }, { passive: true });
    surface.addEventListener('touchmove', event => {
        if (!gesture) return;
        if (event.touches.length !== 1 || Math.abs(event.touches[0].clientY - gesture.y) > 55) gesture = null;
    }, { passive: true });
    surface.addEventListener('touchcancel', () => { gesture = null; }, { passive: true });
    surface.addEventListener('touchend', event => {
        const start = gesture;
        gesture = null;
        if (!start || event.touches.length || !event.changedTouches.length || isDrawingMode || currentZoom > 1.05) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (performance.now() - start.time > 750 || Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2 || setFiles.length < 2) return;
        suppressClickUntil = performance.now() + 450;
        if (dx < 0) nextFile(); else prevFile();
    }, { passive: true });
    surface.addEventListener('click', event => {
        if (performance.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    const originalLang = setLang;
    setLang = function(lang) {
        originalLang(lang);
        controls.firstChild.textContent = '+ ' + text('Ajouter une partition', 'Add a score');
        renderLibrary(libraryFilter);
    };
})();
