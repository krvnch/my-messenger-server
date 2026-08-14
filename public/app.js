let socket = null;
let myName = "";
let myAvatar = null;
let onlineUsersList = []; // [{ username, avatar }]
let authMode = "login"; // "login" | "register"

// Текущий вид: { type: "channel" } или { type: "dm", withUser: "Имя" }
let currentView = { type: "channel" };

// Кэш истории личных переписок, чтобы не запрашивать заново при переключении
const dmCache = new Map(); // username -> [messages]
const channelHistory = []; // общий канал
const lastSeenCache = new Map(); // username -> iso string | null (null = никогда не было видно)

const AVATAR_EMOJIS = ["😀", "😎", "🤖", "🐱", "🐶", "🦊", "🐼", "🐸", "🦄", "🌟", "🔥", "⚡", "🌈", "🍀", "🎧", "🎮", "📚", "☕"];

const connectScreen = document.getElementById("connect-screen");
const app = document.getElementById("app");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const connectBtn = document.getElementById("connect-btn");
const connectError = document.getElementById("connect-error");
const connectSubtitle = document.getElementById("connect-subtitle");
const authSwitchText = document.getElementById("auth-switch-text");
const authSwitchLink = document.getElementById("auth-switch-link");

const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const onlineList = document.getElementById("online-list");
const onlineCount = document.getElementById("online-count");
const meAvatarEl = document.getElementById("me-avatar");
const meNameEl = document.getElementById("me-name");
const chatHeader = document.getElementById("chat-header");
const chatHeaderStatus = document.getElementById("chat-header-status");
const channelGeneralEl = document.getElementById("channel-general");
const sidebarEl = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarOverlay = document.getElementById("sidebar-overlay");

const profileTrigger = document.getElementById("profile-trigger");
const profilePopover = document.getElementById("profile-popover");
const avatarGrid = document.getElementById("avatar-grid");
const saveProfileBtn = document.getElementById("save-profile-btn");
const logoutBtn = document.getElementById("logout-btn");

let popoverSelectedAvatar = null;

function openSidebar() {
  sidebarEl.classList.add("open");
  sidebarOverlay.classList.remove("hidden");
}

function closeSidebar() {
  sidebarEl.classList.remove("open");
  sidebarOverlay.classList.add("hidden");
}

sidebarToggle.addEventListener("click", openSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);

