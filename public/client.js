const socket = io();

let room = null;
let name = null;
let isRemoteAction = false; // защита от эхо-цикла при синхронизации
let currentPlayer = null;   // текущий адаптер плеера (file / youtube / vk / rutube)
let lastKnownTime = 0;

const joinScreen = document.getElementById('join-screen');
const roomScreen = document.getElementById('room-screen');
const messagesEl = document.getElementById('messages');
const currentRoomEl = document.getElementById('current-room');
const playerContainer = document.getElementById('player-container');
const hallEl = document.getElementById('hall');
const foyerEl = document.getElementById('foyer');
const videoTickerEl = document.getElementById('video-ticker');
const ticketEl = document.getElementById('ticket');
const joinErrorEl = document.getElementById('join-error');

// =====================================================================
// ИНЛАЙН-ОШИБКИ ВХОДА (вместо alert())
// =====================================================================

function showJoinError(msg) {
  joinErrorEl.textContent = msg;
  joinErrorEl.classList.remove('hidden');
  ticketEl.classList.remove('shake');
  void ticketEl.offsetWidth; // перезапуск анимации
  ticketEl.classList.add('shake');
}

function clearJoinError() {
  joinErrorEl.classList.add('hidden');
}

// =====================================================================
// РОЛЬ КОМНАТЫ: создание / вход по коду / вход по приглашённой ссылке
// =====================================================================

const params = new URLSearchParams(location.search);
const inviteRoom = (params.get('room') || '').trim().toUpperCase();

if (inviteRoom) {
  document.getElementById('invite-banner').classList.remove('hidden');
  document.getElementById('invite-code').textContent = inviteRoom;
  document.getElementById('create-join-actions').classList.add('hidden');
  document.getElementById('invite-join-actions').classList.remove('hidden');
}

document.getElementById('create-btn').addEventListener('click', () => {
  enterRoom(generateRoomCode());
});

document.getElementById('show-code-btn').addEventListener('click', () => {
  document.getElementById('code-entry').classList.toggle('hidden');
});

document.getElementById('join-code-btn').addEventListener('click', () => {
  const code = document.getElementById('room-input').value.trim().toUpperCase();
  if (!code) { showJoinError('Введи код комнаты'); return; }
  enterRoom(code);
});

document.getElementById('room-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('join-code-btn').click();
});

document.getElementById('join-invite-btn').addEventListener('click', () => {
  enterRoom(inviteRoom);
});

document.getElementById('name-input').addEventListener('input', clearJoinError);

function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих символов (0/O, 1/I)
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function enterRoom(code) {
  const nameVal = document.getElementById('name-input').value.trim();
  if (!nameVal) { showJoinError('Введи своё имя, прежде чем зайти в зал'); return; }
  if (!code) return;
  clearJoinError();

  name = nameVal;
  room = code;
  history.replaceState(null, '', `?room=${code}`);

  socket.emit('join-room', { room, name });
  showRoomScreen(code);
}

function showRoomScreen(code) {
  currentRoomEl.textContent = code;
  document.getElementById('invite-link').value = `${location.origin}${location.pathname}?room=${code}`;

  joinScreen.classList.add('fade-out');
  setTimeout(() => {
    joinScreen.classList.add('hidden');
    roomScreen.classList.remove('hidden');
    requestAnimationFrame(() => roomScreen.classList.add('visible'));
  }, 280);
}

// ---- Копирование ссылки-приглашения ----
document.getElementById('copy-link-btn').addEventListener('click', () => {
  const input = document.getElementById('invite-link');
  const btn = document.getElementById('copy-link-btn');
  navigator.clipboard.writeText(input.value).then(() => {
    const old = btn.textContent;
    btn.textContent = '✓ Скопировано';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1800);
  }).catch(() => {
    input.classList.remove('visually-hidden');
    input.select();
    document.execCommand('copy');
    input.classList.add('visually-hidden');
  });
});

// =====================================================================
// ПОЛНОЭКРАННЫЙ РЕЖИМ
// =====================================================================

document.getElementById('fullscreen-btn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    hallEl.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
});

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  hallEl.classList.toggle('is-fullscreen', isFs);
  document.getElementById('fullscreen-btn').textContent = isFs ? '⤢ Свернуть' : '⛶ На весь экран';
  // При выходе из полноэкранного режима чат снова становится обычной
  // видимой панелью — сбрасываем состояние "выдвинуто/задвинуто" и бейдж.
  if (!isFs) {
    foyerEl.classList.remove('open');
    unreadCount = 0;
    updateUnreadBadge();
  }
});

