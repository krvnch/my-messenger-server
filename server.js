// Простой сервер мессенджера.
// Хранит всё в памяти (при перезапуске сервера история сообщений теряется —
// для прототипа этого достаточно, позже можно подключить базу данных).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

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
const onlineUsers = new Map(); // socket.id -> { username, avatar }
const lastSeen = new Map(); // username -> ISO-время последнего выхода
const dmConversations = new Map(); // "userA|userB" (отсортированы) -> [{id, from, to, text, time}]

function broadcastUserList() {
  io.emit("users:update", Array.from(onlineUsers.values()));
}

function dmKey(a, b) {
  return [a, b].sort().join("|");
}

function findSocketByUsername(username) {
  for (const [socketId, u] of onlineUsers.entries()) {
    if (u.username === username) return socketId;
  }
  return null;
}

// --- База данных (необязательная) ---
// Если переменная окружения MONGODB_URI не задана, сервер работает
// как раньше — история хранится только в памяти и теряется при перезапуске.
let messagesCollection = null;
let dmCollection = null;

async function initDb() {
  if (!process.env.MONGODB_URI) {
    console.log("MONGODB_URI не задан — история хранится только в памяти (теряется при перезапуске)");
    return;
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("messenger");
  messagesCollection = db.collection("messages");
  dmCollection = db.collection("dms");
  console.log("Подключено к базе данных — история сообщений будет сохраняться");

  const savedMessages = await messagesCollection.find({}).sort({ time: 1 }).toArray();
  messages.push(...savedMessages);

  const savedDms = await dmCollection.find({}).sort({ time: 1 }).toArray();
  savedDms.forEach((m) => {
    const key = dmKey(m.from, m.to);
    if (!dmConversations.has(key)) dmConversations.set(key, []);
    dmConversations.get(key).push(m);
  });
}

io.on("connection", (socket) => {
  console.log("Новое подключение:", socket.id);

  socket.on("user:join", ({ username, avatar }) => {
    onlineUsers.set(socket.id, { username, avatar: avatar || null });
    socket.join(CHANNEL);

    // Новому пользователю — вся история сообщений
    socket.emit("messages:history", messages);
    broadcastUserList();

    io.to(CHANNEL).emit("system:message", `${username} присоединился(-ась) к чату`);
  });

  socket.on("user:update", ({ username, avatar }) => {
    const current = onlineUsers.get(socket.id);
    if (!current) return;
    onlineUsers.set(socket.id, { username, avatar: avatar || null });
    broadcastUserList();
  });

  socket.on("message:send", (text) => {
    const author = (onlineUsers.get(socket.id) || {}).username || "Аноним";
    const message = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      author,
      text,
      time: new Date().toISOString(),
    };
    messages.push(message);
    io.to(CHANNEL).emit("message:new", message);
    if (messagesCollection) messagesCollection.insertOne(message).catch(console.error);
  });

  socket.on("dm:history:request", (otherUsername) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    const key = dmKey(me.username, otherUsername);
    const isOnline = !!findSocketByUsername(otherUsername);
    socket.emit("dm:history", {
      withUser: otherUsername,
      messages: dmConversations.get(key) || [],
      online: isOnline,
      lastSeen: isOnline ? null : lastSeen.get(otherUsername) || null,
    });
  });

  socket.on("lastseen:request", (username) => {
    const isOnline = !!findSocketByUsername(username);
    socket.emit("lastseen:response", {
      username,
      online: isOnline,
      lastSeen: isOnline ? null : lastSeen.get(username) || null,
    });
  });

  socket.on("dm:send", ({ to, text }) => {
    const me = onlineUsers.get(socket.id);
    const from = me && me.username;
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
    if (dmCollection) dmCollection.insertOne(message).catch(console.error);

    // Отправляем себе (чтобы сообщение появилось в своём окне)
    socket.emit("dm:new", message);

    // Отправляем получателю, если он сейчас в сети
    const targetSocketId = findSocketByUsername(to);
    if (targetSocketId && targetSocketId !== socket.id) {
      io.to(targetSocketId).emit("dm:new", message);
    }
  });

  socket.on("disconnect", () => {
    const user = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    if (user) {
      lastSeen.set(user.username, new Date().toISOString());
      broadcastUserList();
      io.to(CHANNEL).emit("system:message", `${user.username} вышел(-ла) из чата`);
    } else {
      broadcastUserList();
    }
  });
});

initDb()
  .catch((err) => console.error("Не удалось подключиться к базе данных:", err.message))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Сервер мессенджера запущен на порту ${PORT}`);
      console.log(`Другие смогут подключиться по вашему локальному IP, например: 192.168.x.x:${PORT}`);
    });
  });