function initials(name) {
  return name.trim().slice(0, 2).toUpperCase();
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatLastSeen(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  const timePart = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} в ${timePart}`;
}

function avatarOf(username) {
  if (username === myName) return myAvatar;
  const u = onlineUsersList.find((u) => u.username === username);
  return u && u.avatar ? u.avatar : null;
}

function isUserOnline(username) {
  return onlineUsersList.some((u) => u.username === username);
}

function renderMeAvatar() {
  meAvatarEl.textContent = myAvatar || initials(myName);
}

function addSystemMessage(text) {
  const div = document.createElement("div");
  div.className = "system-msg";
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(author, text, time) {
  const row = document.createElement("div");
  const isOwn = author === myName;
  row.className = "msg-row " + (isOwn ? "own" : "other");

  const avatar = avatarOf(author);
  const namePart = isOwn ? "Вы" : author;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = `${avatar ? avatar + " " : ""}${namePart} · ${formatTime(time)}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  row.appendChild(meta);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderCurrentView() {
  messagesEl.innerHTML = "";
  if (currentView.type === "channel") {
    channelHistory.forEach((m) => addMessage(m.author, m.text, m.time));
  } else {
    const list = dmCache.get(currentView.withUser) || [];
    list.forEach((m) => addMessage(m.from, m.text, m.time));
  }
}

function updateChatHeaderStatus() {
  if (currentView.type !== "dm") {
    chatHeaderStatus.textContent = "";
    chatHeaderStatus.classList.remove("online");
    return;
  }
  const username = currentView.withUser;
  if (isUserOnline(username)) {
    chatHeaderStatus.textContent = "В сети";
    chatHeaderStatus.classList.add("online");
    return;
  }
  chatHeaderStatus.classList.remove("online");
  const cached = lastSeenCache.get(username);
  if (cached === undefined) {
    chatHeaderStatus.textContent = "…";
    socket.emit("lastseen:request", username);
  } else {
    chatHeaderStatus.textContent = cached ? `Был(а) в сети ${formatLastSeen(cached)}` : "Не в сети";
  }
}

function updateHeaderAndInput() {
  if (currentView.type === "channel") {
    chatHeader.querySelector(".chat-header-title").innerHTML = `<span class="channel-hash">#</span> general`;
    messageInput.placeholder = "Написать в #general";
    channelGeneralEl.classList.add("active");
  } else {
    chatHeader.querySelector(".chat-header-title").textContent = `Личные сообщения — ${currentView.withUser}`;
    messageInput.placeholder = `Написать ${currentView.withUser}`;
    channelGeneralEl.classList.remove("active");
  }
  updateChatHeaderStatus();
}

function switchToChannel() {
  currentView = { type: "channel" };
  updateHeaderAndInput();
  renderCurrentView();
  renderOnlineList(onlineUsersList);
  messageInput.focus();
  closeSidebar();
}

function switchToDm(username) {
  currentView = { type: "dm", withUser: username };
  updateHeaderAndInput();

  if (dmCache.has(username)) {
    renderCurrentView();
  } else {
    messagesEl.innerHTML = "";
    socket.emit("dm:history:request", username);
  }
  renderOnlineList(onlineUsersList);
  messageInput.focus();
  closeSidebar();
}

function renderOnlineList(users) {
  onlineUsersList = users;
  onlineList.innerHTML = "";
  onlineCount.textContent = users.length;
  users.forEach((u) => {
    const li = document.createElement("li");
    const isSelf = u.username === myName;
    const isActive = currentView.type === "dm" && currentView.withUser === u.username;
    li.className = (isSelf ? "self" : "") + (isActive ? " active-dm" : "");
    const avatarHtml = u.avatar ? `<span>${u.avatar}</span>` : `<span class="status-dot"></span>`;
    li.innerHTML = `${avatarHtml} ${escapeHtml(u.username)}${isSelf ? " (вы)" : ""}`;
    if (!isSelf) {
      li.addEventListener("click", () => switchToDm(u.username));
    }
    onlineList.appendChild(li);
  });

  if (currentView.type === "dm") updateChatHeaderStatus();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderAvatarGrid() {
  avatarGrid.innerHTML = "";
  AVATAR_EMOJIS.forEach((emoji) => {
    const opt = document.createElement("div");
    opt.className = "avatar-option" + (popoverSelectedAvatar === emoji ? " selected" : "");
    opt.textContent = emoji;
    opt.addEventListener("click", () => {
      popoverSelectedAvatar = popoverSelectedAvatar === emoji ? null : emoji;
      renderAvatarGrid();
    });
    avatarGrid.appendChild(opt);
  });
}

function openProfilePopover() {
  popoverSelectedAvatar = myAvatar;
  renderAvatarGrid();
  profilePopover.classList.remove("hidden");
}

function closeProfilePopover() {
  profilePopover.classList.add("hidden");
}

profileTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  if (profilePopover.classList.contains("hidden")) openProfilePopover();
  else closeProfilePopover();
});

profilePopover.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => closeProfilePopover());

saveProfileBtn.addEventListener("click", () => {
  myAvatar = popoverSelectedAvatar;
  renderMeAvatar();
  if (socket) socket.emit("user:update", { avatar: myAvatar });
  closeProfilePopover();
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.reload();
});

// --- Аутентификация ---

function setAuthMode(mode) {
  authMode = mode;
  if (mode === "login") {
    connectSubtitle.textContent = "Войдите в свой аккаунт";
    connectBtn.textContent = "Войти";
    authSwitchText.textContent = "Нет аккаунта?";
    authSwitchLink.textContent = "Зарегистрироваться";
    passwordInput.setAttribute("autocomplete", "current-password");
  } else {
    connectSubtitle.textContent = "Создайте новый аккаунт";
    connectBtn.textContent = "Зарегистрироваться";
    authSwitchText.textContent = "Уже есть аккаунт?";
    authSwitchLink.textContent = "Войти";
    passwordInput.setAttribute("autocomplete", "new-password");
  }
  connectError.textContent = "";
}

