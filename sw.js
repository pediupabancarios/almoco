// ── SERVICE WORKER · Hemocentro Almoço v3 ──
// Estratégia: Push Notifications via servidor externo (mais confiável)
// + fallback com verificação no fetch/sync

const APP_URL = 'https://pediupabancarios.github.io/almoco/';
const CACHE_NAME = 'hemo-v3';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg'];

// ── INSTALL: cacheia os arquivos ──
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(() => {}))
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', e => {
  self.clients.claim();
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

// ── FETCH: serve do cache (app funciona offline) ──
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
  // Aproveita cada fetch para verificar se está na hora de notificar
  checkAndNotify();
});

// ── SYNC: acionado quando o dispositivo reconecta ──
self.addEventListener('sync', e => {
  if (e.tag === 'hemo-check') {
    e.waitUntil(checkAndNotify());
  }
});

// ── PERIODIC SYNC: acionado periodicamente pelo sistema ──
self.addEventListener('periodicsync', e => {
  if (e.tag === 'hemo-daily') {
    e.waitUntil(checkAndNotify());
  }
});

// ── MENSAGEM DO APP: agenda alarme ──
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFS') {
    saveAlarmPrefs(e.data.prefs);
  }
  if (e.data?.type === 'CHECK_NOW') {
    checkAndNotify();
  }
});

// ── CLIQUE NA NOTIFICAÇÃO ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes('almoco'));
      if (existing) return existing.focus();
      return self.clients.openWindow(APP_URL);
    })
  );
});

// ── IndexedDB ──
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('hemo_db', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('prefs'))   db.createObjectStore('prefs');
      if (!db.objectStoreNames.contains('notified')) db.createObjectStore('notified');
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbSet(store, key, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

async function saveAlarmPrefs(prefs) {
  await dbSet('prefs', 'settings', prefs);
}

// ── VERIFICA HORÁRIO E DISPARA NOTIFICAÇÃO ──
async function checkAndNotify() {
  try {
    const prefs = await dbGet('prefs', 'settings');
    if (!prefs) return;

    const now      = new Date();
    const h        = now.getHours();
    const m        = now.getMinutes();
    const today    = now.toDateString();

    // Não notifica após 16h ou antes das 14h
    if (h >= 16 || h < 14) return;

    // Chave do dia para não repetir
    const key1h  = `1h-${today}`;
    const key30m = `30m-${today}`;

    // Lembrete 1h antes = 15:00 (entre 15:00 e 15:10)
    if (prefs.notif1h && h === 15 && m >= 0 && m < 10) {
      const jaNotificou = await dbGet('notified', key1h);
      if (!jaNotificou) {
        await dispararNotificacao({
          title: '⏰ Hemocentro — Almoço',
          body:  'Falta 1 hora! Prazo de solicitação encerra às 16:00. Solicite agora!',
          tag:   'hemo-1h',
          urgente: false
        });
        await dbSet('notified', key1h, true);
      }
    }

    // Lembrete 30min antes = 15:30 (entre 15:30 e 15:40)
    if (prefs.notif30m && h === 15 && m >= 30 && m < 40) {
      const jaNotificou = await dbGet('notified', key30m);
      if (!jaNotificou) {
        await dispararNotificacao({
          title: '⚠️ Hemocentro — ÚLTIMO AVISO',
          body:  'Faltam apenas 30 minutos! O prazo fecha às 16:00. Não perca!',
          tag:   'hemo-30m',
          urgente: true
        });
        await dbSet('notified', key30m, true);
      }
    }
  } catch (err) {
    console.error('[SW] checkAndNotify erro:', err);
  }
}

async function dispararNotificacao({ title, body, tag, urgente }) {
  const vibrar = urgente
    ? [300, 100, 300, 100, 300, 100, 600] // padrão urgente
    : [200, 100, 200];                     // padrão normal

  await self.registration.showNotification(title, {
    body,
    tag,
    icon:             './icon.svg',
    badge:            './icon.svg',
    requireInteraction: true,          // não some sozinha
    silent:           false,           // som + vibração
    vibrate:          vibrar,
    renotify:         true,
    actions: [
      { action: 'open',    title: '📋 Solicitar Almoço' },
      { action: 'dismiss', title: 'Já solicitei ✓' }
    ],
    data: { url: APP_URL }
  });
}