// =====================================================================
// ЧАТ: в обычном режиме — это просто видимая боковая панель (её всегда
// видно, ничего выдвигать не нужно). В полноэкранном режиме видео
// занимает весь экран, поэтому там чат превращается в выдвижную панель
// со стрелкой-табом и бейджем непрочитанных сообщений.
// =====================================================================

const foyerTabEl = document.getElementById('foyer-tab');
const unreadBadgeEl = document.getElementById('unread-badge');
let unreadCount = 0;

function isFullscreenNow() {
  return hallEl.classList.contains('is-fullscreen');
}

// "Чат сейчас виден" — либо мы не в fullscreen (тогда он всегда виден
// сайдбаром), либо мы в fullscreen и панель выдвинута.
function isChatVisible() {
  return !isFullscreenNow() || foyerEl.classList.contains('open');
}

function setFoyerOpen(open) {
  foyerEl.classList.toggle('open', open);
  if (open) {
    unreadCount = 0;
    updateUnreadBadge();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function updateUnreadBadge() {
  if (unreadCount > 0) {
    unreadBadgeEl.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    unreadBadgeEl.classList.remove('hidden');
  } else {
    unreadBadgeEl.classList.add('hidden');
  }
}

foyerTabEl.addEventListener('click', () => setFoyerOpen(!foyerEl.classList.contains('open')));

// =====================================================================
// ОПРЕДЕЛЕНИЕ ИСТОЧНИКА ВИДЕО: файл / YouTube / VK / RuTube
// =====================================================================

function detectSource(raw) {
  const url = raw.trim();

  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (yt) return { sourceType: 'youtube', payload: yt[1] };

  // VK переехал на домен vkvideo.ru, но старые ссылки на vk.com/vk.ru тоже
  // встречаются — распознаём все варианты.
  const vk = url.match(/(?:vk\.com|vkvideo\.ru|vk\.ru|m\.vk\.com)\/video(-?\d+)_(\d+)/);
  if (vk) {
    const hashMatch = url.match(/hash=([a-zA-Z0-9]+)/);
    const hash = hashMatch ? hashMatch[1] : '';
    return { sourceType: 'vk', payload: `${vk[1]}_${vk[2]}_${hash}` };
  }

  const rutube = url.match(/rutube\.ru\/(?:video|play\/embed|shorts)\/([0-9a-zA-Z]+)/);
  if (rutube) return { sourceType: 'rutube', payload: rutube[1] };

  return { sourceType: 'file', payload: url };
}

// =====================================================================
// АДАПТЕРЫ ПЛЕЕРОВ — единый интерфейс: play() / pause() / seekTo() / getCurrentTime()
// =====================================================================

const playerHandlers = {
  onPlay: (time) => { if (!isRemoteAction) socket.emit('play', { room, time }); },
  onPause: (time) => { if (!isRemoteAction) socket.emit('pause', { room, time }); },
  onSeek: (time) => { if (!isRemoteAction) socket.emit('seek', { room, time }); },
  onTimeUpdate: (time) => { lastKnownTime = time; }
};

function withRemoteGuard(fn) {
  isRemoteAction = true;
  fn();
  setTimeout(() => { isRemoteAction = false; }, 350);
}

function createFilePlayer(container, url, handlers) {
  container.innerHTML = '<video id="video" controls playsinline></video><div id="video-ticker" class="video-ticker" aria-live="polite"></div>';
  rebindTickerEl();
  const video = document.getElementById('video');
  video.src = url;

  video.addEventListener('play', () => handlers.onPlay(video.currentTime));
  video.addEventListener('pause', () => handlers.onPause(video.currentTime));
  video.addEventListener('seeked', () => handlers.onSeek(video.currentTime));
  video.addEventListener('timeupdate', () => handlers.onTimeUpdate(video.currentTime));

  return {
    type: 'file',
    play: () => video.play().catch(() => {}),
    pause: () => video.pause(),
    seekTo: (t) => { try { video.currentTime = t; } catch (e) {} },
    getCurrentTime: () => video.currentTime || 0
  };
}

let ytApiReadyPromise = null;
function loadYouTubeAPI() {
  if (ytApiReadyPromise) return ytApiReadyPromise;
  ytApiReadyPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return ytApiReadyPromise;
}

async function createYouTubePlayer(container, videoId, handlers) {
  await loadYouTubeAPI();
  container.innerHTML = '<div id="yt-player"></div><div id="video-ticker" class="video-ticker" aria-live="polite"></div>';
  rebindTickerEl();

  return new Promise((resolve) => {
    const player = new YT.Player('yt-player', {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          resolve({
            type: 'youtube',
            play: () => player.playVideo(),
            pause: () => player.pauseVideo(),
            seekTo: (t) => player.seekTo(t, true),
            getCurrentTime: () => { try { return player.getCurrentTime() || 0; } catch (e) { return 0; } }
          });
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) handlers.onPlay(player.getCurrentTime());
          else if (e.data === YT.PlayerState.PAUSED) handlers.onPause(player.getCurrentTime());
        }
      }
    });
  });
}

