const socket = io();

const appCard = document.getElementById("appCard");
const nameStep = document.getElementById("nameStep");
const lobbyStep = document.getElementById("lobbyStep");
const gamePanel = document.getElementById("gamePanel");
const playerNameInput = document.getElementById("playerName");
const continueNameButton = document.getElementById("continueNameButton");
const changeNameButton = document.getElementById("changeNameButton");
const playerGreeting = document.getElementById("playerGreeting");
const roomCodeInput = document.getElementById("roomCode");
const createRoomButton = document.getElementById("createRoomButton");
const createBotRoomButton = document.getElementById("createBotRoomButton");
const joinRoomButton = document.getElementById("joinRoomButton");
const lobbyMessage = document.getElementById("lobbyMessage");
const roomsList = document.getElementById("roomsList");
const roomDisplay = document.getElementById("roomDisplay");
const turnDisplay = document.getElementById("turnDisplay");
const youDisplay = document.getElementById("youDisplay");
const timerDisplay = document.getElementById("timerDisplay");
const copyCodeButton = document.getElementById("copyCodeButton");
const playerOneName = document.getElementById("playerOneName");
const playerTwoName = document.getElementById("playerTwoName");
const gameMessage = document.getElementById("gameMessage");
const boardWrap = document.getElementById("boardWrap");
const boardElement = document.getElementById("board");
const startGameButton = document.getElementById("startGameButton");
const restartButton = document.getElementById("restartButton");
const leaveButton = document.getElementById("leaveButton");
const refreshHintButton = document.getElementById("refreshHintButton");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

const ROWS = 6;
const COLS = 7;
let roomState = null;
let savedPlayerName = "";
let copyResetTimer = null;
let timerInterval = null;

function setMessage(element, text, tone = "") {
  element.textContent = text;
  element.className = element.id === "lobbyMessage" ? "message-band" : "game-message";

  if (tone) {
    element.classList.add(tone);
  }
}

function normalizeRoomCode(value) {
  return value.trim().toUpperCase();
}

