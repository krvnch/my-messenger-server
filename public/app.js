let socket = null;
let myName = "";
let myAvatar = localStorage.getItem("myAvatar") || null;
let myStatus = localStorage.getItem("myStatus") || "online"; // "online" | "away" | "dnd"
let onlineUsersList = []; // [{ username, avatar, status }]
let authMode = "login"; // "login" | "register" | "forgot"
let pendingTempToken = null; // хранит tempToken между шагом пароля и шагом 2FA при входе

// Непрочитанные сообщения: channel — число, dm/group — Map(key -> {count, mention})
let unreadChannel = 0;
const unreadDm = new Map(); // username -> { count, mention }
const unreadGroup = new Map(); // groupId -> { count, mention }

// Push-уведомления браузера (Notification API)
let notificationsEnabled = localStorage.getItem("notificationsEnabled") === "on";

// Автоматический статус "Отошёл" при бездействии
const IDLE_AWAY_MS = 5 * 60 * 1000; // 5 минут без активности
let idleTimer = null;
let autoAway = false;

// Текущий вид: { type: "channel" } | { type: "dm", withUser } | { type: "group", groupId, name }
let currentView = { type: "channel" };

// Кэш истории личных переписок, чтобы не запрашивать заново при переключении
const dmCache = new Map(); // username -> [messages]
const channelHistory = []; // общий канал
const lastSeenCache = new Map(); // username -> iso string | null (null = никогда не было видно)

// Группы
const groupsList = []; // [{id, name, owner, members}]
const groupCache = new Map(); // groupId -> [messages]

// Печатает…
const typingTimers = new Map(); // key -> timeout id (авто-скрытие индикатора)
let myTypingActive = false;
let myTypingTimeout = null;

// Ответ на сообщение (reply)
let pendingReply = null; // { id, author, text }

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

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
const voiceRecordBtn = document.getElementById("voice-record-btn");
const voiceRecordingBar = document.getElementById("voice-recording-bar");
const voiceRecordingTime = document.getElementById("voice-recording-time");
const voiceCancelBtn = document.getElementById("voice-cancel-btn");
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

const themeToggleBtn = document.getElementById("theme-toggle-btn");
const soundToggleBtn = document.getElementById("sound-toggle-btn");
const audioSettingsBtn = document.getElementById("audio-settings-btn");
const audioSettingsModal = document.getElementById("audio-settings-modal");
const audioSettingsCloseBtn = document.getElementById("audio-settings-close-btn");
const micSelect = document.getElementById("mic-select");
const speakerSelect = document.getElementById("speaker-select");
const audioQualityHint = document.getElementById("audio-quality-hint");
const micTestBtn = document.getElementById("mic-test-btn");
const micLevelFill = document.getElementById("mic-level-fill");
const typingIndicatorEl = document.getElementById("typing-indicator");

const passwordFieldGroup = document.getElementById("password-field-group");
const recoveryFieldGroup = document.getElementById("recovery-field-group");
const recoveryCodeInput = document.getElementById("recovery-code-input");
const newPasswordInput = document.getElementById("new-password-input");
const forgotPasswordLink = document.getElementById("forgot-password-link");
const recoveryCodeModal = document.getElementById("recovery-code-modal");
const recoveryCodeDisplay = document.getElementById("recovery-code-display");
const recoveryCodeOkBtn = document.getElementById("recovery-code-ok-btn");
const twofaFieldGroup = document.getElementById("twofa-field-group");
const twofaCodeInput = document.getElementById("twofa-code-input");

const replyPreview = document.getElementById("reply-preview");
const replyPreviewText = document.getElementById("reply-preview-text");
const replyRemoveBtn = document.getElementById("reply-remove-btn");

const groupListEl = document.getElementById("group-list");
const createGroupBtn = document.getElementById("create-group-btn");
const createGroupModal = document.getElementById("create-group-modal");
const groupNameInput = document.getElementById("group-name-input");
const groupDescriptionInput = document.getElementById("group-description-input");
const groupAvatarGrid = document.getElementById("group-avatar-grid");
const groupMembersList = document.getElementById("group-members-list");
const groupCreateCancelBtn = document.getElementById("group-create-cancel-btn");
const groupCreateConfirmBtn = document.getElementById("group-create-confirm-btn");
const groupDeleteBtn = document.getElementById("group-delete-btn");
const groupSettingsBtn = document.getElementById("group-settings-btn");

const groupSettingsModal = document.getElementById("group-settings-modal");
const groupEditNameInput = document.getElementById("group-edit-name-input");
const groupEditDescriptionInput = document.getElementById("group-edit-description-input");
const groupEditAvatarGrid = document.getElementById("group-edit-avatar-grid");
const groupEditMembersList = document.getElementById("group-edit-members-list");
const groupEditAddSection = document.getElementById("group-edit-add-section");
const groupEditAddList = document.getElementById("group-edit-add-list");
const groupSettingsCloseBtn = document.getElementById("group-settings-close-btn");
const groupSettingsSaveBtn = document.getElementById("group-settings-save-btn");

const channelUnreadBadge = document.getElementById("channel-unread-badge");
const notifToggleBtn = document.getElementById("notif-toggle-btn");
const meStatusDot = document.getElementById("me-status-dot");
const statusPicker = document.getElementById("status-picker");

const openSecurityBtn = document.getElementById("open-security-btn");
const securityModal = document.getElementById("security-modal");
const securityCloseBtn = document.getElementById("security-close-btn");
const currentPasswordInput = document.getElementById("current-password-input");
const changePasswordInput = document.getElementById("change-password-input");
const changePasswordBtn = document.getElementById("change-password-btn");
const securityError = document.getElementById("security-error");
const twofaDisabledBlock = document.getElementById("twofa-disabled-block");
const twofaSetupBlock = document.getElementById("twofa-setup-block");
const twofaEnabledBlock = document.getElementById("twofa-enabled-block");
const twofaSetupBtn = document.getElementById("twofa-setup-btn");
const twofaQrImg = document.getElementById("twofa-qr-img");
const twofaSecretText = document.getElementById("twofa-secret-text");
const twofaConfirmInput = document.getElementById("twofa-confirm-input");
const twofaConfirmBtn = document.getElementById("twofa-confirm-btn");
const twofaDisablePasswordInput = document.getElementById("twofa-disable-password-input");
const twofaDisableBtn = document.getElementById("twofa-disable-btn");

let popoverSelectedAvatar = null;
let popoverSelectedStatus = "online";

// ================= Тема (светлая/тёмная) =================
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleBtn.textContent = theme === "light" ? "☀️" : "🌙";
}
(function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  applyTheme(saved);
})();
themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "light" ? "dark" : "light";
  localStorage.setItem("theme", next);
  applyTheme(next);
});

// ================= Звук нового сообщения =================
let soundEnabled = localStorage.getItem("soundEnabled") !== "off";
function updateSoundBtn() {
  soundToggleBtn.textContent = soundEnabled ? "🔔" : "🔕";
}
updateSoundBtn();
soundToggleBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("soundEnabled", soundEnabled ? "on" : "off");
  updateSoundBtn();
});

let audioCtx = null;
function playNotificationSound() {
  if (!soundEnabled) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch (e) {
    // Web Audio недоступен — просто без звука
  }
}

// ================= Push-уведомления браузера =================
function updateNotifBtn() {
  const supported = "Notification" in window;
  notifToggleBtn.textContent = notificationsEnabled && supported ? "🔔" : "🔕";
  notifToggleBtn.title = supported
    ? (notificationsEnabled ? "Push-уведомления включены" : "Включить push-уведомления браузера")
    : "Браузер не поддерживает уведомления";
}
updateNotifBtn();

notifToggleBtn.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    addSystemMessage("Этот браузер не поддерживает уведомления");
    return;
  }
  if (!notificationsEnabled) {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      addSystemMessage("Доступ к уведомлениям не предоставлен");
      return;
    }
    notificationsEnabled = true;
  } else {
    notificationsEnabled = false;
  }
  localStorage.setItem("notificationsEnabled", notificationsEnabled ? "on" : "off");
  updateNotifBtn();
});