// VK: экспериментальная поддержка через postMessage JS API внешнего плеера VK.
// Может не работать со всеми видео (зависит от настроек приватности видео в VK).
let vkMessageListenerAttached = false;
let vkLastTime = 0;

function createVKPlayer(container, payload, handlers) {
  const [oid, id, hash] = payload.split('_');
  const src = `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ''}&js_api=1`;
  container.innerHTML = `<iframe id="vk-player" src="${src}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0"></iframe><div id="video-ticker" class="video-ticker" aria-live="polite"></div>`;
  rebindTickerEl();
  const iframe = document.getElementById('vk-player');

  function post(command, extra = {}) {
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ command, ...extra }), '*');
    } catch (e) {}
  }

  if (!vkMessageListenerAttached) {
    vkMessageListenerAttached = true;
    window.addEventListener('message', (event) => {
      if (currentPlayer?.type !== 'vk' || typeof event.data !== 'string') return;
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (!data || !data.event) return;

      if (data.event === 'playing' || data.event === 'started' || data.event === 'resumed') {
        vkLastTime = data.time || vkLastTime;
        handlers.onPlay(vkLastTime);
      } else if (data.event === 'paused') {
        vkLastTime = data.time || vkLastTime;
        handlers.onPause(vkLastTime);
      } else if (data.event === 'timeupdate') {
        vkLastTime = data.time || vkLastTime;
        handlers.onTimeUpdate(vkLastTime);
      }
    });
  }

  return {
    type: 'vk',
    play: () => post('play'),
    pause: () => post('pause'),
    seekTo: (t) => { vkLastTime = t; post('seek', { time: t }); },
    getCurrentTime: () => vkLastTime
  };
}

// RuTube: экспериментальная поддержка через postMessage API встроенного плеера
// RuTube (формат сообщений вида {type: "player:*", data: {...}}). Как и с VK,
// возможность точной синхронизации зависит от настроек конкретного видео —
// если не заработает, пришлите точный текст поведения, разберёмся.
let rutubeMessageListenerAttached = false;
let rutubeLastTime = 0;

function createRutubePlayer(container, id, handlers) {
  const src = `https://rutube.ru/play/embed/${id}`;
  container.innerHTML = `<iframe id="rutube-player" src="${src}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen frameborder="0"></iframe><div id="video-ticker" class="video-ticker" aria-live="polite"></div>`;
  rebindTickerEl();
  const iframe = document.getElementById('rutube-player');

  function post(type, data = {}) {
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ type, data }), '*');
    } catch (e) {}
  }

  if (!rutubeMessageListenerAttached) {
    rutubeMessageListenerAttached = true;
    window.addEventListener('message', (event) => {
      if (currentPlayer?.type !== 'rutube') return;
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return; }
      }
      if (!data || !data.type) return;

      if (data.type === 'player:changeState') {
        const status = data.data && data.data.status;
        if (status === 'playing') handlers.onPlay(rutubeLastTime);
        else if (status === 'paused') handlers.onPause(rutubeLastTime);
      } else if (data.type === 'player:currentTime') {
        rutubeLastTime = (data.data && data.data.time) || rutubeLastTime;
        handlers.onTimeUpdate(rutubeLastTime);
      }
    });
  }

  return {
    type: 'rutube',
    play: () => post('player:play'),
    pause: () => post('player:pause'),
    seekTo: (t) => { rutubeLastTime = t; post('player:setCurrentTime', { time: t }); },
    getCurrentTime: () => rutubeLastTime
  };
}

async function mountPlayer(sourceType, payload) {
  if (sourceType === 'youtube') {
    currentPlayer = await createYouTubePlayer(playerContainer, payload, playerHandlers);
  } else if (sourceType === 'vk') {
    currentPlayer = createVKPlayer(playerContainer, payload, playerHandlers);
  } else if (sourceType === 'rutube') {
    currentPlayer = createRutubePlayer(playerContainer, payload, playerHandlers);
  } else {
    currentPlayer = createFilePlayer(playerContainer, payload, playerHandlers);
  }
}

// =====================================================================
// УСТАНОВКА ВИДЕО (ссылка или загрузка файла)
// =====================================================================