function formatTimer(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function syncViewState() {
  const hasName = Boolean(savedPlayerName);

  nameStep.classList.toggle("hidden", hasName);
  lobbyStep.classList.toggle("hidden", !hasName);
  gamePanel.classList.toggle("hidden", !roomState);
  appCard.classList.toggle("solo-layout", !roomState);
  chatInput.disabled = !roomState;

  playerGreeting.textContent = hasName
    ? `${savedPlayerName}, choose whether you want to create a room or join one with a code.`
    : "";
}

function getYourPlayer() {
  if (!roomState) {
    return null;
  }

  return roomState.players.find((player) => player.id === socket.id) || null;
}

function getPlayerByColor(color) {
  return roomState?.players.find((player) => player.color === color) || null;
}

function getWinningCellSet() {
  return new Set((roomState?.winningCells || []).map(([row, column]) => `${row}-${column}`));
}

function updateTurnTimer() {
  if (!roomState) {
    timerDisplay.textContent = "--:--";
    timerDisplay.classList.remove("timer-warning");
    return;
  }

  const currentPlayer = getPlayerByColor(roomState.currentTurn);

  const shouldPause =
    roomState.winner ||
    roomState.draw ||
    currentPlayer?.isBot ||
    (
      (!roomState.mode || roomState.mode === "human") &&
      (roomState.players.length < 2 || !roomState.gameStarted)
    );

  if (shouldPause) {
    timerDisplay.textContent = roomState.winner || roomState.draw
      ? "Stopped"
      : currentPlayer?.isBot
        ? "Computer"
      : roomState.players.length < 2
        ? "Waiting"
        : "Ready";
    timerDisplay.classList.remove("timer-warning");
    return;
  }

  const remainingMs = Math.max(
    0,
    (roomState.turnTimeLimitMs || 0) - (Date.now() - (roomState.turnStartedAt || Date.now()))
  );

  timerDisplay.textContent = formatTimer(remainingMs);
  timerDisplay.classList.toggle("timer-warning", remainingMs <= 5000);
}

function updateStatus() {
  const yourPlayer = getYourPlayer();
  const redPlayer = getPlayerByColor("red");
  const yellowPlayer = getPlayerByColor("yellow");
  const playerCount = roomState?.players.length || 0;
  const roundOver = Boolean(roomState?.winner || roomState?.draw);
  const isHost = Boolean(yourPlayer && !yourPlayer.isBot && yourPlayer.slot === 1);
  const waitingForHostStart = Boolean(
    roomState &&
    roomState.mode === "human" &&
    playerCount === 2 &&
    !roomState.gameStarted &&
    !roundOver
  );

  roomDisplay.textContent = roomState ? roomState.roomId : "Not connected";
  youDisplay.textContent = yourPlayer
    ? `${yourPlayer.name} (${yourPlayer.color})`
    : "Spectator";

  playerOneName.textContent = redPlayer ? redPlayer.name : "Waiting...";
  playerTwoName.textContent = yellowPlayer ? yellowPlayer.name : "Waiting...";
  copyCodeButton.disabled = !roomState || roomState.mode === "bot";
  copyCodeButton.textContent = roomState?.mode === "bot" ? "Computer Match" : "Copy Room Code";
  startGameButton.classList.toggle("hidden", !waitingForHostStart || !isHost);
  startGameButton.disabled = !waitingForHostStart || !isHost;
  restartButton.classList.toggle("hidden", !roundOver);
  restartButton.disabled = !roundOver;
  restartButton.textContent = roomState?.winner ? "Restart Game" : "Play Again";

  if (!roomState) {
    turnDisplay.textContent = "Waiting";
    setMessage(
      gameMessage,
      savedPlayerName ? "Create or join a room to start playing." : "Enter your name to continue."
    );
    boardWrap.classList.add("disabled");
    updateTurnTimer();
    return;
  }

  if (roomState.winner) {
    const winner = getPlayerByColor(roomState.winner);
    turnDisplay.textContent = "Round over";
    setMessage(
      gameMessage,
      `${winner?.name || roomState.winner} wins the round.`,
      "success"
    );
    boardWrap.classList.remove("disabled");
    updateTurnTimer();
    return;
  }

  if (roomState.draw) {
    turnDisplay.textContent = "Draw";
    setMessage(gameMessage, "The board is full. This round is a draw.", "success");
    boardWrap.classList.remove("disabled");
    updateTurnTimer();
    return;
  }

  if (playerCount < 2) {
    turnDisplay.textContent = "Waiting";
    setMessage(gameMessage, roomState.notice || "Waiting for another player.");
    boardWrap.classList.add("disabled");
    updateTurnTimer();
    return;
  }

  if (waitingForHostStart) {
    turnDisplay.textContent = "Ready";
    setMessage(
      gameMessage,
      isHost
        ? "Both players are here. Press Start Game when you are ready."
        : "Both players are here. Waiting for the host to start the game."
    );
    boardWrap.classList.add("disabled");
    updateTurnTimer();
    return;
  }

  const currentPlayer = getPlayerByColor(roomState.currentTurn);
  const isYourTurn = yourPlayer && yourPlayer.color === roomState.currentTurn;

  turnDisplay.textContent = currentPlayer ? `${currentPlayer.name}'s turn` : "In play";
  setMessage(
    gameMessage,
    isYourTurn
      ? "Your turn. Choose a column to drop your disc."
      : currentPlayer?.isBot
        ? "Computer is thinking..."
        : "Opponent is thinking..."
  );
  boardWrap.classList.remove("disabled");
  updateTurnTimer();
}

function renderBoard() {
  const winningCells = getWinningCellSet();
  boardElement.innerHTML = "";

  const board = roomState?.board || Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  board.forEach((row, rowIndex) => {
    row.forEach((disc, columnIndex) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(rowIndex);
      cell.dataset.column = String(columnIndex);
      cell.dataset.disc = disc || "";
      cell.setAttribute("aria-label", `Column ${columnIndex + 1}, row ${rowIndex + 1}`);

      if (winningCells.has(`${rowIndex}-${columnIndex}`)) {
        cell.classList.add("winning");
      }

      cell.addEventListener("click", () => {
        const yourPlayer = getYourPlayer();

        if (!roomState || !yourPlayer || roomState.players.length < 2) {
          return;
        }

        if (roomState.mode === "human" && !roomState.gameStarted) {
          return;
        }

        if (roomState.winner || roomState.draw) {
          return;
        }

        socket.emit("dropDisc", { column: columnIndex });
      });

      boardElement.appendChild(cell);
    });
  });
}

