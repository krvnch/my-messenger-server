// Сервер мессенджера с системой аккаунтов.
// Регистрация/вход — через REST (bcrypt + JWT).
// Socket.io-соединения теперь авторизуются по токену, а не по имени "на слово".

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3001;
// В проде обязательно задай свой JWT_SECRET через переменную окружения!
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const JWT_EXPIRES_IN = "30d";

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

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

// --- База данных ---
let messagesCollection = null;
let dmCollection = null;
let usersCollection = null;

// In-memory fallback для аккаунтов, если Mongo не подключена (данные теряются при рестарте)
const memoryUsers = new Map(); // username -> { username, passwordHash }

async function initDb() {
  if (!process.env.MONGODB_URI) {
    console.log("MONGODB_URI не задан — сообщения и аккаунты хранятся только в памяти (теряются при перезапуске)");
    return;
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("messenger");
  messagesCollection = db.collection("messages");
  dmCollection = db.collection("dms");
  usersCollection = db.collection("users");
  await usersCollection.createIndex({ username: 1 }, { unique: true });
  console.log("Подключено к базе данных — история и аккаунты будут сохраняться");

  const savedMessages = await messagesCollection.find({}).sort({ time: 1 }).toArray();
  messages.push(...savedMessages);

  const savedDms = await dmCollection.find({}).sort({ time: 1 }).toArray();
  savedDms.forEach((m) => {
    const key = dmKey(m.from, m.to);
    if (!dmConversations.has(key)) dmConversations.set(key, []);
    dmConversations.get(key).push(m);
  });
}

// --- Хелперы для аккаунтов ---
async function findUser(username) {
  if (usersCollection) return usersCollection.findOne({ username });
  return memoryUsers.get(username) || null;
}

async function createUser(username, passwordHash) {
  const user = { username, passwordHash, createdAt: new Date().toISOString() };
  if (usersCollection) {
    await usersCollection.insertOne(user);
  } else {
    memoryUsers.set(username, user);
  }
  return user;
}

function makeToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// --- REST: регистрация и вход ---
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Укажите имя пользователя и пароль" });
    }
    if (username.length < 3 || username.length > 24) {
      return res.status(400).json({ error: "Имя пользователя должно быть от 3 до 24 символов" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
    }
    const existing = await findUser(username);
    if (existing) {
      return res.status(409).json({ error: "Такое имя пользователя уже занято" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await createUser(username, passwordHash);
    const token = makeToken(username);
    res.json({ token, username });
  } catch (err) {
    console.error("Ошибка регистрации:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Укажите имя пользователя и пароль" });
    }
    const user = await findUser(username);
    if (!user) {
      return res.status(401).json({ error: "Неверное имя пользователя или пароль" });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Неверное имя пользователя или пароль" });
    }
    const token = makeToken(username);
    res.json({ token, username });
  } catch (err) {
    console.error("Ошибка входа:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// --- Socket.io: авторизация по токену ---
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Требуется авторизация"));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.username = payload.username;
    next();
  } catch (err) {
    next(new Error("Недействительный токен"));
  }
});

io.on("connection", (socket) => {
  console.log("Новое подключение:", socket.id, "как", socket.username);

  socket.on("user:join", ({ avatar } = {}) => {
    const username = socket.username; // берём из проверенного токена, не от клиента
    onlineUsers.set(socket.id, { username, avatar: avatar || null });
    socket.join(CHANNEL);

    socket.emit("messages:history", messages);
    broadcastUserList();

    io.to(CHANNEL).emit("system:message", `${username} присоединился(-ась) к чату`);
  });

  socket.on("user:update", ({ avatar } = {}) => {
    const current = onlineUsers.get(socket.id);
    if (!current) return;
    onlineUsers.set(socket.id, { username: socket.username, avatar: avatar || null });
    broadcastUserList();
  });

  socket.on("message:send", (text) => {
    const author = socket.username || "Аноним";
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
    if (!socket.username) return;
    const key = dmKey(socket.username, otherUsername);
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
    const from = socket.username;
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

    socket.emit("dm:new", message);

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