// Показывает системное уведомление, только когда вкладка неактивна (или важно — mention/ЛС)
function maybeNotify(title, body, important) {
  if (!notificationsEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!document.hidden) return; // уведомляем только когда вкладка неактивна
  try {
    const n = new Notification(title, { body: (body || "").slice(0, 150), icon: undefined });
    n.onclick = () => window.focus();
  } catch (e) {
    // уведомления недоступны — просто пропускаем
  }
}

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

function statusOf(username) {
  if (username === myName) return myStatus;
  const u = onlineUsersList.find((u) => u.username === username);
  return u && u.status ? u.status : "online";
}

const STATUS_LABELS = { online: "В сети", away: "Отошёл", dnd: "Не беспокоить" };

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

// Возвращает { emitReact, emitEdit, emitDelete } функции для текущего представления,
// применимые к конкретному сообщению msg.
function actionsFor(msg) {
  if (currentView.type === "channel") {
    return {
      react: (emoji) => socket.emit("message:react", { id: msg.id, emoji }),
      edit: (text) => socket.emit("message:edit", { id: msg.id, text }),
      del: () => socket.emit("message:delete", { id: msg.id }),
    };
  } else if (currentView.type === "dm") {
    return {
      react: (emoji) => socket.emit("dm:react", { id: msg.id, to: currentView.withUser, emoji }),
      edit: (text) => socket.emit("dm:edit", { id: msg.id, to: currentView.withUser, text }),
      del: () => socket.emit("dm:delete", { id: msg.id, to: currentView.withUser }),
    };
  } else if (currentView.type === "group") {
    return {
      react: (emoji) => socket.emit("group:message:react", { groupId: currentView.groupId, id: msg.id, emoji }),
      edit: (text) => socket.emit("group:message:edit", { groupId: currentView.groupId, id: msg.id, text }),
      del: () => socket.emit("group:message:delete", { groupId: currentView.groupId, id: msg.id }),
    };
  }
}

function closeAllEmojiPickers() {
  document.querySelectorAll(".emoji-picker").forEach((el) => el.remove());
}

function openEmojiPicker(anchorBtn, msg) {
  closeAllEmojiPickers();
  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  QUICK_REACTIONS.forEach((emoji) => {
    const opt = document.createElement("span");
    opt.className = "emoji-picker-opt";
    opt.textContent = emoji;
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      actionsFor(msg).react(emoji);
      closeAllEmojiPickers();
    });
    picker.appendChild(opt);
  });
  anchorBtn.parentElement.appendChild(picker);
  setTimeout(() => document.addEventListener("click", closeAllEmojiPickers, { once: true }), 0);
}

function startReply(msg, authorLabel) {
  pendingReply = { id: msg.id, author: authorLabel, text: (msg.text || (msg.attachment ? "Вложение" : "")).slice(0, 120) };
  replyPreviewText.textContent = `Ответ ${authorLabel}: ${pendingReply.text}`;
  replyPreview.classList.remove("hidden");
  messageInput.focus();
}

replyRemoveBtn.addEventListener("click", () => {
  pendingReply = null;
  replyPreview.classList.add("hidden");
});

function startEditInline(row, msg) {
  const bubble = row.querySelector(".bubble");
  const existingText = msg.text || "";
  const editArea = document.createElement("div");
  editArea.className = "edit-area";
  const textarea = document.createElement("input");
  textarea.className = "edit-input";
  textarea.type = "text";
  textarea.maxLength = 1000;
  textarea.value = existingText;
  const actionsRow = document.createElement("div");
  actionsRow.className = "edit-actions";
  const saveBtn = document.createElement("button");
  saveBtn.className = "edit-save-btn";
  saveBtn.textContent = "Сохранить";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "edit-cancel-btn";
  cancelBtn.textContent = "Отмена";
  actionsRow.appendChild(saveBtn);
  actionsRow.appendChild(cancelBtn);
  editArea.appendChild(textarea);
  editArea.appendChild(actionsRow);

  if (bubble) bubble.replaceWith(editArea);
  textarea.focus();
  textarea.setSelectionRange(existingText.length, existingText.length);

  function commit() {
    const newText = textarea.value.trim();
    if (newText && newText !== existingText) actionsFor(msg).edit(newText);
    else if (bubble) editArea.replaceWith(bubble);
  }
  saveBtn.addEventListener("click", commit);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { if (bubble) editArea.replaceWith(bubble); }
  });
  cancelBtn.addEventListener("click", () => { if (bubble) editArea.replaceWith(bubble); });
}

function renderReactions(row, msg) {
  const existing = row.querySelector(".reactions-row");
  if (existing) existing.remove();
  const reactions = msg.reactions || {};
  const entries = Object.entries(reactions).filter(([, users]) => users && users.length);
  if (!entries.length) return;
  const wrap = document.createElement("div");
  wrap.className = "reactions-row";
  entries.forEach(([emoji, users]) => {
    const pill = document.createElement("span");
    pill.className = "reaction-pill" + (users.includes(myName) ? " mine" : "");
    pill.textContent = `${emoji} ${users.length}`;
    pill.title = users.join(", ");
    pill.addEventListener("click", () => actionsFor(msg).react(emoji));
    wrap.appendChild(pill);
  });
  row.appendChild(wrap);
}