function renderChat() {
  chatMessages.innerHTML = "";

  if (!roomState) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "Join a room to start chatting.";
    chatMessages.appendChild(empty);
    return;
  }

  const history = roomState.chatHistory || [];

  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "No messages yet. Say hello to the other player.";
    chatMessages.appendChild(empty);
    return;
  }

  history.forEach((message) => {
    const bubble = document.createElement("article");
    bubble.className = "chat-bubble";

    if (message.system) {
      bubble.classList.add("system");
    } else if (message.senderId === socket.id) {
      bubble.classList.add("self");
    }

    const author = document.createElement("p");
    author.className = "chat-author";
    author.textContent = message.system ? "System" : message.senderName;

    const text = document.createElement("p");
    text.className = "chat-text";
    text.textContent = message.text;

    bubble.append(author, text);
    chatMessages.appendChild(bubble);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function requireName() {
  const name = savedPlayerName.trim();

  if (!name) {
    setMessage(lobbyMessage, "Enter your name first.", "error");
    syncViewState();
    playerNameInput.focus();
    return null;
  }

  return name;
}

function copyRoomCode() {
  if (!roomState || roomState.mode === "bot") {
    return;
  }

  const roomCode = roomState.roomId;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(roomCode).catch(() => {
      setMessage(lobbyMessage, `Room code: ${roomCode}`, "success");
    });
  } else {
    setMessage(lobbyMessage, `Room code: ${roomCode}`, "success");
  }

  copyCodeButton.textContent = "Copied!";
  clearTimeout(copyResetTimer);
  copyResetTimer = window.setTimeout(() => {
    copyCodeButton.textContent = "Copy Room Code";
  }, 1500);
  setMessage(lobbyMessage, `Room code ${roomCode} copied.`, "success");
}

function saveNameAndAdvance() {
  const name = playerNameInput.value.trim().replace(/\s+/g, " ").slice(0, 18);

  if (!name) {
    setMessage(lobbyMessage, "Enter your name first.", "error");
    playerNameInput.focus();
    return;
  }

  savedPlayerName = name;
  playerNameInput.value = name;
  setMessage(lobbyMessage, "Name saved. Now choose create room or join room.", "success");
  syncViewState();
  roomCodeInput.focus();
  updateStatus();
}

function handleJoin(roomCode) {
  const name = requireName();

  if (!name) {
    return;
  }

  if (roomState) {
    setMessage(
      lobbyMessage,
      "Leave the current room before joining another one.",
      "error"
    );
    return;
  }

  const normalizedCode = normalizeRoomCode(roomCode || roomCodeInput.value);

  if (!normalizedCode) {
    setMessage(lobbyMessage, "Enter a room code to join.", "error");
    roomCodeInput.focus();
    return;
  }

  roomCodeInput.value = normalizedCode;
  socket.emit("joinRoom", { name, roomId: normalizedCode });
}

function renderRooms(rooms) {
  roomsList.innerHTML = "";

  if (!rooms.length) {
    const empty = document.createElement("p");
    empty.textContent = "No open rooms right now. Create one and invite a friend.";
    roomsList.appendChild(empty);
    return;
  }

  rooms.forEach((room) => {
    const item = document.createElement("article");
    item.className = "room-item";

    const meta = document.createElement("div");
    meta.className = "room-meta";

    const code = document.createElement("p");
    code.className = "room-code";
    code.textContent = room.roomId;

    const subtext = document.createElement("p");
    subtext.className = "room-subtext";
    subtext.textContent = `${room.hostName} is waiting - ${room.playerCount}/${room.maxPlayers}`;

    meta.append(code, subtext);

    const joinButton = document.createElement("button");
    joinButton.type = "button";
    joinButton.className = "join-inline-button";
    joinButton.textContent = "Join";
    joinButton.addEventListener("click", () => {
      handleJoin(room.roomId);
    });

    item.append(meta, joinButton);
    roomsList.appendChild(item);
  });
}

continueNameButton.addEventListener("click", () => {
  saveNameAndAdvance();
});

changeNameButton.addEventListener("click", () => {
  if (roomState) {
    setMessage(lobbyMessage, "Leave the room before changing your name.", "error");
    return;
  }

  savedPlayerName = "";
  roomCodeInput.value = "";
  setMessage(lobbyMessage, "Update your name, then continue.", "success");
  syncViewState();
  updateStatus();
  playerNameInput.focus();
});

createRoomButton.addEventListener("click", () => {
  const name = requireName();

  if (!name) {
    return;
  }

  if (roomState) {
    setMessage(
      lobbyMessage,
      "Leave the current room before creating another one.",
      "error"
    );
    return;
  }

  socket.emit("createRoom", { name });
});

createBotRoomButton.addEventListener("click", () => {
  const name = requireName();

  if (!name) {
    return;
  }

  if (roomState) {
    setMessage(
      lobbyMessage,
      "Leave the current room before starting a computer match.",
      "error"
    );
    return;
  }

  socket.emit("createBotRoom", { name });
});

joinRoomButton.addEventListener("click", () => {
  handleJoin();
});

copyCodeButton.addEventListener("click", () => {
  copyRoomCode();
});

startGameButton.addEventListener("click", () => {
  if (!roomState) {
    return;
  }

  socket.emit("startGame");
});

restartButton.addEventListener("click", () => {
  if (!roomState) {
    setMessage(gameMessage, "Join a room before starting a new round.", "error");
    return;
  }

  socket.emit("restartGame");
});

leaveButton.addEventListener("click", () => {
  socket.emit("leaveRoom");
});

refreshHintButton.addEventListener("click", () => {
  setMessage(lobbyMessage, "Room list updates live while players create and leave rooms.", "success");
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!roomState) {
    return;
  }

  const text = chatInput.value.trim();

  if (!text) {
    return;
  }

  socket.emit("sendChat", { text });
  chatInput.value = "";
  chatInput.focus();
});

playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    saveNameAndAdvance();
  }
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
});

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleJoin();
  }
});

socket.on("roomState", (nextRoomState) => {
  roomState = nextRoomState;
  roomCodeInput.value = nextRoomState.roomId;

  if (nextRoomState.notice) {
    setMessage(lobbyMessage, nextRoomState.notice, "success");
  } else {
    setMessage(lobbyMessage, "");
  }

  syncViewState();
  renderBoard();
  renderChat();
  updateStatus();
  updateTurnTimer();
});

socket.on("roomsList", (rooms) => {
  renderRooms(rooms);
});

socket.on("lobbyError", (message) => {
  setMessage(lobbyMessage, message, "error");
  setMessage(gameMessage, message, "error");
});

socket.on("leftRoom", () => {
  roomState = null;
  roomCodeInput.value = "";
  syncViewState();
  renderBoard();
  renderChat();
  updateStatus();
  setMessage(lobbyMessage, "You left the room. Choose create or join to play again.", "success");
});

syncViewState();
renderBoard();
renderChat();
updateStatus();
updateTurnTimer();
timerInterval = window.setInterval(updateTurnTimer, 250);