document.getElementById('set-url-btn').addEventListener('click', () => {
  const raw = document.getElementById('video-url').value.trim();
  if (!raw) return;
  const { sourceType, payload } = detectSource(raw);
  socket.emit('set-video', { room, url: payload, sourceType });

  const statusEl = document.getElementById('upload-status');
  if (sourceType === 'vk' || sourceType === 'rutube') {
    statusEl.textContent = `Ссылка распознана как ${sourceType === 'vk' ? 'VK' : 'RuTube'} — синхронизация play/pause/перемотки тут экспериментальная (зависит от плеера площадки). Если у кого-то не совпадает время — надёжнее «Загрузить файл».`;
  } else {
    statusEl.textContent = '';
  }
});

document.getElementById('video-url').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('set-url-btn').click();
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('upload-status');
  statusEl.textContent = `Загружаем «${file.name}»...`;

  const formData = new FormData();
  formData.append('video', file);
  formData.append('room', room);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('upload failed');
    const data = await res.json();
    socket.emit('set-video', { room, url: data.url, sourceType: 'file' });
    statusEl.textContent = 'Видео загружено и показано всем в зале.';
  } catch (err) {
    statusEl.textContent = 'Не получилось загрузить файл. Попробуйте ссылку или файл поменьше.';
  }
});

// =====================================================================
// СИНХРОНИЗАЦИЯ ОТ СЕРВЕРА
// =====================================================================

socket.on('video-source', async ({ url, sourceType }) => {
  await mountPlayer(sourceType, url);
});

// Зашедший позже получает видео сразу на актуальной секунде, без перемотки в начало
socket.on('room-state', async ({ url, sourceType, isPlaying, time }) => {
  if (!url) return;
  await mountPlayer(sourceType, url);
  withRemoteGuard(() => {
    currentPlayer.seekTo(time || 0);
    if (isPlaying) currentPlayer.play(); else currentPlayer.pause();
  });
});

socket.on('play', ({ time }) => {
  withRemoteGuard(() => {
    if (currentPlayer) { currentPlayer.seekTo(time); currentPlayer.play(); }
  });
});

socket.on('pause', ({ time }) => {
  withRemoteGuard(() => {
    if (currentPlayer) { currentPlayer.seekTo(time); currentPlayer.pause(); }
  });
});

socket.on('seek', ({ time }) => {
  withRemoteGuard(() => {
    if (currentPlayer) currentPlayer.seekTo(time);
  });
});

// Держим currentTime свежим на сервере, чтобы те, кто подключится позже, попали в нужный момент
setInterval(() => {
  if (currentPlayer && room) {
    const t = currentPlayer.getCurrentTime ? currentPlayer.getCurrentTime() : lastKnownTime;
    socket.emit('time-sync', { room, time: t });
  }
}, 4000);

// =====================================================================
// ЧАТ + ТИКЕР (тонкая строка снизу под видео, когда панель чата задвинута)
// =====================================================================

document.getElementById('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-text');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat-message', { room, name, text });
  input.value = '';
});

socket.on('chat-message', ({ name, text }) => {
  addMessage(name, text);

  if (!isChatVisible()) {
    unreadCount++;
    updateUnreadBadge();
    enqueueTicker(name, text);
  }
});

socket.on('system-message', (text) => addSystemMessage(text));

function addMessage(senderName, text) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'msg-name';
  nameSpan.textContent = `${senderName}: `;
  div.appendChild(nameSpan);
  div.appendChild(document.createTextNode(text));
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- Тикер: очередь, чтобы сообщения показывались по одному ----
let tickerQueue = [];
let tickerShowing = false;

function rebindTickerEl() {
  // при пересоздании плеера (смена источника видео) элемент тикера
  // пересоздаётся вместе с контейнером — обновляем ссылку на него
  const el = document.getElementById('video-ticker');
  if (el) currentTickerEl = el;
}
let currentTickerEl = videoTickerEl;

function enqueueTicker(senderName, text) {
  tickerQueue.push({ senderName, text });
  if (tickerQueue.length > 5) tickerQueue = tickerQueue.slice(-5); // не копим бесконечно
  processTickerQueue();
}

function processTickerQueue() {
  if (tickerShowing || tickerQueue.length === 0 || !currentTickerEl) return;
  const { senderName, text } = tickerQueue.shift();
  tickerShowing = true;

  const el = document.createElement('div');
  el.className = 'ticker-msg';
  const nameSpan = document.createElement('span');
  nameSpan.className = 't-name';
  nameSpan.textContent = senderName;
  const textSpan = document.createElement('span');
  textSpan.className = 't-text';
  textSpan.textContent = text;
  el.appendChild(nameSpan);
  el.appendChild(textSpan);

  currentTickerEl.appendChild(el);

  el.addEventListener('animationend', () => {
    el.remove();
    tickerShowing = false;
    processTickerQueue();
  });
}