function addMessage(msg, authorField) {
  const author = msg[authorField];
  const isOwn = author === myName;
  const row = document.createElement("div");
  row.className = "msg-row " + (isOwn ? "own" : "other") + (msg.deleted ? " deleted-msg" : "");
  row.dataset.msgId = msg.id;

  const avatar = avatarOf(author);
  const namePart = isOwn ? "Вы" : author;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = `${avatar ? avatar + " " : ""}${namePart} · ${formatTime(msg.time)}${msg.edited ? " · изменено" : ""}`;
  row.appendChild(meta);

  if (msg.replyTo) {
    const replyBlock = document.createElement("div");
    replyBlock.className = "reply-quote";
    replyBlock.textContent = `↩ ${msg.replyTo.author}: ${msg.replyTo.text}`;
    row.appendChild(replyBlock);
  }

  if (msg.deleted) {
    const bubble = document.createElement("div");
    bubble.className = "bubble deleted-bubble";
    bubble.textContent = "Сообщение удалено";
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  if (msg.attachment) {
    const attachment = msg.attachment;
    if (attachment.mimeType && attachment.mimeType.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "msg-image";
      img.src = attachment.url;
      img.alt = attachment.name || "изображение";
      img.addEventListener("click", () => window.open(attachment.url, "_blank"));
      row.appendChild(img);
    } else if (attachment.mimeType && attachment.mimeType.startsWith("audio/")) {
      const voiceEl = document.createElement("div");
      voiceEl.className = "voice-message";
      const icon = document.createElement("span");
      icon.className = "voice-icon";
      icon.textContent = "🎙️";
      const audioEl = document.createElement("audio");
      audioEl.controls = true;
      audioEl.src = attachment.url;
      audioEl.preload = "metadata";
      voiceEl.appendChild(icon);
      voiceEl.appendChild(audioEl);
      if (attachment.duration) {
        const durEl = document.createElement("span");
        durEl.className = "voice-duration";
        const m = Math.floor(attachment.duration / 60);
        const s = attachment.duration % 60;
        durEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
        voiceEl.appendChild(durEl);
      }
      row.appendChild(voiceEl);
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

  if (msg.text) {
    const bubble = document.createElement("div");
    bubble.className = "bubble" + (!isOwn && isMentioned(msg.text) ? " mention-highlight" : "");
    bubble.innerHTML = renderTextWithMentions(msg.text);
    row.appendChild(bubble);
  }

  // Панель действий: ответить / реакция / (для своих) редактировать / удалить
  const actions = document.createElement("div");
  actions.className = "msg-actions";

  const replyBtn = document.createElement("button");
  replyBtn.className = "msg-action-btn";
  replyBtn.textContent = "↩";
  replyBtn.title = "Ответить";
  replyBtn.addEventListener("click", () => startReply(msg, isOwn ? "себе" : author));
  actions.appendChild(replyBtn);

  const reactBtn = document.createElement("button");
  reactBtn.className = "msg-action-btn";
  reactBtn.textContent = "☺";
  reactBtn.title = "Реакция";
  reactBtn.addEventListener("click", (e) => { e.stopPropagation(); openEmojiPicker(reactBtn, msg); });
  actions.appendChild(reactBtn);

  if (isOwn) {
    const editBtn = document.createElement("button");
    editBtn.className = "msg-action-btn";
    editBtn.textContent = "✎";
    editBtn.title = "Редактировать";
    editBtn.addEventListener("click", () => startEditInline(row, msg));
    actions.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "msg-action-btn";
    delBtn.textContent = "🗑";
    delBtn.title = "Удалить";
    delBtn.addEventListener("click", () => {
      if (confirm("Удалить сообщение?")) actionsFor(msg).del();
    });
    actions.appendChild(delBtn);
  }

  row.appendChild(actions);
  renderReactions(row, msg);

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Обновляет сообщение в кэше и, если оно сейчас видно на экране, перерисовывает
// его строку на прежнем месте (без прокрутки списка).
function updateMessageInPlace(msg, list) {
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx !== -1) list[idx] = msg;

  const row = messagesEl.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`);
  if (!row) return;

  const authorField = msg.author !== undefined ? "author" : "from";
  const placeholder = document.createElement("div");
  row.replaceWith(placeholder);

  const capture = [];
  const originalAppend = messagesEl.appendChild.bind(messagesEl);
  messagesEl.appendChild = (node) => { capture.push(node); return node; };
  addMessage(msg, authorField);
  messagesEl.appendChild = originalAppend;

  if (capture[0]) placeholder.replaceWith(capture[0]);
  else placeholder.remove();
}

function renderCurrentView() {
  messagesEl.innerHTML = "";
  if (currentView.type === "channel") {
    channelHistory.forEach((m) => addMessage(m, "author"));
  } else if (currentView.type === "dm") {
    const list = dmCache.get(currentView.withUser) || [];
    list.forEach((m) => addMessage(m, "from"));
  } else if (currentView.type === "group") {
    const list = groupCache.get(currentView.groupId) || [];
    list.forEach((m) => addMessage(m, "author"));
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

function isGroupAdminOf(group) {
  return !!group && (group.owner === myName || (group.admins || []).includes(myName));
}

function updateHeaderAndInput() {
  groupDeleteBtn.classList.add("hidden");
  groupSettingsBtn.classList.add("hidden");
  if (currentView.type === "channel") {
    chatHeader.querySelector(".chat-header-title").innerHTML = `<span class="channel-hash">#</span> general`;
    messageInput.placeholder = "Написать в #general";
    channelGeneralEl.classList.add("active");
    dmCallBtn.classList.add("hidden");
  } else if (currentView.type === "dm") {
    chatHeader.querySelector(".chat-header-title").textContent = `Личные сообщения — ${currentView.withUser}`;
    messageInput.placeholder = `Написать ${currentView.withUser}`;
    channelGeneralEl.classList.remove("active");
    dmCallBtn.classList.remove("hidden");
  } else if (currentView.type === "group") {
    chatHeader.querySelector(".chat-header-title").innerHTML = `<span class="channel-hash">#</span> ${escapeHtml(currentView.name)}`;
    messageInput.placeholder = `Написать в ${currentView.name}`;
    channelGeneralEl.classList.remove("active");
    dmCallBtn.classList.add("hidden");
    const group = groupsList.find((g) => g.id === currentView.groupId);
    if (group && group.owner === myName) groupDeleteBtn.classList.remove("hidden");
    if (isGroupAdminOf(group)) groupSettingsBtn.classList.remove("hidden");
  }
  updateChatHeaderStatus();
}

function clearPendingReply() {
  pendingReply = null;
  replyPreview.classList.add("hidden");
}

function switchToChannel() {
  currentView = { type: "channel" };
  clearPendingReply();
  markChannelRead();
  updateHeaderAndInput();
  renderCurrentView();
  renderOnlineList(onlineUsersList);
  renderGroupList();
  messageInput.focus();
  closeSidebar();
}

function switchToDm(username) {
  currentView = { type: "dm", withUser: username };
  clearPendingReply();
  markDmRead(username);
  updateHeaderAndInput();

  if (dmCache.has(username)) {
    renderCurrentView();
  } else {
    messagesEl.innerHTML = "";
    socket.emit("dm:history:request", username);
  }
  renderOnlineList(onlineUsersList);
  renderGroupList();
  messageInput.focus();
  closeSidebar();
}

function switchToGroup(groupId) {
  const group = groupsList.find((g) => g.id === groupId);
  if (!group) return;
  currentView = { type: "group", groupId, name: group.name };
  clearPendingReply();
  markGroupRead(groupId);
  updateHeaderAndInput();

  if (groupCache.has(groupId)) {
    renderCurrentView();
  } else {
    messagesEl.innerHTML = "";
    socket.emit("group:history:request", groupId);
  }
  renderOnlineList(onlineUsersList);
  renderGroupList();
  messageInput.focus();
  closeSidebar();
}

function renderGroupList() {
  groupListEl.innerHTML = "";
  groupsList.forEach((g) => {
    const li = document.createElement("li");
    const isActive = currentView.type === "group" && currentView.groupId === g.id;
    li.className = isActive ? "active-dm" : "";
    li.innerHTML = `<span>${g.avatar ? escapeHtml(g.avatar) : "👥"}</span> ${escapeHtml(g.name)}`;
    const unread = unreadGroup.get(g.id);
    if (unread && unread.count > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-badge" + (unread.mention ? " mention" : "");
      badge.textContent = unread.count > 9 ? "9+" : String(unread.count);
      li.appendChild(badge);
    }
    li.addEventListener("click", () => switchToGroup(g.id));
    groupListEl.appendChild(li);
  });
}

groupDeleteBtn.addEventListener("click", () => {
  if (currentView.type !== "group") return;
  if (confirm(`Удалить группу «${currentView.name}»? Это действие необратимо.`)) {
    socket.emit("group:remove", { groupId: currentView.groupId });
  }
});

let groupCreateSelectedAvatar = null;

function renderGroupAvatarGrid(gridEl, selected, onSelect) {
  gridEl.innerHTML = "";
  AVATAR_EMOJIS.forEach((emoji) => {
    const opt = document.createElement("div");
    opt.className = "avatar-option" + (selected === emoji ? " selected" : "");
    opt.textContent = emoji;
    opt.addEventListener("click", () => onSelect(emoji));
    gridEl.appendChild(opt);
  });
}

// ----- Создание группы -----
function redrawGroupCreateAvatarGrid() {
  renderGroupAvatarGrid(groupAvatarGrid, groupCreateSelectedAvatar, (emoji) => {
    groupCreateSelectedAvatar = groupCreateSelectedAvatar === emoji ? null : emoji;
    redrawGroupCreateAvatarGrid();
  });
}

createGroupBtn.addEventListener("click", () => {
  groupNameInput.value = "";
  groupDescriptionInput.value = "";
  groupCreateSelectedAvatar = null;
  redrawGroupCreateAvatarGrid();
  groupMembersList.innerHTML = "";
  onlineUsersList
    .filter((u) => u.username !== myName)
    .forEach((u) => {
      const opt = document.createElement("label");
      opt.className = "group-member-opt";
      opt.innerHTML = `<input type="checkbox" value="${escapeHtml(u.username)}" /> ${u.avatar ? escapeHtml(u.avatar) + " " : ""}${escapeHtml(u.username)}`;
      groupMembersList.appendChild(opt);
    });
  if (!onlineUsersList.some((u) => u.username !== myName)) {
    groupMembersList.innerHTML = `<div class="online-hint">Сейчас никого нет в сети — можно создать группу и добавить участников позже (через настройки группы).</div>`;
  }
  createGroupModal.classList.remove("hidden");
  groupNameInput.focus();
});

groupCreateCancelBtn.addEventListener("click", () => createGroupModal.classList.add("hidden"));

groupCreateConfirmBtn.addEventListener("click", () => {
  const name = groupNameInput.value.trim();
  if (!name) {
    groupNameInput.focus();
    return;
  }
  const description = groupDescriptionInput.value.trim();
  const members = Array.from(groupMembersList.querySelectorAll("input[type=checkbox]:checked")).map((el) => el.value);
  socket.emit("group:create", { name, description, avatar: groupCreateSelectedAvatar, members });
  createGroupModal.classList.add("hidden");
});

// ----- Настройки группы (роли, участники, аватар, описание) -----
let groupSettingsSelectedAvatar = null;
let groupSettingsGroupId = null;

function openGroupSettings(groupId) {
  const group = groupsList.find((g) => g.id === groupId);
  if (!group) return;
  groupSettingsGroupId = groupId;
  groupEditNameInput.value = group.name;
  groupEditDescriptionInput.value = group.description || "";
  groupSettingsSelectedAvatar = group.avatar || null;
  redrawGroupEditAvatarGrid();
  renderGroupSettingsMembers(group);
  groupSettingsModal.classList.remove("hidden");
}

function redrawGroupEditAvatarGrid() {
  renderGroupAvatarGrid(groupEditAvatarGrid, groupSettingsSelectedAvatar, (emoji) => {
    groupSettingsSelectedAvatar = groupSettingsSelectedAvatar === emoji ? null : emoji;
    redrawGroupEditAvatarGrid();
  });
}

function renderGroupSettingsMembers(group) {
  const amOwner = group.owner === myName;
  const amAdmin = isGroupAdminOf(group);

  groupEditMembersList.innerHTML = "";
  group.members.forEach((username) => {
    const li = document.createElement("li");
    const isOwnerRow = username === group.owner;
    const isAdminRow = (group.admins || []).includes(username);
    const roleLabel = isOwnerRow ? " · владелец" : isAdminRow ? " · админ" : "";
    li.innerHTML = `<span>${avatarOf(username) || "👤"}</span> ${escapeHtml(username)}<span class="member-role">${roleLabel}</span>`;

    if (amOwner && !isOwnerRow) {
      const roleBtn = document.createElement("button");
      roleBtn.type = "button";
      roleBtn.className = "member-action-btn";
      roleBtn.textContent = isAdminRow ? "Снять админа" : "Сделать админом";
      roleBtn.addEventListener("click", () => {
        socket.emit("group:admins:set", { groupId: group.id, username, isAdmin: !isAdminRow });
      });
      li.appendChild(roleBtn);
    }

    if (amAdmin && !isOwnerRow && (amOwner || !isAdminRow)) {
      const kickBtn = document.createElement("button");
      kickBtn.type = "button";
      kickBtn.className = "member-action-btn danger";
      kickBtn.textContent = "Убрать";
      kickBtn.addEventListener("click", () => {
        if (confirm(`Убрать ${username} из группы?`)) {
          socket.emit("group:members:remove", { groupId: group.id, username });
        }
      });
      li.appendChild(kickBtn);
    }

    groupEditMembersList.appendChild(li);
  });

  groupEditAddSection.classList.toggle("hidden", !amAdmin);
  groupEditAddList.innerHTML = "";
  const addable = onlineUsersList.filter((u) => u.username !== myName && !group.members.includes(u.username));
  if (!addable.length) {
    groupEditAddList.innerHTML = `<div class="online-hint">Сейчас никого нового нет в сети, чтобы добавить</div>`;
  } else {
    addable.forEach((u) => {
      const opt = document.createElement("label");
      opt.className = "group-member-opt";
      opt.innerHTML = `<input type="checkbox" value="${escapeHtml(u.username)}" /> ${u.avatar ? escapeHtml(u.avatar) + " " : ""}${escapeHtml(u.username)}`;
      groupEditAddList.appendChild(opt);
    });
  }
}

groupSettingsBtn.addEventListener("click", () => {
  if (currentView.type !== "group") return;
  openGroupSettings(currentView.groupId);
});

groupSettingsCloseBtn.addEventListener("click", () => {
  groupSettingsModal.classList.add("hidden");
  groupSettingsGroupId = null;
});

groupSettingsSaveBtn.addEventListener("click", () => {
  if (!groupSettingsGroupId) return;
  const name = groupEditNameInput.value.trim();
  const description = groupEditDescriptionInput.value.trim();
  if (!name) {
    groupEditNameInput.focus();
    return;
  }
  socket.emit("group:update", { groupId: groupSettingsGroupId, name, description, avatar: groupSettingsSelectedAvatar });
  const toAdd = Array.from(groupEditAddList.querySelectorAll("input[type=checkbox]:checked")).map((el) => el.value);
  if (toAdd.length) {
    socket.emit("group:members:add", { groupId: groupSettingsGroupId, members: toAdd });
  }
  groupSettingsModal.classList.add("hidden");
  groupSettingsGroupId = null;
});

function renderOnlineList(users) {
  onlineUsersList = users;
  onlineList.innerHTML = "";
  onlineCount.textContent = users.length;
  users.forEach((u) => {
    const li = document.createElement("li");
    const isSelf = u.username === myName;
    const isActive = currentView.type === "dm" && currentView.withUser === u.username;
    li.className = (isSelf ? "self" : "") + (isActive ? " active-dm" : "");
    const status = u.status || "online";
    const avatarHtml = u.avatar ? `<span>${escapeHtml(u.avatar)}</span>` : `<span class="status-dot ${status}"></span>`;
    li.innerHTML = `${avatarHtml} ${escapeHtml(u.username)}${isSelf ? " (вы)" : ""}${u.avatar ? `<span class="status-dot inline ${status}" title="${STATUS_LABELS[status]}"></span>` : ""}`;
    const unread = unreadDm.get(u.username);
    if (!isSelf && unread && unread.count > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-badge" + (unread.mention ? " mention" : "");
      badge.textContent = unread.count > 9 ? "9+" : String(unread.count);
      li.appendChild(badge);
    }
    if (!isSelf) {
      li.addEventListener("click", () => switchToDm(u.username));
    }
    onlineList.appendChild(li);
  });

  if (currentView.type === "dm") updateChatHeaderStatus();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Подсвечивает @упоминания в тексте сообщения (безопасно экранируя остальной текст)
function renderTextWithMentions(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(^|[\s(])@([\wа-яёА-ЯЁ_-]{2,24})/gu, (match, pre, name) => {
    const isMe = myName && name.toLowerCase() === myName.toLowerCase();
    return `${pre}<span class="mention-tag${isMe ? " mention-me" : ""}">@${name}</span>`;
  });
}

function isMentioned(text) {
  if (!text || !myName) return false;
  const re = new RegExp("(^|[^\\wа-яё])@" + escapeRegExp(myName) + "(?![\\wа-яё])", "iu");
  return re.test(text);
}

function renderChannelUnreadBadge() {
  if (unreadChannel > 0) {
    channelUnreadBadge.textContent = unreadChannel > 9 ? "9+" : String(unreadChannel);
    channelUnreadBadge.classList.remove("hidden");
  } else {
    channelUnreadBadge.classList.add("hidden");
  }
}

function markChannelRead() {
  unreadChannel = 0;
  renderChannelUnreadBadge();
}

function markDmRead(username) {
  if (unreadDm.has(username)) {
    unreadDm.delete(username);
    renderOnlineList(onlineUsersList);
  }
}

function markGroupRead(groupId) {
  if (unreadGroup.has(groupId)) {
    unreadGroup.delete(groupId);
    renderGroupList();
  }
}

function bumpUnreadDm(username, mention) {
  const cur = unreadDm.get(username) || { count: 0, mention: false };
  cur.count += 1;
  cur.mention = cur.mention || mention;
  unreadDm.set(username, cur);
  renderOnlineList(onlineUsersList);
}

function bumpUnreadGroup(groupId, mention) {
  const cur = unreadGroup.get(groupId) || { count: 0, mention: false };
  cur.count += 1;
  cur.mention = cur.mention || mention;
  unreadGroup.set(groupId, cur);
  renderGroupList();
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

function renderStatusPicker() {
  statusPicker.querySelectorAll(".status-opt").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.status === popoverSelectedStatus);
  });
}

statusPicker.querySelectorAll(".status-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    popoverSelectedStatus = btn.dataset.status;
    renderStatusPicker();
  });
});

