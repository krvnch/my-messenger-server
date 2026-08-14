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
const attachBtn = document.getElementById("attach-btn");
const fileInput = document.getElementById("file-input");
const attachmentPreview = document.getElementById("attachment-preview");
const attachmentPreviewName = document.getElementById("attachment-preview-name");
const attachmentRemoveBtn = document.getElementById("attachment-remove-btn");
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

const dmCallBtn = document.getElementById("dm-call-btn");
const channelCallBtn = document.getElementById("channel-call-btn");
const callBar = document.getElementById("call-bar");
const callBarTitle = document.getElementById("call-bar-title");
const callBarParticipants = document.getElementById("call-bar-participants");
const toggleMuteBtn = document.getElementById("toggle-mute-btn");
const toggleScreenBtn = document.getElementById("toggle-screen-btn");
const endCallBtn = document.getElementById("end-call-btn");
const incomingCallModal = document.getElementById("incoming-call-modal");
const incomingCallName = document.getElementById("incoming-call-name");
const incomingCallAvatar = document.getElementById("incoming-call-avatar");
const acceptCallBtn = document.getElementById("accept-call-btn");
const declineCallBtn = document.getElementById("decline-call-btn");
const remoteAudioContainer = document.getElementById("remote-audio-container");

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

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return bytes + " Б";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
  return (bytes / (1024 * 1024)).toFixed(1) + " МБ";
}

function addMessage(author, text, time, attachment) {
  const row = document.createElement("div");
  const isOwn = author === myName;
  row.className = "msg-row " + (isOwn ? "own" : "other");

  const avatar = avatarOf(author);
  const namePart = isOwn ? "Вы" : author;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = `${avatar ? avatar + " " : ""}${namePart} · ${formatTime(time)}`;
  row.appendChild(meta);

  if (attachment) {
    if (attachment.mimeType && attachment.mimeType.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "msg-image";
      img.src = attachment.url;
      img.alt = attachment.name || "изображение";
      img.addEventListener("click", () => window.open(attachment.url, "_blank"));
      row.appendChild(img);
    } else {
      const link = document.createElement("a");
      link.className = "msg-file-chip";
      link.href = attachment.url;
      link.target = "_blank";
      link.rel = "noopener";
      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = "📄";
      const fileMeta = document.createElement("span");
      fileMeta.className = "file-meta";
      const fileName = document.createElement("span");
      fileName.className = "file-name";
      fileName.textContent = attachment.name || "Файл";
      const fileSize = document.createElement("span");
      fileSize.className = "file-size";
      fileSize.textContent = formatFileSize(attachment.size);
      fileMeta.appendChild(fileName);
      fileMeta.appendChild(fileSize);
      link.appendChild(icon);
      link.appendChild(fileMeta);
      row.appendChild(link);
    }
  }

  if (text) {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
  }

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderCurrentView() {
  messagesEl.innerHTML = "";
  if (currentView.type === "channel") {
    channelHistory.forEach((m) => addMessage(m.author, m.text, m.time, m.attachment));
  } else {
    const list = dmCache.get(currentView.withUser) || [];
    list.forEach((m) => addMessage(m.from, m.text, m.time, m.attachment));
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
    dmCallBtn.classList.add("hidden");
  } else {
    chatHeader.querySelector(".chat-header-title").textContent = `Личные сообщения — ${currentView.withUser}`;
    messageInput.placeholder = `Написать ${currentView.withUser}`;
    channelGeneralEl.classList.remove("active");
    dmCallBtn.classList.remove("hidden");
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
  registerConnectionHooks();

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
    if (currentView.type === "channel") addMessage(msg.author, msg.text, msg.time, msg.attachment);
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
      addMessage(msg.from, msg.text, msg.time, msg.attachment);
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

let pendingAttachment = null;
const MAX_CLIENT_FILE_SIZE = 15 * 1024 * 1024; // 15 МБ — должно совпадать с лимитом на сервере

attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;

  if (file.size > MAX_CLIENT_FILE_SIZE) {
    addSystemMessage("Файл слишком большой (максимум 15 МБ)");
    return;
  }

  attachmentPreviewName.textContent = `Загрузка: ${file.name}...`;
  attachmentPreview.classList.remove("hidden");

  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + localStorage.getItem("token") },
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) {
      attachmentPreview.classList.add("hidden");
      addSystemMessage(data.error || "Не удалось загрузить файл");
      return;
    }

    pendingAttachment = data;
    attachmentPreviewName.textContent = `📎 ${data.name}`;
  } catch (err) {
    attachmentPreview.classList.add("hidden");
    addSystemMessage("Не удалось загрузить файл");
  }
});

