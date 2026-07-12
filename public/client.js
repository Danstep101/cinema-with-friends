const socket = io();

let room = null;
let name = null;
let suppressCount = 0;     // счётчик "ожидаемых эхо" от удалённых команд (защита от петли синхронизации)
let suppressResetTimer = null;
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
  onPlay: (time) => { hideResumeOverlay(); if (consumeSuppression()) return; socket.emit('play', { room, time }); },
  onPause: (time) => { if (consumeSuppression()) return; socket.emit('pause', { room, time }); },
  onSeek: (time) => { if (consumeSuppression()) return; socket.emit('seek', { room, time }); },
  onTimeUpdate: (time) => { lastKnownTime = time; }
};

// ---- Защита от эхо-цикла синхронизации ----
// Раньше здесь была защита по таймеру (350мс): если событие от площадки
// (YouTube/RuTube/VK) приходило позже — например, из-за буферизации при
// перемотке — оно ошибочно принималось за собственное действие зрителя
// и повторно рассылалось всем, вызывая бесконечные скачки play/pause.
// Теперь вместо таймера считаем ТОЧНОЕ количество ожидаемых эхо-событий:
// каждое из onPlay/onPause/onSeek гасит ровно одно ожидание, независимо
// от того, сколько времени это заняло. Таймер остался только как
// подстраховка на случай, если ожидаемое событие вообще не пришло
// (например, автовоспроизведение заблокировал браузер).
function expectRemoteEcho(count) {
  suppressCount += count;
  clearTimeout(suppressResetTimer);
  suppressResetTimer = setTimeout(() => { suppressCount = 0; }, 4000);
}

function consumeSuppression() {
  if (suppressCount > 0) { suppressCount--; return true; }
  return false;
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
    getCurrentTime: () => video.currentTime || 0,
    isPaused: () => video.paused
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
            getCurrentTime: () => { try { return player.getCurrentTime() || 0; } catch (e) { return 0; } },
            isPaused: () => { try { return player.getPlayerState() !== YT.PlayerState.PLAYING; } catch (e) { return false; } }
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

// VK: у VK НЕТ публичного API для управления встроенным плеером из JS
// (проверено — официальной документации на такой postMessage-протокол не
// существует, в отличие от YouTube и RuTube). Раньше здесь была попытка
// самодельного "js_api=1" — она молча ничего не делала, отсюда и ощущение
// "всё сломано" именно с VK-ссылками. Честная версия: показываем видео всем
// одинаково (сам плеер встраивается официально), но play/pause/перемотку
// внутри VK-плеера синхронизировать невозможно — зрителям нужно жать play
// вручную примерно одновременно. Также VK Видео переехал на домен vkvideo.ru.
function createVKPlayer(container, payload) {
  const [oid, id, hash] = payload.split('_');
  const src = `https://vkvideo.ru/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ''}`;
  container.innerHTML = `<iframe src="${src}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen frameborder="0"></iframe><div id="video-ticker" class="video-ticker" aria-live="polite"></div>`;
  rebindTickerEl();

  const statusEl = document.getElementById('upload-status');
  if (statusEl) {
    statusEl.textContent = hash
      ? 'Видео из VK показано всем, но play/pause там не синхронизируются (у VK нет API для этого) — договоритесь нажать «play» одновременно.'
      : 'В этой ссылке нет кода доступа (hash) — если видео не откроется, возьмите на VK «Поделиться → Код для вставки» и вставьте сюда целиком.';
  }

  return {
    type: 'vk',
    play: () => {},
    pause: () => {},
    seekTo: () => {},
    getCurrentTime: () => 0
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
        const state = data.data && data.data.state;
        if (state === 'playing') handlers.onPlay(rutubeLastTime);
        else if (state === 'paused' || state === 'pause') handlers.onPause(rutubeLastTime);
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
    currentPlayer = createVKPlayer(playerContainer, payload);
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
  if (sourceType === 'vk') {
    statusEl.textContent = 'Ссылка распознана как VK — у VK нет API для управления плеером, поэтому play/pause/перемотка НЕ синхронизируются, только сам просмотр. Договоритесь нажимать play вручную.';
  } else if (sourceType === 'rutube') {
    statusEl.textContent = 'Ссылка распознана как RuTube — синхронизация play/pause/перемотки экспериментальная (зависит от версии плеера площадки). Если разъезжается — надёжнее «Загрузить файл».';
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
  expectRemoteEcho(2);
  currentPlayer.seekTo(time || 0);
  if (isPlaying) attemptRemotePlay(); else currentPlayer.pause();
});

socket.on('play', ({ time }) => {
  expectRemoteEcho(2);
  if (currentPlayer) attemptRemotePlay(time);
});

socket.on('pause', ({ time }) => {
  expectRemoteEcho(2);
  if (currentPlayer) { currentPlayer.seekTo(time); currentPlayer.pause(); }
  hideResumeOverlay();
});

socket.on('seek', ({ time }) => {
  expectRemoteEcho(1);
  if (currentPlayer) currentPlayer.seekTo(time);
});

// ---- Восстановление после блокировки автовоспроизведения браузером ----
// Некоторые браузеры (особенно мобильные) молча блокируют программный play(),
// если решат, что это не связано с действием пользователя. Раньше это выглядело
// как "у друга видео просто не играет и непонятно почему". Теперь через 1.2с
// после команды на воспроизведение проверяем, реально ли видео идёт — и если
// нет, показываем кнopку, по клику на которую это уже точный жест пользователя,
// так что play() гарантированно сработает.
let autoplayCheckTimer = null;
const resumeOverlayEl = document.getElementById('resume-overlay');

function attemptRemotePlay(time) {
  if (!currentPlayer) return;
  if (typeof time === 'number') currentPlayer.seekTo(time);
  currentPlayer.play();
  clearTimeout(autoplayCheckTimer);
  autoplayCheckTimer = setTimeout(() => {
    if (currentPlayer && currentPlayer.isPaused && currentPlayer.isPaused()) {
      showResumeOverlay();
    }
  }, 1200);
}

function showResumeOverlay() {
  if (resumeOverlayEl) resumeOverlayEl.classList.remove('hidden');
}

function hideResumeOverlay() {
  clearTimeout(autoplayCheckTimer);
  if (resumeOverlayEl) resumeOverlayEl.classList.add('hidden');
}

resumeOverlayEl?.addEventListener('click', () => {
  if (currentPlayer) currentPlayer.play(); // это уже прямой клик пользователя — сработает точно
  hideResumeOverlay();
});

// ---- Ручная и автоматическая пересинхронизация ----
// Если вкладка долго была в фоне (телефон, свернутый браузер), таймеры и видео
// могли "заснуть" и разойтись по времени. При возврате на вкладку и по кнопке
// запрашиваем у сервера актуальное состояние заново.
function requestResync() {
  if (room) socket.emit('request-sync', { room });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestResync();
});

document.getElementById('resync-btn')?.addEventListener('click', requestResync);

// Переподключение сокета (обрыв связи/сон вкладки) — иначе комната навсегда
// "забывает" про этого зрителя до перезагрузки страницы.
socket.on('connect', () => {
  if (room && name) {
    socket.emit('join-room', { room, name });
  }
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