function openProfilePopover() {
  popoverSelectedAvatar = myAvatar;
  popoverSelectedStatus = myStatus;
  renderAvatarGrid();
  renderStatusPicker();
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
  myStatus = popoverSelectedStatus;
  autoAway = false;
  if (myAvatar) localStorage.setItem("myAvatar", myAvatar);
  else localStorage.removeItem("myAvatar");
  localStorage.setItem("myStatus", myStatus);
  renderMeAvatar();
  renderMeStatusDot();
  if (socket) socket.emit("user:update", { avatar: myAvatar, status: myStatus });
  closeProfilePopover();
});

function renderMeStatusDot() {
  meStatusDot.className = "me-status-dot " + myStatus;
}

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.reload();
});

openSecurityBtn.addEventListener("click", () => {
  closeProfilePopover();
  openSecurityModal();
});

// ================= Пароль и безопасность =================
function authHeader() {
  return { Authorization: "Bearer " + localStorage.getItem("token") };
}

async function openSecurityModal() {
  securityError.textContent = "";
  currentPasswordInput.value = "";
  changePasswordInput.value = "";
  twofaSetupBlock.classList.add("hidden");
  securityModal.classList.remove("hidden");
  try {
    const res = await fetch("/api/2fa/status", { headers: authHeader() });
    const data = await res.json();
    if (data.enabled) {
      twofaDisabledBlock.classList.add("hidden");
      twofaEnabledBlock.classList.remove("hidden");
    } else {
      twofaDisabledBlock.classList.remove("hidden");
      twofaEnabledBlock.classList.add("hidden");
    }
  } catch (e) {
    // не удалось получить статус 2FA — просто оставим блок скрытым
  }
}