attachmentRemoveBtn.addEventListener("click", () => {
  pendingAttachment = null;
  attachmentPreview.classList.add("hidden");
});

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text && !pendingAttachment) return;
  if (!socket) return;

  if (currentView.type === "channel") {
    socket.emit("message:send", { text, attachment: pendingAttachment });
  } else {
    socket.emit("dm:send", { to: currentView.withUser, text, attachment: pendingAttachment });
  }

  messageInput.value = "";
  pendingAttachment = null;
  attachmentPreview.classList.add("hidden");
});

// ================= Звонки (WebRTC) =================
// Сервер здесь используется только как "сигналинг" — передаёт SDP/ICE между
// браузерами. Само аудио и показ экрана идут напрямую peer-to-peer, бесплатно.
// STUN-сервер бесплатный (публичный от Google). Без TURN-сервера звонок может
// не пройти у части пользователей за строгим NAT (например, в мобильных сетях) —
// для прототипа это приемлемо, для продакшена стоит добавить бесплатный TURN
// (например, Metered.ca) в массив ICE_SERVERS ниже.

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

let localStream = null; // микрофон
let screenStream = null; // показ экрана (только когда включён)
let isMuted = false;
let isScreenSharing = false;

let dmCallState = null; // null | { peer: username, pc, status: "ringing-out"|"active" }
let incomingCallFrom = null;

const channelCallPeers = new Map(); // socketId -> { username, pc }
let inChannelCall = false;

function registerConnectionHooks() {
  socket.on("call:dm:incoming", ({ from }) => {
    if (dmCallState || inChannelCall) {
      socket.emit("call:dm:decline", { to: from });
      return;
    }
    incomingCallFrom = from;
    incomingCallName.textContent = from;
    incomingCallAvatar.textContent = avatarOf(from) || initials(from);
    incomingCallModal.classList.remove("hidden");
  });

  socket.on("call:dm:accepted", async ({ from }) => {
    if (!dmCallState || dmCallState.peer !== from) return;
    dmCallState.status = "active";
    updateCallBarParticipants();
    await setupDmPeerConnection(from, true);
  });

  socket.on("call:dm:declined", ({ from }) => {
    if (dmCallState && dmCallState.peer === from) {
      addSystemMessage(`${from} отклонил(а) звонок`);
      endDmCall(false);
    }
  });

  socket.on("call:dm:unavailable", ({ to }) => {
    addSystemMessage(`${to} сейчас недоступен(на) для звонка`);
    endDmCall(false);
  });

  socket.on("call:dm:ended", ({ from }) => {
    if (dmCallState && dmCallState.peer === from) {
      addSystemMessage(`${from} завершил(а) звонок`);
      endDmCall(false);
    }
  });

  socket.on("call:dm:signal", async ({ from, data }) => {
    if (!dmCallState || dmCallState.peer !== from || !dmCallState.pc) return;
    await handleSignal(dmCallState.pc, data, (answerData) => {
      socket.emit("call:dm:signal", { to: from, data: answerData });
    });
  });

  socket.on("call:room:count", (count) => {
    if (!inChannelCall) {
      channelCallBtn.textContent = count > 0 ? `🎤 Присоединиться к звонку (${count})` : "🎤 Присоединиться к звонку";
    }
  });

  socket.on("call:room:participants", async (participants) => {
    for (const p of participants) {
      await addChannelPeer(p.socketId, p.username, true);
    }
    updateCallBarParticipants();
  });

  socket.on("call:room:peer-joined", ({ socketId, username }) => {
    // Ждём offer от нового участника — он сам инициирует соединение с нами.
    if (inChannelCall) updateCallBarParticipants();
  });

  socket.on("call:room:peer-left", ({ socketId }) => {
    removeChannelPeer(socketId);
  });

  socket.on("call:room:signal", async ({ from, username, data }) => {
    let entry = channelCallPeers.get(from);
    if (!entry) entry = await addChannelPeer(from, username, false);
    await handleSignal(entry.pc, data, (answerData) => {
      socket.emit("call:room:signal", { to: from, data: answerData });
    });
  });
}

