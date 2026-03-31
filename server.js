const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROWS = 6;
const COLS = 7;
const ROOM_CODE_LENGTH = 5;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CHAT_LIMIT = 30;
const CHAT_MAX_LENGTH = 180;
const BOT_NAME = "Computer";
const BOT_DELAY_MS = 650;
const TURN_TIME_LIMIT_MS = 20000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function generateRoomCode() {
  let code = "";

  do {
    code = Array.from({ length: ROOM_CODE_LENGTH }, () => {
      const index = Math.floor(Math.random() * ROOM_ALPHABET.length);
      return ROOM_ALPHABET[index];
    }).join("");
  } while (rooms.has(code));

  return code;
}

function sanitizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18);
}

function sanitizeChatMessage(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, CHAT_MAX_LENGTH);
}

function createChatMessage({ senderId = "", senderName, text, system = false }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    senderId,
    senderName,
    text,
    system
  };
}

function addChatMessage(room, message) {
  if (!room.messages) {
    room.messages = [];
  }

  room.messages.push(message);

  if (room.messages.length > CHAT_LIMIT) {
    room.messages = room.messages.slice(-CHAT_LIMIT);
  }
}

function addSystemMessage(room, text) {
  addChatMessage(
    room,
    createChatMessage({
      senderName: "System",
      text,
      system: true
    })
  );
}

function getOpponentColor(color) {
  return color === "red" ? "yellow" : "red";
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function findOpenRow(board, column) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (!board[row][column]) {
      return row;
    }
  }

  return -1;
}

function isBoardFull(board) {
  return board[0].every(Boolean);
}

function getValidColumns(board) {
  return Array.from({ length: COLS }, (_, column) => column).filter(
    (column) => findOpenRow(board, column) !== -1
  );
}

function findWinningCells(board, row, column, color) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (const [rowStep, colStep] of directions) {
    const cells = [[row, column]];

    for (const direction of [-1, 1]) {
      let nextRow = row + rowStep * direction;
      let nextCol = column + colStep * direction;

      while (
        nextRow >= 0 &&
        nextRow < ROWS &&
        nextCol >= 0 &&
        nextCol < COLS &&
        board[nextRow][nextCol] === color
      ) {
        if (direction === -1) {
          cells.unshift([nextRow, nextCol]);
        } else {
          cells.push([nextRow, nextCol]);
        }

        nextRow += rowStep * direction;
        nextCol += colStep * direction;
      }
    }

    if (cells.length >= 4) {
      return cells.slice(0, 4);
    }
  }

  return null;
}

function buildRoomState(room) {
  return {
    roomId: room.id,
    mode: room.mode,
    gameStarted: room.gameStarted,
    board: room.board,
    currentTurn: room.currentTurn,
    turnStartedAt: room.turnStartedAt,
    turnTimeLimitMs: room.turnTimeLimitMs,
    winner: room.winner,
    winningCells: room.winningCells,
    draw: room.draw,
    chatHistory: room.messages,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      slot: player.slot,
      isBot: Boolean(player.isBot)
    }))
  };
}

function buildRoomSummaries() {
  return Array.from(rooms.values())
    .filter((room) => room.mode !== "bot")
    .filter((room) => room.players.length < 2)
    .map((room) => ({
      roomId: room.id,
      hostName: room.players[0]?.name || "Waiting",
      playerCount: room.players.length,
      maxPlayers: 2
    }));
}

function broadcastRoomList() {
  io.emit("roomsList", buildRoomSummaries());
}

function emitRoomState(room, notice = "") {
  io.to(room.id).emit("roomState", {
    ...buildRoomState(room),
    notice
  });
}

function resetRoom(room) {
  room.board = createEmptyBoard();
  room.currentTurn = "red";
  room.turnStartedAt = Date.now();
  room.turnTimeLimitMs = TURN_TIME_LIMIT_MS;
  room.winner = null;
  room.winningCells = [];
  room.draw = false;

  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
}