securityCloseBtn.addEventListener("click", () => securityModal.classList.add("hidden"));

changePasswordBtn.addEventListener("click", async () => {
  const currentPassword = currentPasswordInput.value;
  const newPassword = changePasswordInput.value;
  if (!currentPassword || !newPassword) {
    securityError.textContent = "Заполните оба поля пароля";
    return;
  }
  if (newPassword.length < 6) {
    securityError.textContent = "Новый пароль должен быть не короче 6 символов";
    return;
  }
  securityError.textContent = "Сохранение...";
  try {
    const res = await fetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      securityError.textContent = data.error || "Не удалось сменить пароль";
      return;
    }
    securityError.textContent = "Пароль изменён ✓";
    currentPasswordInput.value = "";
    changePasswordInput.value = "";
  } catch (e) {
    securityError.textContent = "Не удалось связаться с сервером";
  }
});

twofaSetupBtn.addEventListener("click", async () => {
  securityError.textContent = "";
  try {
    const res = await fetch("/api/2fa/setup", { method: "POST", headers: authHeader() });
    const data = await res.json();
    if (!res.ok) {
      securityError.textContent = data.error || "Не удалось начать настройку";
      return;
    }
    twofaQrImg.src = data.qrDataUrl;
    twofaSecretText.textContent = "Секрет (если не получается отсканировать QR): " + data.secret;
    twofaConfirmInput.value = "";
    twofaSetupBlock.classList.remove("hidden");
  } catch (e) {
    securityError.textContent = "Не удалось связаться с сервером";
  }
});

twofaConfirmBtn.addEventListener("click", async () => {
  const code = twofaConfirmInput.value.trim();
  if (!code) return;
  securityError.textContent = "";
  try {
    const res = await fetch("/api/2fa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) {
      securityError.textContent = data.error || "Неверный код";
      return;
    }
    twofaSetupBlock.classList.add("hidden");
    twofaDisabledBlock.classList.add("hidden");
    twofaEnabledBlock.classList.remove("hidden");
  } catch (e) {
    securityError.textContent = "Не удалось связаться с сервером";
  }
});

twofaDisableBtn.addEventListener("click", async () => {
  const password = twofaDisablePasswordInput.value;
  if (!password) {
    securityError.textContent = "Введите пароль для отключения 2FA";
    return;
  }
  securityError.textContent = "";
  try {
    const res = await fetch("/api/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      securityError.textContent = data.error || "Не удалось отключить 2FA";
      return;
    }
    twofaDisablePasswordInput.value = "";
    twofaEnabledBlock.classList.add("hidden");
    twofaDisabledBlock.classList.remove("hidden");
  } catch (e) {
    securityError.textContent = "Не удалось связаться с сервером";
  }
});

// --- Аутентификация ---

function setAuthMode(mode) {
  authMode = mode;
  connectError.textContent = "";
  pendingTempToken = null;
  twofaFieldGroup.classList.add("hidden");
  usernameInput.disabled = false;
  passwordFieldGroup.classList.add("hidden");
  recoveryFieldGroup.classList.add("hidden");
  if (forgotPasswordLink && forgotPasswordLink.parentElement) {
    forgotPasswordLink.parentElement.classList.add("hidden");
  }
  if (authSwitchText) authSwitchText.textContent = "";
  if (authSwitchLink) authSwitchLink.textContent = "";

  if (mode === "login") {
    connectSubtitle.textContent = "Войдите под ником";
    connectBtn.textContent = "Войти в чат";
    passwordInput.value = "";
    passwordInput.setAttribute("autocomplete", "username");
  } else if (mode === "register") {
    connectSubtitle.textContent = "Создайте свой ник";
    connectBtn.textContent = "Зарегистрироваться";
    passwordInput.value = "";
    passwordInput.setAttribute("autocomplete", "username");
  } else if (mode === "forgot") {
    connectSubtitle.textContent = "Восстановление по коду";
    connectBtn.textContent = "Сбросить";
    recoveryFieldGroup.classList.remove("hidden");
  } else if (mode === "twofa") {
    connectSubtitle.textContent = "Введите код из приложения";
    connectBtn.textContent = "Подтвердить";
    twofaFieldGroup.classList.remove("hidden");
    passwordFieldGroup.classList.add("hidden");
    recoveryFieldGroup.classList.add("hidden");
    usernameInput.disabled = true;
    twofaCodeInput.focus();
  }
}

if (authSwitchLink) {
  authSwitchLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (authMode === "twofa") {
      setAuthMode("login");
      return;
    }
    setAuthMode(authMode === "login" ? "register" : "login");
  });
}

if (forgotPasswordLink) {
  forgotPasswordLink.addEventListener("click", (e) => {
    e.preventDefault();
    setAuthMode("forgot");
  });
}

setAuthMode("login");

async function submitAuth() {
  const username = usernameInput.value.trim();

  if (authMode === "twofa") {
    const code = twofaCodeInput.value.trim();
    if (!code || !pendingTempToken) {
      connectError.textContent = "Введите код";
      return;
    }
    connectError.textContent = "Проверка кода...";
    connectBtn.disabled = true;
    try {
      const res = await fetch("/api/login/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempToken: pendingTempToken, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        connectError.textContent = data.error || "Неверный код";
        connectBtn.disabled = false;
        return;
      }
      localStorage.setItem("token", data.token);
      connectWithToken(data.token);
    } catch (err) {
      connectError.textContent = "Не удалось связаться с сервером";
      connectBtn.disabled = false;
    }
    return;
  }

  if (authMode === "forgot") {
    const recoveryCode = recoveryCodeInput.value.trim();
    const newPassword = newPasswordInput.value;
    if (!username || !recoveryCode || !newPassword) {
      connectError.textContent = "Заполните все поля";
      return;
    }
    connectError.textContent = "Сброс пароля...";
    connectBtn.disabled = true;
    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, recoveryCode, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        connectError.textContent = data.error || "Не удалось сбросить пароль";
        connectBtn.disabled = false;
        return;
      }
      localStorage.setItem("token", data.token);
      connectWithToken(data.token);
    } catch (err) {
      connectError.textContent = "Не удалось связаться с сервером";
      connectBtn.disabled = false;
    }
    return;
  }

  if (!username) {
    connectError.textContent = "Введите ник";
    return;
  }

  const usernameRegex = /^[a-zA-Zа-яА-ЯёЁ0-9_-]{2,24}$/;
  if (!usernameRegex.test(username)) {
    connectError.textContent = "Ник: 2–24 символа, буквы/цифры/_/-";
    return;
  }

  connectError.textContent = authMode === "login" ? "Вход..." : "Регистрация...";
  connectBtn.disabled = true;

  try {
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();

    if (!res.ok) {
      connectError.textContent = data.error || "Не удалось войти";
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
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (passwordFieldGroup && !passwordFieldGroup.classList.contains("hidden")) {
      passwordInput.focus();
    } else {
      submitAuth();
    }
  }
});
newPasswordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });
recoveryCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") newPasswordInput.focus(); });
twofaCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });

