// Tonin Event — logique front-end
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAX_FILES = 10;
  const MAX_SIZE = 15 * 1024 * 1024;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  const state = {
    name: '',
    currentEvent: null,
    selected: [],        // fichiers choisis avant publication
    afterName: null,     // action à reprendre après saisie du prénom
    lightboxIndex: 0,
    filterAuthor: null,  // clé de l'auteur dont on voit l'album
    visiblePhotos: [],   // photos actuellement affichées (filtrées ou non)
  };

  /* ---------- Utilitaires ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  // "K7M2QX" -> "K7M-2QX"
  const fmtCode = (c) => (c.length > 3 ? c.slice(0, 3) + '-' + c.slice(3) : c);
  // "k7m 2qx" -> "K7M2QX"
  const normCode = (s) => String(s || '').toUpperCase().split('').filter((c) => CODE_CHARS.includes(c)).join('').slice(0, 6);

  async function api(url, options) {
    const res = await fetch(url, options);
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch (_) {
      window.prompt('Copie ceci :', text);
    }
  }

  /* ---------- Mes événements (codes mémorisés sur cet appareil) ---------- */
  function getMyCodes() {
    try {
      const list = JSON.parse(localStorage.getItem('tonin_events') || '[]');
      return Array.isArray(list) ? list.filter((c) => typeof c === 'string') : [];
    } catch (_) { return []; }
  }
  function setMyCodes(list) {
    try { localStorage.setItem('tonin_events', JSON.stringify(list.slice(0, 50))); } catch (_) {}
  }
  function rememberCode(code) {
    const list = getMyCodes().filter((c) => c !== code);
    list.unshift(code);
    setMyCodes(list);
  }
  function forgetCode(code) { setMyCodes(getMyCodes().filter((c) => c !== code)); }

  /* ---------- Prénom ---------- */
  function loadName() {
    try { state.name = localStorage.getItem('tonin_name') || ''; } catch (_) { state.name = ''; }
    renderUser();
  }

  function renderUser() {
    $('userName').textContent = state.name || 'Mon prénom';
    $('userAvatar').textContent = state.name ? state.name.charAt(0).toUpperCase() : '?';
    $('uploadAs').textContent = state.name || '—';
  }

  function openNameModal(canCancel, then) {
    state.afterName = then || null;
    $('nameInput').value = state.name;
    $('nameErr').textContent = '';
    $('nameCancel').hidden = !canCancel;
    $('nameModal').hidden = false;
    setTimeout(() => $('nameInput').focus(), 30);
  }

  function closeNameModal() { $('nameModal').hidden = true; }

  $('nameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('nameInput').value.replace(/\s+/g, ' ').trim();
    if (!v) { $('nameErr').textContent = 'Merci de saisir ton prénom.'; return; }
    state.name = v.slice(0, 40);
    try { localStorage.setItem('tonin_name', state.name); } catch (_) {}
    renderUser();
    closeNameModal();
    const next = state.afterName;
    state.afterName = null;
    if (next) next();
  });
  $('nameCancel').addEventListener('click', () => { state.afterName = null; closeNameModal(); });
  $('userChip').addEventListener('click', () => openNameModal(true));

  // Exige un prénom avant une action
  function requireName(action) {
    if (state.name) return action();
    openNameModal(false, action);
  }

  /* ---------- Routage (hash) : #/e/CODE ---------- */
  function route() {
    const m = location.hash.match(/^#\/e\/([A-Za-z0-9-]+)/);
    if (m) showEvent(normCode(m[1]));
    else showHome();
    window.scrollTo({ top: 0 });
  }
  window.addEventListener('hashchange', route);

  /* ---------- Accueil ---------- */
  async function showHome() {
    $('eventView').hidden = true;
    $('homeView').hidden = false;
    document.title = 'Tonin Event — Photos par événement';
    state.currentEvent = null;
    $('joinErr').textContent = '';

    const codes = getMyCodes();
    if (!codes.length) { renderEvents([]); return; }
    try {
      const events = await api('/api/events?codes=' + encodeURIComponent(codes.join(',')));
      // Oublie les codes qui n'existent plus, conserve l'ordre mémorisé
      const byCode = new Map(events.map((e) => [e.code, e]));
      const ordered = codes.filter((c) => byCode.has(c)).map((c) => byCode.get(c));
      if (ordered.length !== codes.length) setMyCodes(ordered.map((e) => e.code));
      renderEvents(ordered);
    } catch (err) {
      toast(err.message);
    }
  }

  function renderEvents(events) {
    $('eventsEmpty').hidden = events.length > 0;
    $('eventGrid').innerHTML = events.map((e) => `
      <a class="event-card" href="#/e/${esc(e.code)}">
        <div class="event-cover">
          ${e.cover ? `<img src="${esc(e.cover)}" alt="" loading="lazy" />` : '📷'}
        </div>
        <div class="event-info">
          <h3>${esc(e.name)}</h3>
          <p>${esc(e.description) || 'Aucune description.'}</p>
          <div class="event-foot">
            <span>${plural(e.photoCount, 'photo', 'photos')}</span>
            <span class="by">Code ${esc(fmtCode(e.code))}</span>
          </div>
        </div>
      </a>`).join('');
  }

  /* ---------- Rejoindre avec un code ---------- */
  $('joinInput').addEventListener('input', () => {
    const c = normCode($('joinInput').value);
    $('joinInput').value = fmtCode(c);
    $('joinErr').textContent = '';
  });

  $('joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normCode($('joinInput').value);
    if (code.length !== 6) { $('joinErr').textContent = 'Le code contient 6 caractères (ex : K7M-2QX).'; return; }
    try {
      await api('/api/events/' + code);
      rememberCode(code);
      $('joinInput').value = '';
      toast('Événement rejoint 🎉');
      location.hash = '#/e/' + code;
    } catch (err) {
      $('joinErr').textContent = err.message;
    }
  });

  $('heroJoin').addEventListener('click', (e) => {
    e.preventDefault();
    $('joinCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('joinInput').focus(), 350);
  });

  /* ---------- Création d'événement ---------- */
  function openCreate() {
    requireName(() => {
      $('createErr').textContent = '';
      $('createForm').reset();
      $('createModal').hidden = false;
      setTimeout(() => $('evNameInput').focus(), 30);
    });
  }
  $('openCreate').addEventListener('click', openCreate);
  $('heroCreate').addEventListener('click', openCreate);
  $('createCancel').addEventListener('click', () => { $('createModal').hidden = true; });

  $('createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('evNameInput').value.trim();
    const description = $('evDescInput').value.trim();
    if (!name) { $('createErr').textContent = "Donne un nom à ton événement."; return; }
    try {
      const ev = await api('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, creator: state.name }),
      });
      rememberCode(ev.code);
      $('createModal').hidden = true;
      toast(`Événement créé — code ${fmtCode(ev.code)} 🎉`);
      location.hash = '#/e/' + ev.code;
    } catch (err) {
      $('createErr').textContent = err.message;
    }
  });

  /* ---------- Page événement ---------- */
  async function showEvent(code) {
    $('homeView').hidden = true;
    $('eventView').hidden = false;
    resetUpload();
    state.filterAuthor = null;
    if (code.length !== 6) return showInvalid('Ce code est incomplet.');
    try {
      const ev = await api('/api/events/' + code);
      state.currentEvent = ev;
      rememberCode(ev.code); // ouvrir un lien d'invitation = rejoindre l'événement
      renderEvent();
    } catch (err) {
      showInvalid(err.message);
    }
  }

  function showInvalid(message) {
    state.currentEvent = null;
    document.querySelector('.event-banner').hidden = true;
    $('uploadForm').hidden = true;
    $('gallery').innerHTML = '';
    $('galleryEmpty').hidden = true;
    $('notFoundMsg').textContent = message;
    $('notFound').hidden = false;
    document.title = 'Événement introuvable — Tonin Event';
  }

  function renderEvent() {
    const ev = state.currentEvent;
    document.querySelector('.event-banner').hidden = false;
    $('uploadForm').hidden = false;
    $('notFound').hidden = true;
    document.title = `${ev.name} — Tonin Event`;
    $('evName').textContent = ev.name;
    $('evDesc').textContent = ev.description || '';
    $('evDesc').hidden = !ev.description;
    $('evCode').textContent = fmtCode(ev.code);
    $('evCreator').textContent = `Créé par ${ev.creator} · ${fmtDate(ev.createdAt)}`;
    $('evCount').textContent = '📷 ' + plural(ev.photos.length, 'photo', 'photos');
    renderGallery();
  }

  // Clé d'auteur insensible à la casse : "coralie" et "Coralie" = même album
  const authorKey = (name) => String(name || '').trim().toLowerCase();

  function renderGallery() {
    const all = state.currentEvent.photos;

    // Auteurs et nombre de photos (ordre : le plus de photos d'abord)
    const authors = new Map();
    all.forEach((p) => {
      const k = authorKey(p.author);
      if (!authors.has(k)) authors.set(k, { key: k, name: p.author, count: 0 });
      authors.get(k).count++;
    });
    if (state.filterAuthor && !authors.has(state.filterAuthor)) state.filterAuthor = null;

    const photos = state.filterAuthor ? all.filter((p) => authorKey(p.author) === state.filterAuthor) : all;
    state.visiblePhotos = photos;

    // Titre + retour
    const current = state.filterAuthor ? authors.get(state.filterAuthor) : null;
    $('galleryTitle').textContent = current ? `Album de ${current.name}` : 'Galerie';
    $('albumBack').hidden = !current;

    // Pastilles d'albums
    const list = [...authors.values()].sort((a, b) => b.count - a.count);
    $('authorBar').hidden = list.length < 2;
    $('authorBar').innerHTML = list.length < 2 ? '' :
      `<button type="button" class="chip${current ? '' : ' active'}" data-author="">Tous <span>${all.length}</span></button>` +
      list.map((a) => `<button type="button" class="chip${state.filterAuthor === a.key ? ' active' : ''}" data-author="${esc(a.key)}">${esc(a.name)} <span>${a.count}</span></button>`).join('');

    $('galleryEmpty').hidden = all.length > 0;
    $('gallery').innerHTML = photos.map((p, i) => `
      <button class="photo" type="button" data-i="${i}" aria-label="Photo de ${esc(p.author)}">
        <img src="${esc(p.url)}" alt="Photo de ${esc(p.author)} — ${esc(p.eventName)}" loading="lazy" />
        <span class="photo-cap">
          <strong>${esc(p.author)}</strong>
          <span>${esc(p.eventName)}</span>
        </span>
      </button>`).join('');
  }

  $('gallery').addEventListener('click', (e) => {
    const b = e.target.closest('.photo');
    if (b) openLightbox(Number(b.dataset.i));
  });

  // Albums par personne
  function showAlbum(key) {
    state.filterAuthor = key || null;
    renderGallery();
    $('galleryTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('authorBar').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) showAlbum(b.dataset.author);
  });
  $('albumBack').addEventListener('click', () => showAlbum(null));

  $('copyCodeBtn').addEventListener('click', () => {
    if (state.currentEvent) copyText(fmtCode(state.currentEvent.code), 'Code copié ✔');
  });

  $('shareBtn').addEventListener('click', async () => {
    if (!state.currentEvent) return;
    const url = `${location.origin}${location.pathname}#/e/${state.currentEvent.code}`;
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      try {
        await navigator.share({
          title: state.currentEvent.name,
          text: `Rejoins « ${state.currentEvent.name} » sur Tonin Event (code ${fmtCode(state.currentEvent.code)})`,
          url,
        });
        return;
      } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    copyText(url, "Lien d'invitation copié ✔");
  });

  $('leaveBtn').addEventListener('click', () => {
    if (!state.currentEvent) return;
    if (!confirm('Retirer cet événement de ta liste ? Tu pourras le rejoindre à nouveau avec son code.')) return;
    forgetCode(state.currentEvent.code);
    location.hash = '#/';
  });

  /* ---------- Upload ---------- */
  const input = $('photoInput');
  const dz = $('dropzone');

  function resetUpload() {
    state.selected = [];
    input.value = '';
    $('uploadMsg').textContent = '';
    $('uploadMsg').className = 'msg';
    renderPreviews();
  }

  function addFiles(fileList) {
    const msgs = [];
    for (const f of fileList) {
      if (!f.type.startsWith('image/')) { msgs.push(`« ${f.name} » n'est pas une image.`); continue; }
      if (f.size > MAX_SIZE) { msgs.push(`« ${f.name} » dépasse 15 Mo.`); continue; }
      if (state.selected.length >= MAX_FILES) { msgs.push(`${MAX_FILES} photos maximum à la fois.`); break; }
      state.selected.push(f);
    }
    const out = $('uploadMsg');
    out.className = msgs.length ? 'msg msg-err' : 'msg';
    out.textContent = msgs[0] || '';
    renderPreviews();
  }

  function renderPreviews() {
    const box = $('previews');
    box.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
    box.innerHTML = '';
    state.selected.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'thumb';
      const img = document.createElement('img');
      img.alt = f.name;
      img.src = URL.createObjectURL(f);
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Retirer cette photo');
      b.textContent = '✕';
      b.addEventListener('click', () => { state.selected.splice(i, 1); renderPreviews(); });
      d.append(img, b);
      box.appendChild(d);
    });
    $('uploadBtn').disabled = state.selected.length === 0;
    $('uploadBtn').textContent = state.selected.length
      ? `Publier ${plural(state.selected.length, 'photo', 'photos')}`
      : 'Publier les photos';
  }

  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  $('uploadForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.selected.length || !state.currentEvent) return;
    requireName(doUpload);
  });

  function doUpload() {
    const btn = $('uploadBtn');
    const msg = $('uploadMsg');
    const fd = new FormData();
    fd.append('author', state.name);
    state.selected.forEach((f) => fd.append('photos', f));

    btn.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Envoi en cours…';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/events/${encodeURIComponent(state.currentEvent.code)}/photos`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) msg.textContent = `Envoi en cours… ${Math.round((e.loaded / e.total) * 100)} %`;
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300) {
        state.currentEvent = data.event;
        resetUpload();
        renderEvent();
        toast(`${plural(data.added, 'photo publiée', 'photos publiées')} ✔`);
      } else {
        msg.className = 'msg msg-err';
        msg.textContent = data.error || "Échec de l'envoi.";
        btn.disabled = false;
      }
    };
    xhr.onerror = () => {
      msg.className = 'msg msg-err';
      msg.textContent = 'Connexion impossible. Réessaie.';
      btn.disabled = false;
    };
    xhr.send(fd);
  }

  /* ---------- Visionneuse ---------- */
  function openLightbox(i) {
    state.lightboxIndex = i;
    updateLightbox();
    $('lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    $('lightbox').hidden = true;
    document.body.style.overflow = '';
  }
  function stepLightbox(d) {
    const n = state.visiblePhotos.length;
    state.lightboxIndex = (state.lightboxIndex + d + n) % n;
    updateLightbox();
  }
  function updateLightbox() {
    const p = state.visiblePhotos[state.lightboxIndex];
    const key = authorKey(p.author);
    const total = state.currentEvent.photos.filter((x) => authorKey(x.author) === key).length;
    $('lbImg').src = p.url;
    $('lbImg').alt = `Photo ajoutée par ${p.author}`;
    $('lbCaption').innerHTML = `
      <span class="lb-by">Photo ajoutée par</span>
      <strong class="lb-author">${esc(p.author)}</strong>
      <span class="lb-event">${esc(p.eventName)} · ${fmtDate(p.createdAt)}</span>
      ${state.filterAuthor === key ? '' :
        `<button type="button" class="lb-album" data-author="${esc(key)}">Voir l'album de ${esc(p.author)} (${plural(total, 'photo', 'photos')})</button>`}`;
  }
  $('lbCaption').addEventListener('click', (e) => {
    const b = e.target.closest('.lb-album');
    if (!b) return;
    closeLightbox();
    showAlbum(b.dataset.author);
  });
  $('lbClose').addEventListener('click', closeLightbox);
  $('lbPrev').addEventListener('click', () => stepLightbox(-1));
  $('lbNext').addEventListener('click', () => stepLightbox(1));
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });

  document.addEventListener('keydown', (e) => {
    if (!$('lightbox').hidden) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
    } else if (e.key === 'Escape') {
      if (!$('createModal').hidden) $('createModal').hidden = true;
      else if (!$('nameModal').hidden && !$('nameCancel').hidden) closeNameModal();
    }
  });

  /* ---------- Démarrage ---------- */
  loadName();
  route();
  // Demande le prénom dès l'arrivée si inconnu
  if (!state.name) openNameModal(false);

  // Rafraîchissement automatique de la galerie (nouvelles photos des autres)
  setInterval(async () => {
    if (document.hidden || !state.currentEvent || !$('lightbox').hidden) return;
    try {
      const ev = await api('/api/events/' + state.currentEvent.code);
      if (ev.photos.length !== state.currentEvent.photos.length) {
        state.currentEvent = ev;
        renderEvent();
      }
    } catch (_) {}
  }, 15000);
})();