authSwitchLink.addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(authMode === "login" ? "register" : "login");
});

async function submitAuth() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    connectError.textContent = "Заполните имя пользователя и пароль";
    return;
  }

  connectError.textContent = authMode === "login" ? "Вход..." : "Регистрация...";
  connectBtn.disabled = true;

  try {
    const endpoint = authMode === "login" ? "/api/login" : "/api/register";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      connectError.textContent = data.error || "Что-то пошло не так";
      connectBtn.disabled = false;
      return;
    }

    localStorage.setItem("token", data.token);
    connectWithToken(data.token);
  } catch (err) {
    connectError.textContent = "Не удалось связаться с сервером";
    connectBtn.disabled = false;
  }
}

connectBtn.addEventListener("click", submitAuth);
passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });
usernameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") passwordInput.focus(); });

function connectWithToken(token) {
  socket = io({ auth: { token } });

  socket.on("connect", () => {
    myAvatar = null;
    socket.emit("user:join", { avatar: myAvatar });
  });

  socket.on("connect_error", (err) => {
    connectBtn.disabled = false;
    if (err && err.message === "Недействительный токен") {
      localStorage.removeItem("token");
      connectError.textContent = "Сессия истекла, войдите снова";
    } else {
      connectError.textContent = "Не удалось подключиться. Попробуйте ещё раз.";
    }
  });

  socket.on("messages:history", (history) => {
    // К этому моменту сервер уже принял нас — можно показать приложение
    myName = usernameInput.value.trim() || myName;
    renderMeAvatar();
    meNameEl.textContent = myName;
    connectScreen.classList.add("hidden");
    app.classList.remove("hidden");
    messageInput.focus();

    channelHistory.length = 0;
    channelHistory.push(...history);
    if (currentView.type === "channel") renderCurrentView();
  });

  socket.on("message:new", (msg) => {
    channelHistory.push(msg);
    if (currentView.type === "channel") addMessage(msg.author, msg.text, msg.time);
  });

  socket.on("dm:history", ({ withUser, messages }) => {
    dmCache.set(withUser, messages);
    if (currentView.type === "dm" && currentView.withUser === withUser) {
      renderCurrentView();
    }
  });

  socket.on("dm:new", (msg) => {
    const other = msg.from === myName ? msg.to : msg.from;
    if (!dmCache.has(other)) dmCache.set(other, []);
    dmCache.get(other).push(msg);

    if (currentView.type === "dm" && currentView.withUser === other) {
      addMessage(msg.from, msg.text, msg.time);
    }
  });

  socket.on("lastseen:response", ({ username, lastSeen }) => {
    lastSeenCache.set(username, lastSeen);
    if (currentView.type === "dm" && currentView.withUser === username) {
      updateChatHeaderStatus();
    }
  });

  socket.on("system:message", addSystemMessage);
  socket.on("users:update", renderOnlineList);
}

// Если токен уже сохранён (перезагрузка страницы) — сразу подключаемся,
// минуя форму логина. myName возьмём из первого события users:update.
const savedToken = localStorage.getItem("token");
if (savedToken) {
  // Декодируем username из тела JWT (без проверки подписи — только для UI),
  // подпись всё равно проверяет сервер при подключении.
  try {
    const payload = JSON.parse(atob(savedToken.split(".")[1]));
    myName = payload.username || "";
  } catch (e) {
    // payload не читается — ничего страшного, имя подставится позже
  }
  connectWithToken(savedToken);
}

channelGeneralEl.addEventListener("click", switchToChannel);

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !socket) return;

  if (currentView.type === "channel") {
    socket.emit("message:send", text);
  } else {
    socket.emit("dm:send", { to: currentView.withUser, text });
  }
  messageInput.value = "";
});