function connectWithToken(token) {
  socket = io({ auth: { token } });
  registerConnectionHooks();

  socket.on("connect", () => {
    socket.emit("user:join", { avatar: myAvatar, status: myStatus });
    fetchIceServers();
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
    renderMeStatusDot();
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
    const viewing = currentView.type === "channel";
    if (viewing) {
      addMessage(msg, "author");
    }
    if (msg.author !== myName) {
      playNotificationSound();
      const mention = isMentioned(msg.text);
      if (!viewing) {
        unreadChannel += 1;
        renderChannelUnreadBadge();
      }
      maybeNotify(`#general — ${msg.author}`, msg.text || "Вложение", !viewing || mention);
    }
  });

  socket.on("message:updated", (msg) => {
    updateMessageInPlace(msg, channelHistory);
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

    const viewing = currentView.type === "dm" && currentView.withUser === other;
    if (viewing) {
      addMessage(msg, "from");
    }
    if (msg.from !== myName) {
      playNotificationSound();
      if (!viewing) bumpUnreadDm(other, true);
      maybeNotify(msg.from, msg.text || "Вложение", true);
    }
  });

  socket.on("dm:updated", (msg) => {
    const other = msg.from === myName ? msg.to : msg.from;
    const list = dmCache.get(other) || [];
    updateMessageInPlace(msg, list);
  });

  socket.on("lastseen:response", ({ username, lastSeen }) => {
    lastSeenCache.set(username, lastSeen);
    if (currentView.type === "dm" && currentView.withUser === username) {
      updateChatHeaderStatus();
    }
  });

  // ----- Группы -----
  socket.on("group:list", (list) => {
    groupsList.length = 0;
    groupsList.push(...list);
    renderGroupList();
  });

  socket.on("group:created", (group) => {
    if (!groupsList.some((g) => g.id === group.id)) groupsList.push(group);
    else Object.assign(groupsList.find((g) => g.id === group.id), group);
    renderGroupList();
    addSystemMessage(`Группа «${group.name}» создана`);
  });

  socket.on("group:updated", (group) => {
    const existing = groupsList.find((g) => g.id === group.id);
    if (existing) Object.assign(existing, group);
    else groupsList.push(group);
    renderGroupList();
    if (currentView.type === "group" && currentView.groupId === group.id) {
      currentView.name = group.name;
      updateHeaderAndInput();
    }
    if (groupSettingsGroupId === group.id && !groupSettingsModal.classList.contains("hidden")) {
      renderGroupSettingsMembers(group);
    }
  });

  socket.on("group:removed", ({ groupId }) => {
    const idx = groupsList.findIndex((g) => g.id === groupId);
    const wasCurrent = currentView.type === "group" && currentView.groupId === groupId;
    if (idx !== -1) groupsList.splice(idx, 1);
    groupCache.delete(groupId);
    renderGroupList();
    if (wasCurrent) {
      addSystemMessage("Группа была удалена");
      switchToChannel();
    }
  });

  socket.on("group:history", ({ groupId, messages }) => {
    groupCache.set(groupId, messages);
    if (currentView.type === "group" && currentView.groupId === groupId) {
      renderCurrentView();
    }
  });

  socket.on("group:message:new", (msg) => {
    if (!groupCache.has(msg.groupId)) groupCache.set(msg.groupId, []);
    groupCache.get(msg.groupId).push(msg);
    const viewing = currentView.type === "group" && currentView.groupId === msg.groupId;
    if (viewing) {
      addMessage(msg, "author");
    }
    if (msg.author !== myName) {
      playNotificationSound();
      const mention = isMentioned(msg.text);
      if (!viewing) bumpUnreadGroup(msg.groupId, mention);
      const group = groupsList.find((g) => g.id === msg.groupId);
      maybeNotify(`${group ? group.name : "Группа"} — ${msg.author}`, msg.text || "Вложение", !viewing || mention);
    }
  });

  socket.on("group:message:updated", (msg) => {
    const list = groupCache.get(msg.groupId) || [];
    updateMessageInPlace(msg, list);
  });

  // ----- Печатает... -----
  socket.on("typing:update", ({ scope, target, username, typing }) => {
    if (username === myName) return;
    const relevant =
      (scope === "channel" && currentView.type === "channel") ||
      (scope === "dm" && currentView.type === "dm" && currentView.withUser === username) ||
      (scope === "group" && currentView.type === "group" && currentView.groupId === target);
    if (!relevant) return;

    const key = scope + ":" + (target || "channel") + ":" + username;
    if (typing) {
      typingIndicatorEl.textContent = `${username} печатает…`;
      typingIndicatorEl.classList.remove("hidden");
      clearTimeout(typingTimers.get(key));
      typingTimers.set(key, setTimeout(() => {
        typingIndicatorEl.classList.add("hidden");
      }, 4000));
    } else {
      clearTimeout(typingTimers.get(key));
      typingIndicatorEl.classList.add("hidden");
    }
  });

  socket.on("system:message", addSystemMessage);
  socket.on("users:update", renderOnlineList);
}

// Декодирует тело JWT в браузере (без проверки подписи — только для UI,
// подпись всё равно проверяет сервер при подключении).
// Обычный atob() ломает не-латинские символы (кириллицу, эмодзи и т.п.),
// потому что декодирует base64 в "байтовую" строку, а не в текст UTF-8.
// Поэтому проходим дополнительный шаг через escape/decodeURIComponent —
// это стандартный приём для корректного UTF-8-декодирования в браузере.
function decodeJwtPayload(token) {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "===".slice((base64.length + 3) % 4);
  const utf8Json = decodeURIComponent(
    atob(padded)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
  return JSON.parse(utf8Json);
}

// Если токен уже сохранён (перезагрузка страницы) — сразу подключаемся,
// минуя форму логина. myName возьмём из первого события users:update.
const savedToken = localStorage.getItem("token");
if (savedToken) {
  try {
    const payload = decodeJwtPayload(savedToken);
    myName = payload.username || "";
  } catch (e) {
    // payload не читается — ничего страшного, имя подставится позже
  }
  connectWithToken(savedToken);
}

// ================= Авто-статус "Отошёл" при бездействии =================
function resetIdleTimer() {
  if (autoAway && myStatus === "away" && socket) {
    autoAway = false;
    myStatus = "online";
    renderMeStatusDot();
    socket.emit("status:update", { status: myStatus });
  }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // Не трогаем статус, если пользователь сам выбрал "Не беспокоить"
    if (myStatus === "online" && socket) {
      autoAway = true;
      myStatus = "away";
      renderMeStatusDot();
      socket.emit("status:update", { status: myStatus });
    }
  }, IDLE_AWAY_MS);
}
["mousemove", "keydown", "click", "touchstart"].forEach((evt) =>
  document.addEventListener(evt, resetIdleTimer, { passive: true })
);
resetIdleTimer();

channelGeneralEl.addEventListener("click", switchToChannel);

const voiceEnterBtn = document.getElementById("voice-enter-btn");
const chatOpenBtn = document.getElementById("chat-open-btn");
const membersPanelBtn = document.getElementById("members-panel-btn");

if (voiceEnterBtn) {
  voiceEnterBtn.addEventListener("click", () => {
    closeSidebar();
    if (channelCallBtn) channelCallBtn.click();
  });
}

if (chatOpenBtn) {
  chatOpenBtn.addEventListener("click", () => {
    closeSidebar();
    switchToChannel();
  });
}

