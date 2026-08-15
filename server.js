// Сервер мессенджера с системой аккаунтов.
// Регистрация/вход — через REST (bcrypt + JWT).
// Socket.io-соединения теперь авторизуются по токену, а не по имени "на слово".

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3001;
// В проде обязательно задай свой JWT_SECRET через переменную окружения!
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const JWT_EXPIRES_IN = "30d";
// Короткоживущий токен для второго шага входа (пароль верный, ждём код 2FA)
const TWOFA_TEMP_EXPIRES_IN = "10m";

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// --- Загрузка файлов и картинок ---
// По умолчанию файлы пишутся на локальный диск (для Render это временное
// хранилище — теряется при каждом деплое/рестарте). Чтобы файлы хранились
// постоянно, задай переменные окружения для S3-совместимого хранилища
// (подходит и Cloudflare R2, и AWS S3, и Backblaze B2):
//   S3_ENDPOINT           — для R2: https://<account_id>.r2.cloudflarestorage.com
//   S3_BUCKET             — имя бакета
//   S3_ACCESS_KEY_ID
//   S3_SECRET_ACCESS_KEY
//   S3_REGION             — для R2 можно "auto"
//   S3_PUBLIC_BASE_URL    — публичный домен, по которому отдаются файлы
//                           (например, R2 public bucket URL или свой CDN)
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 МБ

const S3_ENABLED = !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
let s3Client = null;
if (S3_ENABLED) {
  const { S3Client } = require("@aws-sdk/client-s3");
  s3Client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!process.env.S3_FORCE_PATH_STYLE,
  });
  console.log("Постоянное файловое хранилище: S3/R2 (" + process.env.S3_BUCKET + ")");
} else {
  console.log("S3_BUCKET не задан — файлы пишутся на локальный диск (не переживёт редеплой на Render)");
}

const upload = S3_ENABLED
  ? multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } })
  : multer({
      storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOADS_DIR),
        filename: (req, file, cb) => {
          const ext = path.extname(file.originalname || "").slice(0, 10);
          cb(null, crypto.randomBytes(16).toString("hex") + ext);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE },
    });

