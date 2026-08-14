// Простой сервер мессенджера.
// Хранит всё в памяти (при перезапуске сервера история сообщений теряется —
// для прототипа этого достаточно, позже можно подключить базу данных).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // разрешаем подключение с любого устройства в локальной сети
});

app.get("/", (req, res) => {
  res.send("Сервер мессенджера работает. Подключайтесь через приложение.");
});

// Один общий канал "general" для прототипа
const CHANNEL = "general";
const messages = []; // { id, author, text, time }
const onlineUsers = new Map(); // socket.id -> username
const dmConversations = new Map(); // "userA|userB" (отсортированы) -> [{id, from, to, text, time}]

function broadcastUserList() {
  io.emit("users:update", Array.from(onlineUsers.values()));
}

function dmKey(a, b) {
  return [a, b].sort().join("|");
}

function findSocketByUsername(username) {
  for (const [socketId, name] of onlineUsers.entries()) {
    if (name === username) return socketId;
  }
  return null;
}

io.on("connection", (socket) => {
  console.log("Новое подключение:", socket.id);

  socket.on("user:join", (username) => {
    onlineUsers.set(socket.id, username);
    socket.join(CHANNEL);

    // Новому пользователю — вся история сообщений
    socket.emit("messages:history", messages);
    broadcastUserList();

    io.to(CHANNEL).emit("system:message", `${username} присоединился(-ась) к чату`);
  });

  socket.on("message:send", (text) => {
    const author = onlineUsers.get(socket.id) || "Аноним";
    const message = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      author,
      text,
      time: new Date().toISOString(),
    };
    messages.push(message);
    io.to(CHANNEL).emit("message:new", message);
  });

  socket.on("dm:history:request", (otherUsername) => {
    const myUsername = onlineUsers.get(socket.id);
    if (!myUsername) return;
    const key = dmKey(myUsername, otherUsername);
    socket.emit("dm:history", {
      withUser: otherUsername,
      messages: dmConversations.get(key) || [],
    });
  });

  socket.on("dm:send", ({ to, text }) => {
    const from = onlineUsers.get(socket.id);
    if (!from || !text) return;

    const message = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      from,
      to,
      text,
      time: new Date().toISOString(),
    };

    const key = dmKey(from, to);
    if (!dmConversations.has(key)) dmConversations.set(key, []);
    dmConversations.get(key).push(message);

    // Отправляем себе (чтобы сообщение появилось в своём окне)
    socket.emit("dm:new", message);

    // Отправляем получателю, если он сейчас в сети
    const targetSocketId = findSocketByUsername(to);
    if (targetSocketId && targetSocketId !== socket.id) {
      io.to(targetSocketId).emit("dm:new", message);
    }
  });

  socket.on("disconnect", () => {
    const username = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    broadcastUserList();
    if (username) {
      io.to(CHANNEL).emit("system:message", `${username} вышел(-ла) из чата`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Сервер мессенджера запущен на порту ${PORT}`);
  console.log(`Другие смогут подключиться по вашему локальному IP, например: 192.168.x.x:${PORT}`);
});
