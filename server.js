const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8
});

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- File upload setup ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const room = (req.body.room || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${room}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 } // до 4GB — подстройте под свой хостинг
});

app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Отдаём index.html на прямые заходы без расширения (на случай будущих красивых путей типа /room/XYZ)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) return next();
  if (req.path.includes('.')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// --- Состояние комнат: чтобы зашедший позже видел актуальный момент видео, а не начало ---
// room -> { url, sourceType, isPlaying, currentTime, updatedAt }
const roomState = {};

function effectiveTime(state) {
  if (!state) return 0;
  if (!state.isPlaying) return state.currentTime;
  const elapsedSec = (Date.now() - state.updatedAt) / 1000;
  return state.currentTime + Math.max(0, elapsedSec);
}

function userCount(room) {
  const clients = io.sockets.adapter.rooms.get(room);
  return clients ? clients.size : 0;
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ room, name }) => {
    if (!room) return;
    room = String(room).trim().toUpperCase();
    name = (name || 'Гость').trim().slice(0, 40);

    socket.data.room = room;
    socket.data.name = name;
    socket.join(room);

    const state = roomState[room];
    if (state && state.url) {
      socket.emit('room-state', {
        url: state.url,
        sourceType: state.sourceType,
        isPlaying: state.isPlaying,
        time: effectiveTime(state)
      });
    }

    io.to(room).emit('system-message', `${name} присоединился(лась) к просмотру. Сейчас в комнате: ${userCount(room)}`);
  });

  socket.on('set-video', ({ room, url, sourceType }) => {
    if (!room || !url) return;
    roomState[room] = {
      url,
      sourceType: sourceType || 'file',
      isPlaying: false,
      currentTime: 0,
      updatedAt: Date.now()
    };
    io.to(room).emit('video-source', { url, sourceType: roomState[room].sourceType });
    io.to(room).emit('system-message', `${socket.data.name || 'Кто-то'} выбрал(а) новое видео.`);
  });

  socket.on('play', ({ room, time }) => {
    const state = roomState[room];
    if (state) { state.isPlaying = true; state.currentTime = time || 0; state.updatedAt = Date.now(); }
    socket.to(room).emit('play', { time });
  });

  socket.on('pause', ({ room, time }) => {
    const state = roomState[room];
    if (state) { state.isPlaying = false; state.currentTime = time || 0; state.updatedAt = Date.now(); }
    socket.to(room).emit('pause', { time });
  });

  socket.on('seek', ({ room, time }) => {
    const state = roomState[room];
    if (state) { state.currentTime = time || 0; state.updatedAt = Date.now(); }
    socket.to(room).emit('seek', { time });
  });

  // Периодический "пульс" от клиентов — держит currentTime свежим для тех, кто подключится позже
  socket.on('time-sync', ({ room, time }) => {
    const state = roomState[room];
    if (state && state.isPlaying) {
      state.currentTime = time || 0;
      state.updatedAt = Date.now();
    }
  });

  socket.on('chat-message', ({ room, name, text }) => {
    if (!room || !text) return;
    io.to(room).emit('chat-message', { name: name || 'Гость', text: String(text).slice(0, 500) });
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    const name = socket.data.name || 'Гость';
    if (room) {
      setTimeout(() => {
        io.to(room).emit('system-message', `${name} вышел(а) из комнаты. Осталось: ${userCount(room)}`);
      }, 100);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