if (membersPanelBtn) {
  membersPanelBtn.addEventListener("click", () => {
    if (sidebarEl.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
}

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

// ----- Голосовые сообщения -----
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let recordingStartTime = 0;
let recordingTimerId = null;
const MAX_RECORDING_MS = 5 * 60 * 1000; // 5 минут — защита от гигантских файлов

function pickAudioMimeType() {
  const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return ""; // браузер сам выберет формат по умолчанию
}

// Браузер, который записывает голос (MediaRecorder), не всегда корректно
// прописывает длительность в заголовок файла — из-за этого часть браузеров
// показывает "0:00" и вообще отказывается проигрывать. Поэтому перед отправкой
// декодируем запись и пересобираем её в обычный WAV — его длительность всегда
// верна, и проигрывает его абсолютно любой браузер. Заодно понижаем частоту
// дискретизации до 16 кГц и сводим в моно (для голоса этого более чем
// достаточно) — иначе несжатый WAV на 5 минут весил бы слишком много.
function interleave(inputL, inputR) {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = numChannels === 2 ? interleave(buffer.getChannelData(0), buffer.getChannelData(1)) : buffer.getChannelData(0);

  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const arrayBuf = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(arrayBuf);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  floatTo16BitPCM(view, 44, samples);
  return new Blob([view], { type: "audio/wav" });
}

async function decodeAndResampleToWav(rawBlob) {
  const arrayBuffer = await rawBlob.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new AudioContextClass();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  decodeCtx.close();

  const targetSampleRate = 16000; // с запасом хватает для голоса, файл лёгкий
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSampleRate), targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();

  return { wavBlob: audioBufferToWavBlob(rendered), durationSeconds: Math.round(rendered.duration) };
}

function formatRecordingTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateRecordingTimer() {
  const elapsed = Date.now() - recordingStartTime;
  voiceRecordingTime.textContent = formatRecordingTime(elapsed);
  if (elapsed >= MAX_RECORDING_MS) stopRecording(false);
}

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    addSystemMessage("Этот браузер не поддерживает запись голоса");
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: buildMicConstraints() });
  } catch (err) {
    addSystemMessage("Не удалось получить доступ к микрофону");
    return;
  }

  const mimeType = pickAudioMimeType();
  recordedChunks = [];
  mediaRecorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);

  mediaRecorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  });

  mediaRecorder.addEventListener("stop", () => {
    recordingStream.getTracks().forEach((t) => t.stop());
    recordingStream = null;
  });

  mediaRecorder.start();
  recordingStartTime = Date.now();
  voiceRecordingTime.textContent = "0:00";
  voiceRecordingBar.classList.remove("hidden");
  voiceRecordBtn.classList.add("recording");
  voiceRecordBtn.setAttribute("aria-label", "Остановить запись");
  recordingTimerId = setInterval(updateRecordingTimer, 250);
}

function stopRecording(shouldSend) {
  if (!mediaRecorder) return;

  clearInterval(recordingTimerId);
  recordingTimerId = null;
  voiceRecordingBar.classList.add("hidden");
  voiceRecordBtn.classList.remove("recording");
  voiceRecordBtn.setAttribute("aria-label", "Голосовое сообщение");

  const recorderRef = mediaRecorder;
  const mimeTypeUsed = mediaRecorder.mimeType || "audio/webm";
  mediaRecorder = null;

  recorderRef.addEventListener(
    "stop",
    async () => {
      if (!shouldSend) {
        recordedChunks = [];
        return;
      }
      const rawBlob = new Blob(recordedChunks, { type: mimeTypeUsed });
      recordedChunks = [];
      if (rawBlob.size < 500) return; // слишком короткая запись, скорее всего случайный тап

      addSystemMessage("Отправка голосового сообщения...");
      try {
        const { wavBlob, durationSeconds } = await decodeAndResampleToWav(rawBlob);
        await uploadAndSendVoice(wavBlob, "audio/wav", durationSeconds);
      } catch (err) {
        // Если браузер не смог перекодировать (редкий случай) — отправляем как есть,
        // это лучше, чем совсем ничего не отправить
        const fallbackDuration = Math.round((Date.now() - recordingStartTime) / 1000);
        await uploadAndSendVoice(rawBlob, mimeTypeUsed, fallbackDuration);
      }
    },
    { once: true }
  );

  recorderRef.stop();
}

async function uploadAndSendVoice(blob, mimeType, durationSeconds) {
  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
  const file = new File([blob], `voice-message.${ext}`, { type: mimeType });

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
      addSystemMessage(data.error || "Не удалось отправить голосовое сообщение");
      return;
    }
    data.duration = durationSeconds; // сервер не считает длительность сам — прикладываем то, что засекли на клиенте

    const replyTo = pendingReply ? { id: pendingReply.id, author: pendingReply.author, text: pendingReply.text } : null;

    if (currentView.type === "channel") {
      socket.emit("message:send", { text: "", attachment: data, replyTo });
    } else if (currentView.type === "dm") {
      socket.emit("dm:send", { to: currentView.withUser, text: "", attachment: data, replyTo });
    } else if (currentView.type === "group") {
      socket.emit("group:send", { groupId: currentView.groupId, text: "", attachment: data, replyTo });
    }
    clearPendingReply();
  } catch (err) {
    addSystemMessage("Не удалось отправить голосовое сообщение");
  }
}

voiceRecordBtn.addEventListener("click", () => {
  if (mediaRecorder) stopRecording(true);
  else startRecording();
});

voiceCancelBtn.addEventListener("click", () => stopRecording(false));

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text && !pendingAttachment) return;
  if (!socket) return;

  const replyTo = pendingReply ? { id: pendingReply.id, author: pendingReply.author, text: pendingReply.text } : null;

  if (currentView.type === "channel") {
    socket.emit("message:send", { text, attachment: pendingAttachment, replyTo });
  } else if (currentView.type === "dm") {
    socket.emit("dm:send", { to: currentView.withUser, text, attachment: pendingAttachment, replyTo });
  } else if (currentView.type === "group") {
    socket.emit("group:send", { groupId: currentView.groupId, text, attachment: pendingAttachment, replyTo });
  }

  messageInput.value = "";
  pendingAttachment = null;
  attachmentPreview.classList.add("hidden");
  clearPendingReply();
  stopTyping();
});

// ----- Индикатор "печатает..." для собственного набора текста -----
function currentTypingScope() {
  if (currentView.type === "channel") return { scope: "channel" };
  if (currentView.type === "dm") return { scope: "dm", target: currentView.withUser };
  if (currentView.type === "group") return { scope: "group", target: currentView.groupId };
  return null;
}

function startTyping() {
  if (!socket) return;
  const ctx = currentTypingScope();
  if (!ctx) return;
  if (!myTypingActive) {
    myTypingActive = true;
    socket.emit("typing:start", ctx);
  }
  clearTimeout(myTypingTimeout);
  myTypingTimeout = setTimeout(stopTyping, 2500);
}

function stopTyping() {
  if (!socket || !myTypingActive) return;
  myTypingActive = false;
  clearTimeout(myTypingTimeout);
  const ctx = currentTypingScope();
  if (ctx) socket.emit("typing:stop", ctx);
}

messageInput.addEventListener("input", () => {
  if (messageInput.value.trim()) startTyping();
  else stopTyping();
});

// ================= Звонки (WebRTC) =================
// Сервер здесь используется только как "сигналинг" — передаёт SDP/ICE между
// браузерами. Само аудио и показ экрана идут напрямую peer-to-peer, бесплатно.
// STUN-сервер бесплатный (публичный от Google). Без TURN-сервера звонок может
// не пройти у части пользователей за строгим NAT (например, в мобильных сетях) —
// для прототипа это приемлемо, для продакшена стоит добавить бесплатный TURN
// (например, Metered.ca) в массив ICE_SERVERS ниже.

let ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

async function fetchIceServers() {
  try {
    const res = await fetch("/api/ice-servers", { headers: authHeader() });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length) {
      ICE_SERVERS = data.iceServers;
    }
  } catch (e) {
    // не удалось получить ICE-серверы — останемся на публичном STUN
  }
}

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

