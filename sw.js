// ── SERVICE WORKER · Hemocentro Almoço ──
const CACHE = 'hemo-v1';

// ── INSTALL & CACHE ──
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  self.clients.claim();
});

// ── BACKGROUND SYNC / NOTIFICAÇÕES AGENDADAS ──
// Recebe mensagem do app principal com os horários
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFS') {
    scheduleAlarms(e.data.alarms);
  }
  if (e.data?.type === 'CANCEL_NOTIFS') {
    clearAlarms();
  }
});

// Armazena os timeouts (no SW eles sobrevivem ao fechamento do app via sync)
const alarmIds = [];

function clearAlarms() {
  alarmIds.forEach(id => clearTimeout(id));
  alarmIds.length = 0;
}

function scheduleAlarms(alarms) {
  clearAlarms();
  const now = Date.now();

  alarms.forEach(alarm => {
    const delay = alarm.ts - now;
    if (delay <= 0) return;

    const id = setTimeout(() => {
      self.registration.showNotification(alarm.title, {
        body: alarm.body,
        icon: 'https://hemocentro-almoco-hc.github.io/almoco/icon.svg',
        badge: 'https://hemocentro-almoco-hc.github.io/almoco/icon.svg',
        tag: alarm.tag || 'hemo-notif',
        requireInteraction: true,
        vibrate: [200, 100, 200],
        actions: [
          { action: 'open', title: '📋 Abrir App' },
          { action: 'dismiss', title: 'Dispensar' }
        ],
        data: { url: alarm.url || '/' }
      });
    }, delay);

    alarmIds.push(id);
  });
}

// ── CLIQUE NA NOTIFICAÇÃO ──
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes('hemocentro'));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ── PERIODIC BACKGROUND SYNC (re-agenda notifs diariamente) ──
self.addEventListener('periodicsync', e => {
  if (e.tag === 'hemo-daily') {
    e.waitUntil(reagendarNotifsDiarias());
  }
});

async function reagendarNotifsDiarias() {
  // Lê preferências salvas no IndexedDB pelo app
  const prefs = await getPrefs();
  if (!prefs) return;

  const alarms = buildAlarms(prefs);
  scheduleAlarms(alarms);
}

// ── INDEXEDDB helpers ──
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('hemo_db', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('prefs');
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function getPrefs() {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction('prefs', 'readonly');
      const req = tx.objectStore('prefs').get('settings');
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  } catch { return null; }
}

// ── CONSTRÓI LISTA DE ALARMES PARA HOJE ──
function buildAlarms(prefs) {
  const now   = new Date();
  const alarms = [];

  // Deadline = 16:00
  const deadline = new Date(now);
  deadline.setHours(16, 0, 0, 0);

  if (prefs.notif1h) {
    const t = new Date(deadline.getTime() - 60 * 60 * 1000); // 15:00
    alarms.push({
      ts:    t.getTime(),
      tag:   'hemo-1h',
      title: '⏰ Hemocentro — Lembrete de Almoço',
      body:  'Falta 1 hora para o prazo de solicitação (16:00). Solicite agora!',
      url:   prefs.appUrl
    });
  }

  if (prefs.notif30m) {
    const t = new Date(deadline.getTime() - 30 * 60 * 1000); // 15:30
    alarms.push({
      ts:    t.getTime(),
      tag:   'hemo-30m',
      title: '⚠️ Hemocentro — Último Aviso!',
      body:  'Faltam apenas 30 minutos! O prazo fecha às 16:00. Solicite já!',
      url:   prefs.appUrl
    });
  }

  return alarms;
}