// Общая обработка входящего SDP/ICE-сообщения для любой peer connection
async function handleSignal(pc, data, sendAnswer) {
  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendAnswer(pc.localDescription);
  } else if (data.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(data);
    } catch (e) {
      // кандидат мог прийти до setRemoteDescription — безопасно игнорируем
    }
  }
}

async function getMic() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return localStream;
}

function stopMic() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
}

function createPeerConnection(onIceCandidate, onTrack) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => {
    if (e.candidate) onIceCandidate(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
  };
  pc.ontrack = (e) => onTrack(e.streams[0]);
  return pc;
}

// ----- DM звонки -----

dmCallBtn.addEventListener("click", () => {
  if (currentView.type !== "dm") return;
  startDmCall(currentView.withUser);
});

async function startDmCall(toUsername) {
  if (dmCallState || inChannelCall) {
    addSystemMessage("Сначала завершите текущий звонок");
    return;
  }
  try {
    await getMic();
  } catch (e) {
    addSystemMessage("Нет доступа к микрофону");
    return;
  }
  dmCallState = { peer: toUsername, pc: null, status: "ringing-out" };
  socket.emit("call:dm:invite", { to: toUsername });
  showCallBar(`Звоним: ${toUsername}`);
}

acceptCallBtn.addEventListener("click", async () => {
  incomingCallModal.classList.add("hidden");
  const from = incomingCallFrom;
  incomingCallFrom = null;
  if (!from) return;
  try {
    await getMic();
  } catch (e) {
    socket.emit("call:dm:decline", { to: from });
    addSystemMessage("Нет доступа к микрофону");
    return;
  }
  dmCallState = { peer: from, pc: null, status: "active" };
  socket.emit("call:dm:accept", { to: from });
  await setupDmPeerConnection(from, false);
  showCallBar(`Звонок: ${from}`);
});

declineCallBtn.addEventListener("click", () => {
  incomingCallModal.classList.add("hidden");
  if (incomingCallFrom) socket.emit("call:dm:decline", { to: incomingCallFrom });
  incomingCallFrom = null;
});

// isCaller === true -> мы звонили и собеседник принял, поэтому мы создаём offer
async function setupDmPeerConnection(peerUsername, isCaller) {
  const pc = createPeerConnection(
    (candidate) => socket.emit("call:dm:signal", { to: peerUsername, data: candidate }),
    (stream) => playRemoteStream(peerUsername, stream)
  );
  dmCallState.pc = pc;
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call:dm:signal", { to: peerUsername, data: pc.localDescription });
  }
}

function endDmCall(notifyPeer) {
  if (dmCallState) {
    if (notifyPeer) socket.emit("call:dm:end", { to: dmCallState.peer });
    if (dmCallState.pc) dmCallState.pc.close();
    dmCallState = null;
  }
  clearRemoteAudio();
  stopScreenShare();
  stopMic();
  hideCallBar();
}

// ----- Групповой звонок в #general -----

channelCallBtn.addEventListener("click", () => {
  if (inChannelCall) {
    leaveChannelCall();
  } else {
    joinChannelCall();
  }
});

async function joinChannelCall() {
  if (dmCallState) {
    addSystemMessage("Сначала завершите текущий звонок");
    return;
  }
  try {
    await getMic();
  } catch (e) {
    addSystemMessage("Нет доступа к микрофону");
    return;
  }
  inChannelCall = true;
  channelCallBtn.textContent = "🎤 Покинуть звонок";
  channelCallBtn.classList.add("in-call");
  socket.emit("call:room:join");
  showCallBar("Звонок в #general");
}

async function addChannelPeer(socketId, username, isCaller) {
  if (channelCallPeers.has(socketId)) return channelCallPeers.get(socketId);
  const pc = createPeerConnection(
    (candidate) => socket.emit("call:room:signal", { to: socketId, data: candidate }),
    (stream) => playRemoteStream(socketId, stream)
  );
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  const entry = { username, pc };
  channelCallPeers.set(socketId, entry);
  updateCallBarParticipants();

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call:room:signal", { to: socketId, data: pc.localDescription });
  }
  return entry;
}