// ================= Настройки звука (микрофон/динамики/качество) =================
const AUDIO_QUALITY_PRESETS = {
  voice: {
    label: "Голос (эконом трафика)",
    hint: "Меньше данных, шумоподавление и эхоподавление включены — подходит для нестабильного интернета.",
    constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    opusBitrate: 24000,
    stereo: false,
  },
  hd: {
    label: "Высокое (по умолчанию)",
    hint: "Баланс качества и стабильности — рекомендуется для большинства.",
    constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 },
    opusBitrate: 96000,
    stereo: false,
  },
  studio: {
    label: "Студийное (без обработки)",
    hint: "Максимальное качество, стерео, без шумоподавления и эхоподавления — обязательно используйте наушники.",
    constraints: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 },
    opusBitrate: 320000,
    stereo: true,
  },
};

let audioQuality = localStorage.getItem("audioQuality") || "hd";
let selectedMicId = localStorage.getItem("selectedMicId") || "";
let selectedSpeakerId = localStorage.getItem("selectedSpeakerId") || "";

function buildMicConstraints() {
  const preset = AUDIO_QUALITY_PRESETS[audioQuality] || AUDIO_QUALITY_PRESETS.hd;
  const c = { ...preset.constraints };
  if (selectedMicId) c.deviceId = { exact: selectedMicId };
  return c;
}

// Поднимает битрейт/каналы Opus в уже сгенерированном SDP согласно выбранному
// пресету качества. Без этого браузеры по умолчанию режут голос до ~32 кбит/с моно.
function boostAudioSdp(sdp) {
  const preset = AUDIO_QUALITY_PRESETS[audioQuality] || AUDIO_QUALITY_PRESETS.hd;
  const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
  if (!opusMatch) return sdp;
  const pt = opusMatch[1];
  const stereoParams = preset.stereo ? "stereo=1;sprop-stereo=1;" : "";
  const extra = `${stereoParams}maxaveragebitrate=${preset.opusBitrate};maxplaybackrate=48000`;
  const fmtpRegex = new RegExp(`a=fmtp:${pt} (.+)`);
  if (fmtpRegex.test(sdp)) {
    return sdp.replace(fmtpRegex, (line, params) => `a=fmtp:${pt} ${params};${extra}`);
  }
  return sdp.replace(opusMatch[0], `${opusMatch[0]}\r\na=fmtp:${pt} ${extra}`);
}

async function ensureMicPermissionForLabels() {
  // Названия устройств доступны только после того, как пользователь хоть раз
  // дал разрешение на микрофон — если разрешения ещё нет, запрашиваем и сразу отпускаем.
  if (localStream) return;
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) {
    // доступ не дали — оставим селекты пустыми, ничего страшного
  }
}

async function populateAudioDevices() {
  await ensureMicPermissionForLabels();
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((d) => d.kind === "audioinput");
  const speakers = devices.filter((d) => d.kind === "audiooutput");

  micSelect.innerHTML = mics
    .map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || "Микрофон " + (i + 1))}</option>`)
    .join("");
  speakerSelect.innerHTML = speakers.length
    ? speakers
        .map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || "Динамики " + (i + 1))}</option>`)
        .join("")
    : `<option value="">По умолчанию (браузер не даёт выбрать)</option>`;

  if (selectedMicId && mics.some((d) => d.deviceId === selectedMicId)) micSelect.value = selectedMicId;
  if (selectedSpeakerId && speakers.some((d) => d.deviceId === selectedSpeakerId)) speakerSelect.value = selectedSpeakerId;
}

function renderAudioQualityPicker() {
  document.querySelectorAll("#audio-quality-picker .status-opt").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.quality === audioQuality);
  });
  audioQualityHint.textContent = (AUDIO_QUALITY_PRESETS[audioQuality] || AUDIO_QUALITY_PRESETS.hd).hint;
}

document.querySelectorAll("#audio-quality-picker .status-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    audioQuality = btn.dataset.quality;
    localStorage.setItem("audioQuality", audioQuality);
    renderAudioQualityPicker();
  });
});

micSelect.addEventListener("change", () => {
  selectedMicId = micSelect.value;
  localStorage.setItem("selectedMicId", selectedMicId);
});
function applySelectedSpeakerToAudio(audioEl) {
  if (!audioEl || !("setSinkId" in audioEl) || !selectedSpeakerId) return Promise.resolve();
  return audioEl.setSinkId(selectedSpeakerId).catch(() => {});
}

function applySelectedSpeaker() {
  applySelectedSpeakerToAudio(micTestAudioEl);
  remoteAudioContainer.querySelectorAll("audio").forEach((audioEl) => {
    applySelectedSpeakerToAudio(audioEl);
  });
}

speakerSelect.addEventListener("change", async () => {
  selectedSpeakerId = speakerSelect.value;
  localStorage.setItem("selectedSpeakerId", selectedSpeakerId);
  await applySelectedSpeaker();
});

// ----- Проверка микрофона (слышишь себя + индикатор уровня) -----
let micTestStream = null;
let micTestAudioCtx = null;
let micTestRafId = null;
const micTestAudioEl = new Audio();
micTestAudioEl.autoplay = true;

async function startMicTest() {
  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({ audio: buildMicConstraints() });
  } catch (e) {
    addSystemMessage("Нет доступа к микрофону");
    return;
  }
  micTestAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = micTestAudioCtx.createMediaStreamSource(micTestStream);

  // Воспроизведение "себя" — через отдельный <audio>, чтобы можно было выбрать
  // устройство вывода через setSinkId (Web Audio API это напрямую не умеет).
  const dest = micTestAudioCtx.createMediaStreamDestination();
  source.connect(dest);
  micTestAudioEl.srcObject = dest.stream;
  await applySelectedSpeakerToAudio(micTestAudioEl);
  micTestAudioEl.play().catch(() => {});

  // Индикатор уровня громкости
  const analyser = micTestAudioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    micLevelFill.style.width = Math.min(100, (avg / 128) * 100) + "%";
    micTestRafId = requestAnimationFrame(tick);
  };
  tick();

  micTestBtn.textContent = "Остановить проверку";
  micTestBtn.classList.add("active");
}

function stopMicTest() {
  if (micTestRafId) cancelAnimationFrame(micTestRafId);
  micTestRafId = null;
  if (micTestStream) {
    micTestStream.getTracks().forEach((t) => t.stop());
    micTestStream = null;
  }
  if (micTestAudioCtx) {
    micTestAudioCtx.close();
    micTestAudioCtx = null;
  }
  micTestAudioEl.srcObject = null;
  micLevelFill.style.width = "0%";
  micTestBtn.textContent = "Проверить микрофон";
  micTestBtn.classList.remove("active");
}

micTestBtn.addEventListener("click", () => {
  if (micTestStream) stopMicTest();
  else startMicTest();
});

audioSettingsBtn.addEventListener("click", async () => {
  audioSettingsModal.classList.remove("hidden");
  renderAudioQualityPicker();
  await populateAudioDevices();
});
audioSettingsCloseBtn.addEventListener("click", () => {
  stopMicTest();
  audioSettingsModal.classList.add("hidden");
});

async function getMic() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: buildMicConstraints() });
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
  // Перехватываем setLocalDescription, чтобы поднять битрейт/качество Opus
  // во ВСЕХ офферах/ответах звонка, не трогая каждое место создания offer'а по отдельности.
  const originalSetLocalDescription = pc.setLocalDescription.bind(pc);
  pc.setLocalDescription = (desc) => {
    if (desc && desc.sdp) desc.sdp = boostAudioSdp(desc.sdp);
    return originalSetLocalDescription(desc);
  };
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
  applySelectedSpeakerToAudio(audioEl);
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
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 60, max: 60 } },
      audio: false,
    });
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
    const sender = pc.addTrack(track, screenStream);
    try {
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = 8_000_000; // ~8 Мбит/с — с запасом для 1080p60
      params.degradationPreference = "maintain-resolution";
      await sender.setParameters(params);
    } catch (e) {
      // setParameters может быть недоступен до первого согласования в некоторых браузерах — не критично
    }
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