function rebalancePlayers(room) {
  if (room.mode === "bot") {
    return;
  }

  const colors = ["red", "yellow"];

  room.players.forEach((player, index) => {
    player.slot = index + 1;
    player.color = colors[index];
  });
}

function getCurrentPlayer(room) {
  return room.players.find((player) => player.color === room.currentTurn) || null;
}

function removeTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function removeBotTimer(room) {
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
}

function startTurnTimer(room) {
  removeTurnTimer(room);

  if (!room.gameStarted || room.winner || room.draw || room.players.length < 2) {
    return;
  }

  room.turnStartedAt = Date.now();
  const currentPlayer = getCurrentPlayer(room);

  if (!currentPlayer || currentPlayer.isBot) {
    return;
  }

  room.turnTimer = setTimeout(() => {
    const latestRoom = rooms.get(room.id);

    if (!latestRoom || !latestRoom.gameStarted || latestRoom.winner || latestRoom.draw) {
      return;
    }

    const timedOutPlayer = getCurrentPlayer(latestRoom);

    if (!timedOutPlayer || timedOutPlayer.isBot) {
      return;
    }

    latestRoom.turnTimer = null;
    latestRoom.currentTurn = getOpponentColor(timedOutPlayer.color);
    latestRoom.turnStartedAt = Date.now();

    const nextPlayer = getCurrentPlayer(latestRoom);
    const notice = `${timedOutPlayer.name} ran out of time. ${nextPlayer?.name || "Next player"} can move now.`;
    addSystemMessage(latestRoom, notice);
    startTurnTimer(latestRoom);
    emitRoomState(latestRoom, notice);
    queueBotMove(latestRoom);
  }, room.turnTimeLimitMs);
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;

  if (!roomId || !rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  room.players = room.players.filter((player) => player.id !== socket.id);
  socket.leave(room.id);
  socket.data.roomId = null;
  removeTurnTimer(room);
  removeBotTimer(room);

  if (room.players.length === 0 || room.players.every((player) => player.isBot)) {
    rooms.delete(room.id);
  } else {
    rebalancePlayers(room);
    resetRoom(room);
    room.gameStarted = false;
    addSystemMessage(room, "A player left the room.");
    emitRoomState(room, "A player left the room. Waiting for another player.");
  }

  broadcastRoomList();
}

function tryMove(board, column, color) {
  const row = findOpenRow(board, column);

  if (row === -1) {
    return null;
  }

  const nextBoard = cloneBoard(board);
  nextBoard[row][column] = color;

  return {
    row,
    winningCells: findWinningCells(nextBoard, row, column, color)
  };
}

function chooseBotColumn(room) {
  const validColumns = getValidColumns(room.board);

  for (const column of validColumns) {
    const attemptedMove = tryMove(room.board, column, "yellow");

    if (attemptedMove?.winningCells) {
      return column;
    }
  }

  for (const column of validColumns) {
    const attemptedMove = tryMove(room.board, column, "red");

    if (attemptedMove?.winningCells) {
      return column;
    }
  }

  const preferredColumns = [3, 2, 4, 1, 5, 0, 6];
  return preferredColumns.find((column) => validColumns.includes(column)) ?? validColumns[0] ?? 0;
}

function queueBotMove(room) {
  if (
    room.mode !== "bot" ||
    room.currentTurn !== "yellow" ||
    room.winner ||
    room.draw
  ) {
    return;
  }

  removeBotTimer(room);
  room.botTimer = setTimeout(() => {
    const latestRoom = rooms.get(room.id);

    if (
      !latestRoom ||
      latestRoom.mode !== "bot" ||
      latestRoom.currentTurn !== "yellow" ||
      latestRoom.winner ||
      latestRoom.draw
    ) {
      return;
    }

    latestRoom.botTimer = null;
    const botPlayer = latestRoom.players.find((player) => player.isBot);

    if (!botPlayer) {
      return;
    }

    const column = chooseBotColumn(latestRoom);
    const row = findOpenRow(latestRoom.board, column);

    if (row === -1) {
      return;
    }

    latestRoom.board[row][column] = botPlayer.color;
    const winningCells = findWinningCells(latestRoom.board, row, column, botPlayer.color);

    if (winningCells) {
      latestRoom.winner = botPlayer.color;
      latestRoom.winningCells = winningCells;
    } else if (isBoardFull(latestRoom.board)) {
      latestRoom.draw = true;
    } else {
      latestRoom.currentTurn = getOpponentColor(botPlayer.color);
      startTurnTimer(latestRoom);
    }

    emitRoomState(latestRoom, `${BOT_NAME} made a move.`);
  }, BOT_DELAY_MS);
}

io.on("connection", (socket) => {
  socket.emit("roomsList", buildRoomSummaries());

  socket.on("createRoom", ({ name }) => {
    const playerName = sanitizeName(name);

    if (!playerName) {
      socket.emit("lobbyError", "Enter your name before creating a room.");
      return;
    }

    leaveCurrentRoom(socket);

    const roomId = generateRoomCode();
    const room = {
      id: roomId,
      mode: "human",
      gameStarted: false,
      board: createEmptyBoard(),
      currentTurn: "red",
      turnStartedAt: Date.now(),
      turnTimeLimitMs: TURN_TIME_LIMIT_MS,
      winner: null,
      winningCells: [],
      draw: false,
      botTimer: null,
      messages: [],
      players: [
        {
          id: socket.id,
          name: playerName,
          color: "red",
          slot: 1,
          isBot: false
        }
      ]
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    addSystemMessage(room, `${playerName} created the room.`);

    emitRoomState(room, "Room created. Share the code so another player can join.");
    broadcastRoomList();
  });

  socket.on("createBotRoom", ({ name }) => {
    const playerName = sanitizeName(name);

    if (!playerName) {
      socket.emit("lobbyError", "Enter your name before starting a computer game.");
      return;
    }

    leaveCurrentRoom(socket);

    const roomId = generateRoomCode();
    const room = {
      id: roomId,
      mode: "bot",
      gameStarted: true,
      board: createEmptyBoard(),
      currentTurn: "red",
      turnStartedAt: Date.now(),
      turnTimeLimitMs: TURN_TIME_LIMIT_MS,
      winner: null,
      winningCells: [],
      draw: false,
      botTimer: null,
      messages: [],
      players: [
        {
          id: socket.id,
          name: playerName,
          color: "red",
          slot: 1,
          isBot: false
        },
        {
          id: `bot-${roomId}`,
          name: BOT_NAME,
          color: "yellow",
          slot: 2,
          isBot: true
        }
      ]
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    addSystemMessage(room, `${playerName} started a game against ${BOT_NAME}.`);

    startTurnTimer(room);
    emitRoomState(room, `${playerName} versus ${BOT_NAME}. You go first.`);
    broadcastRoomList();
  });

  socket.on("joinRoom", ({ name, roomId }) => {
    const playerName = sanitizeName(name);
    const roomCode = String(roomId || "").trim().toUpperCase();

    if (!playerName) {
      socket.emit("lobbyError", "Enter your name before joining a room.");
      return;
    }

    if (!roomCode) {
      socket.emit("lobbyError", "Enter a room code or choose a room from the list.");
      return;
    }

    if (!rooms.has(roomCode)) {
      socket.emit("lobbyError", "That room does not exist.");
      return;
    }

    const room = rooms.get(roomCode);

    if (room.mode === "bot") {
      socket.emit("lobbyError", "Computer rooms cannot be joined.");
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("lobbyError", "That room is already full.");
      return;
    }

    leaveCurrentRoom(socket);

    room.players.push({
      id: socket.id,
      name: playerName,
      color: "yellow",
      slot: 2,
      isBot: false
    });

    socket.join(room.id);
    socket.data.roomId = room.id;
    resetRoom(room);
    room.gameStarted = false;
    addSystemMessage(room, `${playerName} joined the room.`);

    emitRoomState(room, `${playerName} joined the room. Host can start the match.`);
    broadcastRoomList();
  });

  socket.on("startGame", () => {
    const roomId = socket.data.roomId;

    if (!roomId || !rooms.has(roomId)) {
      return;
    }

    const room = rooms.get(roomId);

    if (room.mode === "bot") {
      socket.emit("lobbyError", "Computer matches start automatically.");
      return;
    }

    if (room.players.length < 2) {
      socket.emit("lobbyError", "A second player must join before the host can start the game.");
      return;
    }

    const host = room.players[0];

    if (!host || host.id !== socket.id) {
      socket.emit("lobbyError", "Only the host can start the game.");
      return;
    }

    resetRoom(room);
    room.gameStarted = true;
    addSystemMessage(room, `${host.name} started the game.`);
    startTurnTimer(room);
    emitRoomState(room, `${host.name} started the game.`);
  });

  socket.on("dropDisc", ({ column }) => {
    const roomId = socket.data.roomId;

    if (!roomId || !rooms.has(roomId)) {
      socket.emit("lobbyError", "Join a room before making a move.");
      return;
    }

    const room = rooms.get(roomId);
    const player = room.players.find((entry) => entry.id === socket.id);

    if (!player) {
      socket.emit("lobbyError", "You are not part of this room.");
      return;
    }

    if (player.isBot) {
      socket.emit("lobbyError", "The computer handles its own moves.");
      return;
    }

    if (!room.gameStarted) {
      socket.emit("lobbyError", "The host has not started the game yet.");
      return;
    }

    if (room.players.length < 2) {
      socket.emit("lobbyError", "Waiting for a second player.");
      return;
    }

    if (room.winner || room.draw) {
      socket.emit("lobbyError", "This round is over. Start a new round to play again.");
      return;
    }

    if (room.currentTurn !== player.color) {
      socket.emit("lobbyError", "It is not your turn.");
      return;
    }

    if (!Number.isInteger(column) || column < 0 || column >= COLS) {
      socket.emit("lobbyError", "That column is invalid.");
      return;
    }

    const row = findOpenRow(room.board, column);

    if (row === -1) {
      socket.emit("lobbyError", "That column is full.");
      return;
    }

    removeTurnTimer(room);
    room.board[row][column] = player.color;
    const winningCells = findWinningCells(room.board, row, column, player.color);

    if (winningCells) {
      room.winner = player.color;
      room.winningCells = winningCells;
    } else if (isBoardFull(room.board)) {
      room.draw = true;
    } else {
      room.currentTurn = getOpponentColor(player.color);
      startTurnTimer(room);
    }

    emitRoomState(room);
    queueBotMove(room);
  });

  socket.on("restartGame", () => {
    const roomId = socket.data.roomId;

    if (!roomId || !rooms.has(roomId)) {
      return;
    }

    const room = rooms.get(roomId);
    resetRoom(room);
    room.gameStarted = room.mode === "bot" || room.players.length >= 2;
    addSystemMessage(room, "A fresh round has started.");
    startTurnTimer(room);
    emitRoomState(room, "A fresh round has started.");
  });

  socket.on("sendChat", ({ text }) => {
    const roomId = socket.data.roomId;

    if (!roomId || !rooms.has(roomId)) {
      socket.emit("lobbyError", "Join a room before sending a message.");
      return;
    }

    const room = rooms.get(roomId);
    const player = room.players.find((entry) => entry.id === socket.id);
    const messageText = sanitizeChatMessage(text);

    if (!player || !messageText) {
      return;
    }

    addChatMessage(
      room,
      createChatMessage({
        senderId: player.id,
        senderName: player.name,
        text: messageText
      })
    );

    emitRoomState(room);
  });

  socket.on("leaveRoom", () => {
    leaveCurrentRoom(socket);
    socket.emit("leftRoom");
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Connect Four server running on http://localhost:${PORT}`);
});