async function uploadToS3(file) {
  const { PutObjectCommand } = require("@aws-sdk/client-s3");
  const ext = path.extname(file.originalname || "").slice(0, 10);
  const key = "uploads/" + crypto.randomBytes(16).toString("hex") + ext;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  const base = (process.env.S3_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/${key}` : `/${key}`;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Требуется авторизация" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.username = payload.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Недействительный токен" });
  }
}

app.post("/api/upload", requireAuth, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "Файл больше 15 МБ" : "Не удалось загрузить файл";
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: "Файл не получен" });
    try {
      const url = S3_ENABLED ? await uploadToS3(req.file) : "/uploads/" + req.file.filename;
      res.json({
        url,
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      });
    } catch (uploadErr) {
      console.error("Ошибка загрузки в S3:", uploadErr);
      res.status(500).json({ error: "Не удалось сохранить файл" });
    }
  });
});

// --- ICE-серверы для WebRTC-звонков ---
// Публичный STUN бесплатный, но за строгим NAT (частая ситуация в мобильных
// сетях) звонок пройдёт только через TURN-сервер. Задай переменные окружения,
// чтобы отдавать клиенту рабочий TURN:
//   TURN_URLS        — через запятую, например "turn:turn.example.com:3478,turns:turn.example.com:5349"
//   TURN_USERNAME
//   TURN_CREDENTIAL
// Бесплатные варианты: развернуть свой coturn на дешёвом VPS, либо
// использовать бесплатный лимит сервиса вроде Metered.ca / Twilio NTS.
app.get("/api/ice-servers", requireAuth, (req, res) => {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({
      urls: process.env.TURN_URLS.split(",").map((s) => s.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers: servers });
});

// --- Rate-limiting на регистрацию/вход (защита от брутфорса) ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток. Попробуйте позже." },
});
const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Попробуйте позже." },
});

// Один общий канал "general" для прототипа
const CHANNEL = "general";
const messages = []; // { id, author, text, time, attachment, replyTo, reactions, edited, deleted }
const onlineUsers = new Map(); // socket.id -> { username, avatar }
const lastSeen = new Map(); // username -> ISO-время последнего выхода
const dmConversations = new Map(); // "userA|userB" (отсортированы) -> [{id, from, to, text, time, ...}]
const typingChannel = new Set(); // username-ов, которые сейчас печатают в #general
const typingDm = new Map(); // "userA|userB" -> Set(username), кто печатает в этой переписке

// --- Группы ---
const groups = new Map(); // groupId -> { id, name, description, avatar, owner, admins: [username], members: [username], createdAt }
const groupMessages = new Map(); // groupId -> [ {id, author, text, time, attachment, replyTo, reactions, edited, deleted} ]
const typingGroup = new Map(); // groupId -> Set(username)

const VALID_STATUSES = new Set(["online", "away", "dnd"]);
function normalizeStatus(status) {
  return VALID_STATUSES.has(status) ? status : "online";
}

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

function findSocketsByUsernames(usernames) {
  const set = new Set(usernames);
  const ids = [];
  for (const [socketId, u] of onlineUsers.entries()) {
    if (set.has(u.username)) ids.push(socketId);
  }
  return ids;
}

// --- Звонки: сервер только передаёт сигналинг (SDP/ICE), само аудио/видео идёт
// напрямую между браузерами по WebRTC и через сервер не проходит.
const channelCallParticipants = new Map(); // socket.id -> username (кто сейчас в звонке #general)

function broadcastChannelCallCount() {
  io.to(CHANNEL).emit("call:room:count", channelCallParticipants.size);
}

// --- База данных ---
let messagesCollection = null;
let dmCollection = null;
let usersCollection = null;
let groupsCollection = null;
let groupMessagesCollection = null;

// In-memory fallback для аккаунтов, если Mongo не подключена (данные теряются при рестарте)
const memoryUsers = new Map(); // username -> { username, passwordHash, recoveryCodeHash }

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
  groupsCollection = db.collection("groups");
  groupMessagesCollection = db.collection("groupMessages");
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

  const savedGroups = await groupsCollection.find({}).toArray();
  savedGroups.forEach((g) => groups.set(g.id, g));

  const savedGroupMessages = await groupMessagesCollection.find({}).sort({ time: 1 }).toArray();
  savedGroupMessages.forEach((m) => {
    if (!groupMessages.has(m.groupId)) groupMessages.set(m.groupId, []);
    groupMessages.get(m.groupId).push(m);
  });
}

// --- Хелперы для аккаунтов ---
async function findUser(username) {
  if (usersCollection) return usersCollection.findOne({ username });
  return memoryUsers.get(username) || null;
}

async function createUser(username, passwordHash, recoveryCodeHash) {
  const user = { username, passwordHash, recoveryCodeHash, createdAt: new Date().toISOString() };
  if (usersCollection) {
    await usersCollection.insertOne(user);
  } else {
    memoryUsers.set(username, user);
  }
  return user;
}

async function updateUserPassword(username, passwordHash) {
  if (usersCollection) {
    await usersCollection.updateOne({ username }, { $set: { passwordHash } });
  } else {
    const u = memoryUsers.get(username);
    if (u) u.passwordHash = passwordHash;
  }
}

// --- Хелперы для 2FA (TOTP) ---
async function setUserTwoFactorTempSecret(username, tempSecret) {
  if (usersCollection) {
    await usersCollection.updateOne({ username }, { $set: { twoFactorTempSecret: tempSecret } });
  } else {
    const u = memoryUsers.get(username);
    if (u) u.twoFactorTempSecret = tempSecret;
  }
}

async function enableUserTwoFactor(username, secret) {
  if (usersCollection) {
    await usersCollection.updateOne(
      { username },
      { $set: { twoFactorEnabled: true, twoFactorSecret: secret }, $unset: { twoFactorTempSecret: "" } }
    );
  } else {
    const u = memoryUsers.get(username);
    if (u) {
      u.twoFactorEnabled = true;
      u.twoFactorSecret = secret;
      delete u.twoFactorTempSecret;
    }
  }
}

async function disableUserTwoFactor(username) {
  if (usersCollection) {
    await usersCollection.updateOne(
      { username },
      { $set: { twoFactorEnabled: false }, $unset: { twoFactorSecret: "", twoFactorTempSecret: "" } }
    );
  } else {
    const u = memoryUsers.get(username);
    if (u) {
      u.twoFactorEnabled = false;
      delete u.twoFactorSecret;
      delete u.twoFactorTempSecret;
    }
  }
}

function makeToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Генерирует человекочитаемый код восстановления вида XXXX-XXXX-XXXX
function generateRecoveryCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без похожих символов (0/O, 1/I)
  const part = () =>
    Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
  return `${part()}-${part()}-${part()}`;
}

// --- REST: регистрация и вход ---
app.post("/api/register", authLimiter, async (req, res) => {
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
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, 10);
    await createUser(username, passwordHash, recoveryCodeHash);
    const token = makeToken(username);
    // Код восстановления возвращается только один раз, при регистрации —
    // сервер хранит лишь его хэш и не сможет показать его снова.
    res.json({ token, username, recoveryCode });
  } catch (err) {
    console.error("Ошибка регистрации:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

app.post("/api/login", strictAuthLimiter, async (req, res) => {
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
    if (user.twoFactorEnabled) {
      // Пароль верный, но нужен ещё код из приложения-аутентификатора —
      // выдаём короткоживущий промежуточный токен вместо полноценной сессии.
      const tempToken = jwt.sign({ username, purpose: "2fa" }, JWT_SECRET, { expiresIn: TWOFA_TEMP_EXPIRES_IN });
      return res.json({ need2FA: true, tempToken });
    }
    const token = makeToken(username);
    res.json({ token, username });
  } catch (err) {
    console.error("Ошибка входа:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// --- REST: второй шаг входа — проверка кода 2FA ---
app.post("/api/login/2fa", strictAuthLimiter, async (req, res) => {
  try {
    const { tempToken, code } = req.body || {};
    if (!tempToken || !code) {
      return res.status(400).json({ error: "Укажите код подтверждения" });
    }
    let payload;
    try {
      payload = jwt.verify(tempToken, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: "Сессия входа истекла, попробуйте снова" });
    }
    if (payload.purpose !== "2fa") return res.status(401).json({ error: "Недействительный токен" });
    const user = await findUser(payload.username);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ error: "2FA не включена для этого аккаунта" });
    }
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: String(code).trim(),
      window: 1,
    });
    if (!verified) {
      return res.status(401).json({ error: "Неверный код" });
    }
    const token = makeToken(payload.username);
    res.json({ token, username: payload.username });
  } catch (err) {
    console.error("Ошибка входа (2FA):", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// --- REST: смена пароля из настроек (нужен текущий пароль) ---
app.post("/api/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Заполните все поля" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Новый пароль должен быть не короче 6 символов" });
    }
    const user = await findUser(req.username);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Текущий пароль неверен" });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await updateUserPassword(req.username, passwordHash);
    res.json({ ok: true });
  } catch (err) {
    console.error("Ошибка смены пароля:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// --- REST: настройка 2FA (TOTP) ---
app.post("/api/2fa/setup", requireAuth, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({ length: 20, name: `Флоу (${req.username})` });
    await setUserTwoFactorTempSecret(req.username, secret.base32);
    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrDataUrl });
  } catch (err) {
    console.error("Ошибка настройки 2FA:", err);
    res.status(500).json({ error: "Не удалось начать настройку 2FA" });
  }
});

app.post("/api/2fa/enable", requireAuth, async (req, res) => {
  try {
    const { code } = req.body || {};
    const user = await findUser(req.username);
    if (!user || !user.twoFactorTempSecret) {
      return res.status(400).json({ error: "Сначала запросите настройку 2FA" });
    }
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorTempSecret,
      encoding: "base32",
      token: String(code || "").trim(),
      window: 1,
    });
    if (!verified) return res.status(400).json({ error: "Неверный код, попробуйте ещё раз" });
    await enableUserTwoFactor(req.username, user.twoFactorTempSecret);
    res.json({ ok: true });
  } catch (err) {
    console.error("Ошибка включения 2FA:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

app.post("/api/2fa/disable", requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    const user = await findUser(req.username);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    const ok = await bcrypt.compare(password || "", user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Неверный пароль" });
    await disableUserTwoFactor(req.username);
    res.json({ ok: true });
  } catch (err) {
    console.error("Ошибка отключения 2FA:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

app.get("/api/2fa/status", requireAuth, async (req, res) => {
  const user = await findUser(req.username);
  res.json({ enabled: !!(user && user.twoFactorEnabled) });
});

// --- REST: восстановление пароля по коду восстановления ---
// Примечание: в прототипе нет почтового сервиса, поэтому восстановление
// работает через одноразовый код, который выдаётся один раз при регистрации.
// Пользователь должен сохранить его сам. Для продакшена стоит заменить
// на отправку кода по email через сервис вроде SendGrid/Resend.
app.post("/api/forgot-password", strictAuthLimiter, async (req, res) => {
  try {
    const { username, recoveryCode, newPassword } = req.body || {};
    if (!username || !recoveryCode || !newPassword) {
      return res.status(400).json({ error: "Заполните все поля" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
    }
    const user = await findUser(username);
    if (!user || !user.recoveryCodeHash) {
      return res.status(400).json({ error: "Неверный код восстановления" });
    }
    const ok = await bcrypt.compare(recoveryCode.trim().toUpperCase(), user.recoveryCodeHash);
    if (!ok) {
      return res.status(400).json({ error: "Неверный код восстановления" });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await updateUserPassword(username, passwordHash);
    const token = makeToken(username);
    res.json({ token, username });
  } catch (err) {
    console.error("Ошибка восстановления пароля:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// --- Группы: REST для списка (создание/удаление идут через сокеты, т.к. требуют realtime-уведомлений) ---
function groupsForUser(username) {
  return Array.from(groups.values()).filter((g) => g.members.includes(username));
}

function sanitizeGroup(g) {
  return {
    id: g.id,
    name: g.name,
    description: g.description || "",
    avatar: g.avatar || null,
    owner: g.owner,
    admins: g.admins || [],
    members: g.members,
    createdAt: g.createdAt,
  };
}

// Владелец группы — всегда админ; плюс явный список назначенных админов.
function isGroupAdmin(group, username) {
  return !!group && (group.owner === username || (group.admins || []).includes(username));
}

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

function groupRoom(groupId) {
  return "group:" + groupId;
}

function findMessageById(list, id) {
  return list.find((m) => m.id === id);
}

function canModify(message, username) {
  return message && message.author === username && !message.deleted;
}

io.on("connection", (socket) => {
  console.log("Новое подключение:", socket.id, "как", socket.username);

  socket.on("user:join", ({ avatar, status } = {}) => {
    const username = socket.username; // берём из проверенного токена, не от клиента
    onlineUsers.set(socket.id, { username, avatar: avatar || null, status: normalizeStatus(status) });
    socket.join(CHANNEL);

    // Присоединяем к комнатам всех групп, в которых пользователь состоит
    groupsForUser(username).forEach((g) => socket.join(groupRoom(g.id)));

    socket.emit("messages:history", messages);
    socket.emit("call:room:count", channelCallParticipants.size);
    socket.emit("group:list", groupsForUser(username).map(sanitizeGroup));
    broadcastUserList();

    io.to(CHANNEL).emit("system:message", `${username} присоединился(-ась) к чату`);
  });

  socket.on("user:update", ({ avatar, status } = {}) => {
    const current = onlineUsers.get(socket.id);
    if (!current) return;
    onlineUsers.set(socket.id, {
      username: socket.username,
      avatar: avatar !== undefined ? avatar || null : current.avatar,
      status: status !== undefined ? normalizeStatus(status) : current.status,
    });
    broadcastUserList();
  });

  // Отдельное лёгкое событие для смены статуса (например, авто-"Отошёл" по бездействию)
  socket.on("status:update", ({ status } = {}) => {
    const current = onlineUsers.get(socket.id);
    if (!current) return;
    current.status = normalizeStatus(status);
    broadcastUserList();
  });

  // --- Печатает... (индикатор набора текста) ---
  socket.on("typing:start", ({ scope, target } = {}) => {
    if (!socket.username) return;
    if (scope === "channel") {
      typingChannel.add(socket.username);
      socket.to(CHANNEL).emit("typing:update", { scope, username: socket.username, typing: true });
    } else if (scope === "dm" && target) {
      const key = dmKey(socket.username, target);
      if (!typingDm.has(key)) typingDm.set(key, new Set());
      typingDm.get(key).add(socket.username);
      const targetSocketId = findSocketByUsername(target);
      if (targetSocketId) {
        io.to(targetSocketId).emit("typing:update", { scope, username: socket.username, typing: true });
      }
    } else if (scope === "group" && target && groups.has(target)) {
      if (!typingGroup.has(target)) typingGroup.set(target, new Set());
      typingGroup.get(target).add(socket.username);
      socket.to(groupRoom(target)).emit("typing:update", { scope, target, username: socket.username, typing: true });
    }
  });

  socket.on("typing:stop", ({ scope, target } = {}) => {
    if (!socket.username) return;
    if (scope === "channel") {
      typingChannel.delete(socket.username);
      socket.to(CHANNEL).emit("typing:update", { scope, username: socket.username, typing: false });
    } else if (scope === "dm" && target) {
      const key = dmKey(socket.username, target);
      if (typingDm.has(key)) typingDm.get(key).delete(socket.username);
      const targetSocketId = findSocketByUsername(target);
      if (targetSocketId) {
        io.to(targetSocketId).emit("typing:update", { scope, username: socket.username, typing: false });
      }
    } else if (scope === "group" && target) {
      if (typingGroup.has(target)) typingGroup.get(target).delete(socket.username);
      socket.to(groupRoom(target)).emit("typing:update", { scope, target, username: socket.username, typing: false });
    }
  });

  // --- Сообщения в #general ---
  socket.on("message:send", ({ text, attachment, replyTo } = {}) => {
    const author = socket.username || "Аноним";
    if (!text && !attachment) return;
    const message = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      author,
      text: text || "",
      attachment: attachment || null,
      time: new Date().toISOString(),
      replyTo: replyTo && replyTo.id ? { id: replyTo.id, author: replyTo.author, text: (replyTo.text || "").slice(0, 200) } : null,
      reactions: {},
      edited: false,
      deleted: false,
    };
    messages.push(message);
    io.to(CHANNEL).emit("message:new", message);
    if (messagesCollection) messagesCollection.insertOne(message).catch(console.error);
  });

  socket.on("message:edit", ({ id, text } = {}) => {
    const message = findMessageById(messages, id);
    if (!canModify(message, socket.username) || !text) return;
    message.text = text;
    message.edited = true;
    io.to(CHANNEL).emit("message:updated", message);
    if (messagesCollection) messagesCollection.updateOne({ id }, { $set: { text, edited: true } }).catch(console.error);
  });

  socket.on("message:delete", ({ id } = {}) => {
    const message = findMessageById(messages, id);
    if (!canModify(message, socket.username)) return;
    message.deleted = true;
    message.text = "";
    message.attachment = null;
    io.to(CHANNEL).emit("message:updated", message);
    if (messagesCollection) messagesCollection.updateOne({ id }, { $set: { deleted: true, text: "", attachment: null } }).catch(console.error);
  });

  socket.on("message:react", ({ id, emoji } = {}) => {
    const message = findMessageById(messages, id);
    if (!message || !emoji || !socket.username) return;
    if (!message.reactions[emoji]) message.reactions[emoji] = [];
    const idx = message.reactions[emoji].indexOf(socket.username);
    if (idx === -1) message.reactions[emoji].push(socket.username);
    else message.reactions[emoji].splice(idx, 1);
    if (message.reactions[emoji].length === 0) delete message.reactions[emoji];
    io.to(CHANNEL).emit("message:updated", message);
    if (messagesCollection) messagesCollection.updateOne({ id }, { $set: { reactions: message.reactions } }).catch(console.error);
  });

  // --- Личные сообщения ---
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

  socket.on("dm:send", ({ to, text, attachment, replyTo }) => {
    const from = socket.username;
    if (!from || (!text && !attachment)) return;

    const message = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      from,
      to,
      text: text || "",
      attachment: attachment || null,
      time: new Date().toISOString(),
      replyTo: replyTo && replyTo.id ? { id: replyTo.id, author: replyTo.author, text: (replyTo.text || "").slice(0, 200) } : null,
      reactions: {},
      edited: false,
      deleted: false,
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

  function dmMessageAndPeer(id, peer) {
    if (!socket.username) return null;
    const key = dmKey(socket.username, peer);
    const list = dmConversations.get(key) || [];
    const msg = list.find((m) => m.id === id);
    return msg;
  }

  socket.on("dm:edit", ({ id, to, text } = {}) => {
    const message = dmMessageAndPeer(id, to);
    if (!message || message.from !== socket.username || !text) return;
    message.text = text;
    message.edited = true;
    emitDmUpdate(message, to);
  });

  socket.on("dm:delete", ({ id, to } = {}) => {
    const message = dmMessageAndPeer(id, to);
    if (!message || message.from !== socket.username) return;
    message.deleted = true;
    message.text = "";
    message.attachment = null;
    emitDmUpdate(message, to);
  });

  socket.on("dm:react", ({ id, to, emoji } = {}) => {
    const message = dmMessageAndPeer(id, to);
    if (!message || !emoji || !socket.username) return;
    if (!message.reactions) message.reactions = {};
    if (!message.reactions[emoji]) message.reactions[emoji] = [];
    const idx = message.reactions[emoji].indexOf(socket.username);
    if (idx === -1) message.reactions[emoji].push(socket.username);
    else message.reactions[emoji].splice(idx, 1);
    if (message.reactions[emoji].length === 0) delete message.reactions[emoji];
    emitDmUpdate(message, to);
  });

  function emitDmUpdate(message, peer) {
    socket.emit("dm:updated", message);
    const targetSocketId = findSocketByUsername(peer);
    if (targetSocketId && targetSocketId !== socket.id) {
      io.to(targetSocketId).emit("dm:updated", message);
    }
    if (dmCollection) {
      dmCollection
        .updateOne({ id: message.id }, { $set: { text: message.text, edited: !!message.edited, deleted: !!message.deleted, attachment: message.attachment, reactions: message.reactions } })
        .catch(console.error);
    }
  }

  // --- Группы ---
  socket.on("group:create", ({ name, description, avatar, members } = {}) => {
    const owner = socket.username;
    if (!owner || !name || !name.trim()) return;
    const cleanMembers = Array.from(new Set([owner, ...((members || []).filter((m) => typeof m === "string"))]));
    const group = {
      id: crypto.randomBytes(8).toString("hex"),
      name: name.trim().slice(0, 40),
      description: (description || "").trim().slice(0, 200),
      avatar: avatar || null,
      owner,
      admins: [],
      members: cleanMembers,
      createdAt: new Date().toISOString(),
    };
    groups.set(group.id, group);
    groupMessages.set(group.id, []);
    if (groupsCollection) groupsCollection.insertOne(group).catch(console.error);

    const sanitized = sanitizeGroup(group);
    const memberSocketIds = findSocketsByUsernames(cleanMembers);
    memberSocketIds.forEach((sid) => {
      const s = io.sockets.sockets.get(sid);
      if (s) s.join(groupRoom(group.id));
    });
    io.to(groupRoom(group.id)).emit("group:created", sanitized);
  });

  function persistGroup(group) {
    if (groupsCollection) {
      groupsCollection
        .updateOne({ id: group.id }, { $set: sanitizeGroup(group) })
        .catch(console.error);
    }
  }

  // Название/описание/аватар — может менять владелец или любой админ группы
  socket.on("group:update", ({ groupId, name, description, avatar } = {}) => {
    const group = groups.get(groupId);
    if (!group || !isGroupAdmin(group, socket.username)) return;
    if (typeof name === "string" && name.trim()) group.name = name.trim().slice(0, 40);
    if (typeof description === "string") group.description = description.trim().slice(0, 200);
    if (avatar !== undefined) group.avatar = avatar || null;
    persistGroup(group);
    io.to(groupRoom(groupId)).emit("group:updated", sanitizeGroup(group));
  });

  // Добавление участников — владелец или админ
  socket.on("group:members:add", ({ groupId, members } = {}) => {
    const group = groups.get(groupId);
    if (!group || !isGroupAdmin(group, socket.username)) return;
    const toAdd = (members || []).filter((m) => typeof m === "string" && !group.members.includes(m));
    if (!toAdd.length) return;
    group.members.push(...toAdd);
    persistGroup(group);
    const sanitized = sanitizeGroup(group);
    findSocketsByUsernames(toAdd).forEach((sid) => {
      const s = io.sockets.sockets.get(sid);
      if (s) s.join(groupRoom(group.id));
    });
    io.to(groupRoom(groupId)).emit("group:updated", sanitized);
  });

  // Удаление (кик) участника — владелец или админ; владельца выгнать нельзя,
  // админа может выгнать только сам владелец.
  socket.on("group:members:remove", ({ groupId, username } = {}) => {
    const group = groups.get(groupId);
    if (!group || !isGroupAdmin(group, socket.username)) return;
    if (username === group.owner) return;
    if ((group.admins || []).includes(username) && socket.username !== group.owner) return;
    const idx = group.members.indexOf(username);
    if (idx === -1) return;
    group.members.splice(idx, 1);
    group.admins = (group.admins || []).filter((a) => a !== username);
    persistGroup(group);
    const targetSocketId = findSocketByUsername(username);
    if (targetSocketId) {
      const s = io.sockets.sockets.get(targetSocketId);
      if (s) {
        s.leave(groupRoom(groupId));
        s.emit("group:removed", { groupId });
      }
    }
    io.to(groupRoom(groupId)).emit("group:updated", sanitizeGroup(group));
  });

  // Назначение/снятие админа — только владелец
  socket.on("group:admins:set", ({ groupId, username, isAdmin } = {}) => {
    const group = groups.get(groupId);
    if (!group || group.owner !== socket.username) return;
    if (username === group.owner || !group.members.includes(username)) return;
    group.admins = group.admins || [];
    const has = group.admins.includes(username);
    if (isAdmin && !has) group.admins.push(username);
    else if (!isAdmin && has) group.admins = group.admins.filter((a) => a !== username);
    persistGroup(group);
    io.to(groupRoom(groupId)).emit("group:updated", sanitizeGroup(group));
  });

  socket.on("group:remove", ({ groupId } = {}) => {
    const group = groups.get(groupId);
    if (!group || group.owner !== socket.username) return;
    groups.delete(groupId);
    groupMessages.delete(groupId);
    if (groupsCollection) groupsCollection.deleteOne({ id: groupId }).catch(console.error);
    if (groupMessagesCollection) groupMessagesCollection.deleteMany({ groupId }).catch(console.error);
    io.to(groupRoom(groupId)).emit("group:removed", { groupId });
    io.in(groupRoom(groupId)).socketsLeave(groupRoom(groupId));
  });

  socket.on("group:history:request", (groupId) => {
    const group = groups.get(groupId);
    if (!group || !socket.username || !group.members.includes(socket.username)) return;
    socket.emit("group:history", { groupId, messages: groupMessages.get(groupId) || [] });
  });

  socket.on("group:send", ({ groupId, text, attachment, replyTo } = {}) => {
    const author = socket.username;
    const group = groups.get(groupId);
    if (!author || !group || !group.members.includes(author)) return;
    if (!text && !attachment) return;
    const message = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      groupId,
      author,
      text: text || "",
      attachment: attachment || null,
      time: new Date().toISOString(),
      replyTo: replyTo && replyTo.id ? { id: replyTo.id, author: replyTo.author, text: (replyTo.text || "").slice(0, 200) } : null,
      reactions: {},
      edited: false,
      deleted: false,
    };
    if (!groupMessages.has(groupId)) groupMessages.set(groupId, []);
    groupMessages.get(groupId).push(message);
    io.to(groupRoom(groupId)).emit("group:message:new", message);
    if (groupMessagesCollection) groupMessagesCollection.insertOne(message).catch(console.error);
  });

  socket.on("group:message:edit", ({ groupId, id, text } = {}) => {
    const list = groupMessages.get(groupId) || [];
    const message = findMessageById(list, id);
    if (!canModify(message, socket.username) || !text) return;
    message.text = text;
    message.edited = true;
    io.to(groupRoom(groupId)).emit("group:message:updated", message);
    if (groupMessagesCollection) groupMessagesCollection.updateOne({ id }, { $set: { text, edited: true } }).catch(console.error);
  });

  socket.on("group:message:delete", ({ groupId, id } = {}) => {
    const list = groupMessages.get(groupId) || [];
    const message = findMessageById(list, id);
    if (!canModify(message, socket.username)) return;
    message.deleted = true;
    message.text = "";
    message.attachment = null;
    io.to(groupRoom(groupId)).emit("group:message:updated", message);
    if (groupMessagesCollection) groupMessagesCollection.updateOne({ id }, { $set: { deleted: true, text: "", attachment: null } }).catch(console.error);
  });

  socket.on("group:message:react", ({ groupId, id, emoji } = {}) => {
    const list = groupMessages.get(groupId) || [];
    const message = findMessageById(list, id);
    if (!message || !emoji || !socket.username) return;
    if (!message.reactions) message.reactions = {};
    if (!message.reactions[emoji]) message.reactions[emoji] = [];
    const idx = message.reactions[emoji].indexOf(socket.username);
    if (idx === -1) message.reactions[emoji].push(socket.username);
    else message.reactions[emoji].splice(idx, 1);
    if (message.reactions[emoji].length === 0) delete message.reactions[emoji];
    io.to(groupRoom(groupId)).emit("group:message:updated", message);
    if (groupMessagesCollection) groupMessagesCollection.updateOne({ id }, { $set: { reactions: message.reactions } }).catch(console.error);
  });

  // --- Звонки в личные сообщения: приглашение / ответ / завершение ---
  socket.on("call:dm:invite", ({ to }) => {
    if (!socket.username) return;
    const targetSocketId = findSocketByUsername(to);
    if (!targetSocketId) {
      socket.emit("call:dm:unavailable", { to });
      return;
    }
    io.to(targetSocketId).emit("call:dm:incoming", { from: socket.username });
  });

  socket.on("call:dm:accept", ({ to }) => {
    const callerSocketId = findSocketByUsername(to);
    if (callerSocketId) io.to(callerSocketId).emit("call:dm:accepted", { from: socket.username });
  });

  socket.on("call:dm:decline", ({ to }) => {
    const callerSocketId = findSocketByUsername(to);
    if (callerSocketId) io.to(callerSocketId).emit("call:dm:declined", { from: socket.username });
  });

  socket.on("call:dm:end", ({ to }) => {
    const targetSocketId = findSocketByUsername(to);
    if (targetSocketId) io.to(targetSocketId).emit("call:dm:ended", { from: socket.username });
  });

  socket.on("call:dm:signal", ({ to, data }) => {
    const targetSocketId = findSocketByUsername(to);
    if (targetSocketId) io.to(targetSocketId).emit("call:dm:signal", { from: socket.username, data });
  });

  // --- Групповой звонок в #general (mesh: сервер только знакомит участников) ---
  socket.on("call:room:join", () => {
    if (!socket.username) return;
    const existing = Array.from(channelCallParticipants.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, username]) => ({ socketId: id, username }));

    channelCallParticipants.set(socket.id, socket.username);
    socket.emit("call:room:participants", existing);
    socket.to(CHANNEL).emit("call:room:peer-joined", { socketId: socket.id, username: socket.username });
    broadcastChannelCallCount();
  });

  socket.on("call:room:leave", () => {
    if (!channelCallParticipants.has(socket.id)) return;
    channelCallParticipants.delete(socket.id);
    socket.to(CHANNEL).emit("call:room:peer-left", { socketId: socket.id });
    broadcastChannelCallCount();
  });

  socket.on("call:room:signal", ({ to, data }) => {
    io.to(to).emit("call:room:signal", { from: socket.id, username: socket.username, data });
  });

  socket.on("disconnect", () => {
    const user = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);

    if (channelCallParticipants.has(socket.id)) {
      channelCallParticipants.delete(socket.id);
      socket.to(CHANNEL).emit("call:room:peer-left", { socketId: socket.id });
      broadcastChannelCallCount();
    }

    if (user) {
      typingChannel.delete(user.username);
      typingDm.forEach((set) => set.delete(user.username));
      typingGroup.forEach((set) => set.delete(user.username));
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