function removeChannelPeer(socketId) {
  const entry = channelCallPeers.get(socketId);
  if (entry) {
    entry.pc.close();
    removeRemoteAudio(socketId);
    channelCallPeers.delete(socketId);
  }
  updateCallBarParticipants();
}

function leaveChannelCall() {
  socket.emit("call:room:leave");
  channelCallPeers.forEach((entry, id) => {
    entry.pc.close();
    removeRemoteAudio(id);
  });
  channelCallPeers.clear();
  inChannelCall = false;
  channelCallBtn.textContent = "🎤 Присоединиться к звонку";
  channelCallBtn.classList.remove("in-call");
  stopScreenShare();
  stopMic();
  hideCallBar();
}

// ----- Общее: аудио собеседников, мьют, показ экрана, панель звонка -----

function playRemoteStream(key, stream) {
  let audioEl = document.getElementById("remote-audio-" + key);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = "remote-audio-" + key;
    audioEl.autoplay = true;
    remoteAudioContainer.appendChild(audioEl);
  }
  audioEl.srcObject = stream;
}

function removeRemoteAudio(key) {
  const audioEl = document.getElementById("remote-audio-" + key);
  if (audioEl) audioEl.remove();
}

function clearRemoteAudio() {
  remoteAudioContainer.innerHTML = "";
}

function showCallBar(title) {
  callBarTitle.textContent = title;
  updateCallBarParticipants();
  callBar.classList.remove("hidden");
}

function updateCallBarParticipants() {
  if (inChannelCall) {
    const names = Array.from(channelCallPeers.values()).map((e) => e.username);
    callBarParticipants.textContent = names.length ? "Участники: " + names.join(", ") : "Вы первый(-ая) в звонке";
  } else if (dmCallState) {
    callBarTitle.textContent = dmCallState.status === "ringing-out" ? `Звоним: ${dmCallState.peer}` : `Звонок: ${dmCallState.peer}`;
    callBarParticipants.textContent = dmCallState.status === "ringing-out" ? "Гудки..." : "Соединено";
  }
}

function hideCallBar() {
  callBar.classList.add("hidden");
  isMuted = false;
  toggleMuteBtn.textContent = "🎤";
  toggleMuteBtn.classList.remove("active");
}

toggleMuteBtn.addEventListener("click", () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  toggleMuteBtn.textContent = isMuted ? "🔇" : "🎤";
  toggleMuteBtn.classList.toggle("active", isMuted);
});

toggleScreenBtn.addEventListener("click", () => {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
});

function activePeerConnections() {
  const pcs = [];
  if (dmCallState && dmCallState.pc) pcs.push(dmCallState.pc);
  channelCallPeers.forEach((e) => pcs.push(e.pc));
  return pcs;
}

async function startScreenShare() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch (e) {
    return; // пользователь отменил выбор окна/экрана
  }
  screenStream = stream;
  const track = stream.getVideoTracks()[0];
  isScreenSharing = true;
  toggleScreenBtn.classList.add("active");

  // Добавление новой дорожки к уже установленному соединению требует повторного
  // согласования (renegotiation) — создаём и отправляем новый offer вручную.
  for (const pc of activePeerConnections()) {
    pc.addTrack(track, screenStream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendRenegotiationOffer(pc, offer);
  }

  track.onended = () => stopScreenShare();
}

function sendRenegotiationOffer(pc, offer) {
  if (dmCallState && dmCallState.pc === pc) {
    socket.emit("call:dm:signal", { to: dmCallState.peer, data: offer });
    return;
  }
  for (const [socketId, entry] of channelCallPeers.entries()) {
    if (entry.pc === pc) {
      socket.emit("call:room:signal", { to: socketId, data: offer });
      return;
    }
  }
}

async function stopScreenShare() {
  if (!isScreenSharing) return;
  isScreenSharing = false;
  toggleScreenBtn.classList.remove("active");

  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }

  for (const pc of activePeerConnections()) {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) {
      pc.removeTrack(sender);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendRenegotiationOffer(pc, offer);
    }
  }
}

endCallBtn.addEventListener("click", () => {
  if (dmCallState) endDmCall(true);
  else if (inChannelCall) leaveChannelCall();
});
