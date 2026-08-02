import { updateInputText } from "./src/input-logic.mjs";

const VICTORY_REACTION_SPECS = [
  {
    name: "Success Kid",
    fallback: "https://i.imgflip.com/1bhk.jpg"
  },
  {
    name: "Leonardo Dicaprio Cheers",
    fallback: "https://i.imgflip.com/39t1o.jpg"
  },
  {
    name: "Oprah You Get A",
    fallback: "https://i.imgflip.com/gtj5t.jpg"
  },
  {
    name: "Third World Success Kid",
    fallback: "https://i.imgflip.com/265j.jpg"
  },
  {
    name: "Laughing Leo",
    fallback: "https://i.imgflip.com/4acd7j.jpg"
  }
];

let victoryReactions = VICTORY_REACTION_SPECS.map((reaction) => ({
  ...reaction,
  image: reaction.fallback
}));

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "⌫"]
];

const STORAGE_KEY = "five-word-state-v2";
const BACKGROUND_DB_NAME = "five-customization-v1";
const BACKGROUND_STORE_NAME = "backgrounds";
const BACKGROUND_RECORD_KEY = "page-background";
const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
const board = document.querySelector("#board");
const keyboard = document.querySelector("#keyboard");
const message = document.querySelector("#message");
const helpDialog = document.querySelector("#help-dialog");
const accountDialog = document.querySelector("#account-dialog");
const accountButton = document.querySelector("#account-button");
const accountCloseButton = document.querySelector("#account-close-button");
const accountSignedOut = document.querySelector("#account-signed-out");
const accountSignedIn = document.querySelector("#account-signed-in");
const accountUsername = document.querySelector("#account-username");
const accountGames = document.querySelector("#account-games");
const accountWins = document.querySelector("#account-wins");
const accountWinRate = document.querySelector("#account-win-rate");
const accountGuessDistribution = document.querySelector("#account-guess-distribution");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const authMessage = document.querySelector("#auth-message");
const logoutButton = document.querySelector("#logout-button");
const logoutAllButton = document.querySelector("#logout-all-button");
const changePasswordForm = document.querySelector("#change-password-form");
const deleteAccountForm = document.querySelector("#delete-account-form");
const hardcoreButton = document.querySelector("#hardcore-button");
const hardcoreLabel = document.querySelector("#hardcore-label");
const hardcoreNote = document.querySelector("#hardcore-note");
const cameraCard = document.querySelector(".camera-card");
const cameraVideo = document.querySelector("#camera-video");
const cameraButton = document.querySelector("#camera-button");
const cameraStatus = document.querySelector("#camera-status");
const victoryDialog = document.querySelector("#victory-dialog");
const victoryImage = document.querySelector("#victory-image");
const victoryWord = document.querySelector("#victory-word");
const hintFirstLetter = document.querySelector("#hint-first-letter");
const hintLastLetter = document.querySelector("#hint-last-letter");
const hintDouble = document.querySelector("#hint-double");
const hintVowels = document.querySelector("#hint-vowels");
const hintPartOfSpeech = document.querySelector("#hint-part-of-speech");
const backgroundFileInput = document.querySelector("#background-file-input");
const backgroundRemoveButton = document.querySelector("#background-remove-button");
const backgroundStatus = document.querySelector("#background-status");

let gameId = "";
let gameAccessToken = "";
let guesses = [];
let guessResults = [];
let current = "";
let finished = false;
let gameStatus = "active";
let revealedAnswer = "";
let hardcoreMode = false;
let requestPending = false;
let gameInitializing = false;
let allowAnyGuess = false;
let currentUser = null;
let currentStatistics = null;
let hintsUsed = 0;
let audioContext;
let cameraStream;
let lastVictoryReactionIndex = -1;
let backgroundObjectUrl = "";

function openBackgroundDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Background storage is not supported by this browser."));
      return;
    }

    const request = indexedDB.open(BACKGROUND_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKGROUND_STORE_NAME)) {
        request.result.createObjectStore(BACKGROUND_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSavedBackground() {
  const database = await openBackgroundDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_STORE_NAME, "readonly");
    const request = transaction.objectStore(BACKGROUND_STORE_NAME).get(BACKGROUND_RECORD_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function saveBackground(blob) {
  const database = await openBackgroundDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_STORE_NAME, "readwrite");
    transaction.objectStore(BACKGROUND_STORE_NAME).put(blob, BACKGROUND_RECORD_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function deleteSavedBackground() {
  const database = await openBackgroundDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_STORE_NAME, "readwrite");
    transaction.objectStore(BACKGROUND_STORE_NAME).delete(BACKGROUND_RECORD_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function applyBackground(blob) {
  if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
  backgroundObjectUrl = URL.createObjectURL(blob);
  document.body.style.backgroundImage = `url("${backgroundObjectUrl}")`;
  backgroundRemoveButton.disabled = false;
  backgroundStatus.textContent = "Custom background active";
}

function clearBackground() {
  if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
  backgroundObjectUrl = "";
  document.body.style.backgroundImage = "none";
  backgroundRemoveButton.disabled = true;
  backgroundStatus.textContent = "No custom background";
}

async function initializeBackground() {
  try {
    const savedBackground = await readSavedBackground();
    if (savedBackground instanceof Blob) applyBackground(savedBackground);
  } catch {
    backgroundStatus.textContent = "Background storage unavailable";
  }
}

function playLetterSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audioContext ||= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(520, now);
  oscillator.frequency.exponentialRampToValueAtTime(360, now + 0.045);
  gain.gain.setValueAtTime(0.055, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.05);
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  cameraVideo.srcObject = null;
  cameraCard.classList.remove("camera-on");
  cameraButton.textContent = "Enable camera";
  cameraStatus.textContent = "Camera is off";
}

async function loadVictoryReactions() {
  try {
    const response = await fetch("https://api.imgflip.com/get_memes");
    const payload = await response.json();
    const popular = payload?.data?.memes;
    if (!Array.isArray(popular)) return;

    victoryReactions = VICTORY_REACTION_SPECS.map((reaction) => {
      const current = popular.find((meme) => meme.name === reaction.name);
      return { ...reaction, image: current?.url || reaction.fallback };
    });
  } catch {
    // The curated fallback URLs remain available when the live list is blocked.
  }
}

function closeHints() {
  document
    .querySelectorAll(".hints-panel details")
    .forEach((hint) => { hint.open = false; });
}

function clearHints() {
  [hintFirstLetter, hintLastLetter, hintDouble, hintVowels, hintPartOfSpeech]
    .forEach((hint) => { hint.textContent = ""; });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function requestGameJson(url, options = {}) {
  return requestJson(url, {
    ...options,
    headers: {
      ...(gameAccessToken ? { "x-game-token": gameAccessToken } : {}),
      ...options.headers
    }
  });
}

function showAuthView(view) {
  const showLogin = view === "login";
  loginTab.setAttribute("aria-selected", String(showLogin));
  registerTab.setAttribute("aria-selected", String(!showLogin));
  loginForm.hidden = !showLogin;
  registerForm.hidden = showLogin;
  authMessage.textContent = "";
}

function updateAccountUI() {
  const signedIn = Boolean(currentUser);
  accountSignedOut.hidden = signedIn;
  accountSignedIn.hidden = !signedIn;
  accountButton.textContent = signedIn ? `@${currentUser.username}` : "Account";
  accountButton.title = signedIn ? `Signed in as ${currentUser.username}` : "Log in or create account";
  accountUsername.textContent = signedIn ? currentUser.username : "";
  if (!signedIn) return;

  const statistics = currentStatistics || {
    games: 0,
    wins: 0,
    winRate: 0,
    gamesNoHints: 0,
    winsNoHints: 0,
    winRateNoHints: 0,
    guessDistribution: [0, 0, 0, 0, 0, 0]
  };
  accountGames.textContent = statistics.games.toLocaleString();
  accountWins.textContent = statistics.wins.toLocaleString();
  accountWinRate.textContent = `${statistics.winRate}%`;
  accountGuessDistribution.replaceChildren();
  statistics.guessDistribution.forEach((wins, index) => {
    const item = document.createElement("li");
    item.innerHTML = `<span>${index + 1} guesses</span><strong>${wins.toLocaleString()}</strong>`;
    accountGuessDistribution.appendChild(item);
  });
}

async function loadCurrentUser() {
  try {
    const payload = await requestJson("/api/auth/me");
    currentUser = payload.user;
    currentStatistics = payload.statistics;
  } catch {
    currentUser = null;
    currentStatistics = null;
  }
  updateAccountUI();
}

async function submitAccountForm(form, endpoint) {
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  authMessage.textContent = endpoint === "register"
    ? "Creating account…"
    : "Logging in…";
  try {
    const values = Object.fromEntries(new FormData(form));
    if (endpoint === "register" && values.password !== values.passwordConfirmation) {
      throw new Error("Passwords do not match");
    }
    const payload = await requestJson(`/api/auth/${endpoint}`, {
      method: "POST",
      body: JSON.stringify(values)
    });
    currentUser = payload.user;
    currentStatistics = payload.statistics;
    form.reset();
    updateAccountUI();
    authMessage.textContent = endpoint === "register"
      ? "Account created."
      : "Logged in.";
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
}

function showSignedOutAccount() {
  currentUser = null;
  currentStatistics = null;
  updateAccountUI();
  showAuthView("login");
}

async function revealHint(details) {
  if (!details.open || !gameId) return;
  if (finished) {
    details.open = false;
    showMessage("Hints are unavailable after the game ends");
    return;
  }
  const value = details.querySelector("p");
  if (value.dataset.loadedFor === gameId) return;
  if (hintsUsed === 0) {
    const confirmed = window.confirm(
      "Games that used hints will not count towards distribution. Reveal this hint?"
    );
    if (!confirmed) {
      details.open = false;
      return;
    }
  }
  value.textContent = "Loading…";
  try {
    const payload = await requestGameJson(
      `/api/games/${encodeURIComponent(gameId)}/hints/${details.dataset.hintType}`
    );
    value.textContent = payload.value;
    value.dataset.loadedFor = gameId;
    hintsUsed = payload.hintsUsed;
  } catch (error) {
    value.textContent = error.message;
  }
}

document.querySelectorAll(".hints-panel details").forEach((details) => {
  details.addEventListener("toggle", () => revealHint(details));
});

function showVictory() {
  let index;
  do {
    index = Math.floor(Math.random() * victoryReactions.length);
  } while (
    victoryReactions.length > 1 &&
    index === lastVictoryReactionIndex
  );

  lastVictoryReactionIndex = index;
  const reaction = victoryReactions[index];
  victoryImage.src = reaction.image;
  victoryImage.alt = reaction.name;
  victoryWord.textContent = `The word was ${revealedAnswer}.`;
  if (!victoryDialog.open) victoryDialog.showModal();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "Camera needs HTTPS or localhost";
    cameraButton.textContent = "Camera unavailable";
    cameraButton.disabled = true;
    return;
  }

  cameraButton.disabled = true;
  cameraButton.textContent = "Connecting…";
  cameraStatus.textContent = "Waiting for permission";

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 480 },
        height: { ideal: 640 }
      },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    cameraCard.classList.add("camera-on");
    cameraButton.textContent = "Turn camera off";
    cameraStatus.textContent = "Camera is on";
  } catch {
    cameraStatus.textContent = "Camera permission was not granted";
    cameraButton.textContent = "Try camera again";
  } finally {
    cameraButton.disabled = false;
  }
}

function buildBoard() {
  board.innerHTML = "";
  for (let row = 0; row < 6; row += 1) {
    const rowElement = document.createElement("div");
    rowElement.className = "row";
    for (let column = 0; column < 5; column += 1) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.row = row;
      tile.dataset.column = column;
      rowElement.appendChild(tile);
    }
    board.appendChild(rowElement);
  }
}

function renderLetter(element, letter) {
  element.textContent = letter || "";
}

function buildKeyboard() {
  keyboard.innerHTML = "";
  KEY_ROWS.forEach((letters) => {
    const row = document.createElement("div");
    row.className = "keyboard-row";
    letters.forEach((letter) => {
      const key = document.createElement("button");
      key.className = `key ${letter.length > 1 ? "wide" : ""}`;
      renderLetter(key, letter);
      key.dataset.key = letter;
      key.setAttribute("aria-label", letter === "⌫" ? "Backspace" : letter);
      key.addEventListener("click", () => handleKey(letter));
      row.appendChild(key);
    });
    keyboard.appendChild(row);
  });
}

function saveGame() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ gameId, gameAccessToken, current, hardcoreMode })
  );
}

function renderSavedGame() {
  guesses.forEach((guess, rowIndex) => {
    const result = guessResults[rowIndex];
    const row = board.children[rowIndex];
    [...row.children].forEach((tile, columnIndex) => {
      const letter = guess[columnIndex];
      renderLetter(tile, letter);
      tile.classList.add("filled", result[columnIndex]);
      updateKey(letter, result[columnIndex]);
    });
  });

  updateCurrentRow();

  if (finished) {
    message.textContent = gameStatus === "won"
      ? "You got it!"
      : `The word was ${revealedAnswer}`;
  }
}

function loadGame() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      typeof saved?.gameId === "string" &&
      saved.gameId.length > 0 &&
      typeof saved.gameAccessToken === "string" &&
      typeof saved.current === "string" &&
      /^[A-Z]{0,5}$/.test(saved.current)
    ) {
      return saved;
    }
  } catch {
    // Invalid browser state is discarded below.
  }
  localStorage.removeItem(STORAGE_KEY);
  return null;
}

function applyServerGame(game) {
  gameId = game.id;
  guesses = game.guesses.map((entry) => entry.guess);
  guessResults = game.guesses.map((entry) => entry.result);
  gameStatus = game.status;
  finished = game.status === "won" || game.status === "lost";
  revealedAnswer = game.answer || "";
  hardcoreMode = game.hardcoreMode;
  hintsUsed = game.hintsUsed;
  if (finished) current = "";
}

async function createServerGame(previousGameId = "") {
  const payload = await requestGameJson("/api/games", {
    method: "POST",
    body: JSON.stringify({ hardcoreMode, previousGameId })
  });
  gameAccessToken = payload.gameAccessToken;
  applyServerGame(payload.game);
}

async function startGame(reset = false) {
  const selectedMode = hardcoreMode;
  if (victoryDialog.open) victoryDialog.close();
  closeHints();
  clearHints();
  guesses = [];
  guessResults = [];
  current = "";
  finished = false;
  gameStatus = "active";
  revealedAnswer = "";
  hintsUsed = 0;
  message.textContent = "";
  buildBoard();
  buildKeyboard();
  gameInitializing = true;
  requestPending = true;
  message.textContent = "Loading game…";

  try {
    hardcoreMode = selectedMode;
    if (reset) {
      const previousGameId = gameId;
      localStorage.removeItem(STORAGE_KEY);
      await createServerGame(previousGameId);
    } else {
      const saved = loadGame();
      if (saved) {
        current = saved.current;
        gameAccessToken = saved.gameAccessToken;
        try {
          const payload = await requestGameJson(`/api/games/${encodeURIComponent(saved.gameId)}`);
          applyServerGame(payload.game);
        } catch (error) {
          if (![403, 404].includes(error.status)) throw error;
          current = "";
          gameAccessToken = "";
          hardcoreMode = Boolean(saved.hardcoreMode);
          await createServerGame();
        }
      } else {
        await createServerGame();
      }
    }

    message.textContent = "";
    buildBoard();
    buildKeyboard();
    renderSavedGame();
    updateHardcoreControl();
    saveGame();
  } catch (error) {
    message.textContent = `Game server unavailable: ${error.message}`;
  } finally {
    gameInitializing = false;
    requestPending = false;
  }
}

function showMessage(text) {
  message.textContent = text;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    if (!finished) message.textContent = "";
  }, 1800);
}

function updateCurrentRow() {
  const row = board.children[guesses.length];
  if (!row) return;
  [...row.children].forEach((tile, index) => {
    renderLetter(tile, current[index]);
    tile.classList.toggle("filled", Boolean(current[index]));
  });
}

function updateKey(letter, status) {
  const key = keyboard.querySelector(`[data-key="${letter}"]`);
  if (!key) return;
  const rank = { absent: 1, present: 2, correct: 3 };
  const oldStatus = ["absent", "present", "correct"].find((name) =>
    key.classList.contains(name)
  );
  if (!oldStatus || rank[status] > rank[oldStatus]) {
    key.classList.remove("absent", "present", "correct");
    key.classList.add(status);
  }
}

function updateHardcoreControl() {
  hardcoreButton.classList.toggle("active", hardcoreMode);
  hardcoreButton.setAttribute("aria-pressed", String(hardcoreMode));
  hardcoreButton.disabled = guesses.length > 0;
  hardcoreLabel.textContent = `Hardcore: ${hardcoreMode ? "On" : "Off"}`;
  hardcoreNote.textContent = guesses.length > 0
    ? "Mode locked for this puzzle"
    : "Revealed clues become mandatory";
}

function getHardcoreConstraints() {
  const fixed = Array(5).fill(null);
  const blocked = Array.from({ length: 5 }, () => new Set());
  const minimums = new Map();
  const maximums = new Map();

  guesses.forEach((guess, guessIndex) => {
    const result = guessResults[guessIndex];
    const guessCounts = new Map();
    const matchedCounts = new Map();

    [...guess].forEach((letter, index) => {
      guessCounts.set(letter, (guessCounts.get(letter) || 0) + 1);
      if (result[index] === "correct") {
        fixed[index] = letter;
      } else if (result[index] === "present") {
        blocked[index].add(letter);
      }
      if (result[index] !== "absent") {
        matchedCounts.set(letter, (matchedCounts.get(letter) || 0) + 1);
      }
    });

    guessCounts.forEach((count, letter) => {
      const matched = matchedCounts.get(letter) || 0;
      minimums.set(letter, Math.max(minimums.get(letter) || 0, matched));
      if (matched < count) {
        maximums.set(
          letter,
          Math.min(maximums.get(letter) ?? Infinity, matched)
        );
      }
    });
  });

  return { fixed, blocked, minimums, maximums };
}

function validateHardcoreGuess(guess) {
  if (!hardcoreMode || guesses.length === 0) return "";
  const { fixed, blocked, minimums, maximums } = getHardcoreConstraints();
  const counts = new Map();
  [...guess].forEach((letter) => {
    counts.set(letter, (counts.get(letter) || 0) + 1);
  });

  for (let index = 0; index < fixed.length; index += 1) {
    if (fixed[index] && guess[index] !== fixed[index]) {
      return `Position ${index + 1} must be ${fixed[index]}`;
    }
    if (blocked[index].has(guess[index])) {
      return `${guess[index]} can't be in position ${index + 1}`;
    }
  }

  for (const [letter, minimum] of minimums) {
    if ((counts.get(letter) || 0) < minimum) {
      return minimum === 1
        ? `Guess must contain ${letter}`
        : `Guess must contain ${minimum} ${letter}s`;
    }
  }

  for (const [letter, maximum] of maximums) {
    const count = counts.get(letter) || 0;
    if (count > maximum) {
      return maximum === 0
        ? `${letter} is not in the word`
        : `Use no more than ${maximum} ${letter}`;
    }
  }

  return "";
}

async function submitGuess() {
  if (current.length !== 5) {
    showMessage("Not enough letters");
    shakeRow();
    return;
  }
  const hardcoreError = validateHardcoreGuess(current);
  if (hardcoreError) {
    showMessage(hardcoreError);
    shakeRow();
    return;
  }
  const submittedGuess = current;
  const row = board.children[guesses.length];
  requestPending = true;
  try {
    const guessEndpoint = __DEV_BUILD__ && allowAnyGuess
      ? `/api/dev/games/${encodeURIComponent(gameId)}/guesses`
      : `/api/games/${encodeURIComponent(gameId)}/guesses`;
    const payload = await requestGameJson(
      guessEndpoint,
      { method: "POST", body: JSON.stringify({ guess: submittedGuess }) }
    );
    const result = payload.result;
    current = "";
    applyServerGame(payload.game);
    [...row.children].forEach((tile, index) => {
      window.setTimeout(() => {
        tile.classList.add(result[index]);
        updateKey(submittedGuess[index], result[index]);
      }, index * 120);
    });

    updateHardcoreControl();
    if (gameStatus === "won") {
      window.setTimeout(() => { message.textContent = "You got it!"; }, 650);
      window.setTimeout(showVictory, 850);
    } else if (gameStatus === "lost") {
      window.setTimeout(() => {
        message.textContent = `The word was ${revealedAnswer}`;
      }, 650);
    }
    if (finished && currentUser) loadCurrentUser();
    saveGame();
  } catch (error) {
    showMessage(error.message);
    shakeRow();
  } finally {
    requestPending = false;
  }
}

function shakeRow() {
  const row = board.children[guesses.length];
  row.classList.remove("shake");
  void row.offsetWidth;
  row.classList.add("shake");
}

function handleKey(key) {
  if (finished || (requestPending && !gameInitializing)) return;
  if (key === "ENTER") {
    if (gameInitializing) {
      showMessage("Game is still loading");
      return;
    }
    submitGuess();
    return;
  }
  const nextInput = updateInputText(current, key);
  if (nextInput !== current) {
    const addedLetter = nextInput.length > current.length;
    current = nextInput;
    if (addedLetter) playLetterSound();
    updateCurrentRow();
    if (!gameInitializing) saveGame();
  }
}

document.addEventListener("keydown", (event) => {
  if (helpDialog.open || accountDialog.open || victoryDialog.open) return;
  const key = event.key.toUpperCase();
  if (key === "ENTER" || key === "BACKSPACE" || /^[A-Z]$/.test(key)) {
    event.preventDefault();
    handleKey(key);
  }
});

document.querySelector("#help-button").addEventListener("click", () => helpDialog.showModal());
document.querySelector("#help-dialog .close-button").addEventListener("click", () => helpDialog.close());
accountButton.addEventListener("click", () => {
  if (!currentUser) showAuthView("login");
  accountDialog.showModal();
});
accountCloseButton.addEventListener("click", () => accountDialog.close());
loginTab.addEventListener("click", () => showAuthView("login"));
registerTab.addEventListener("click", () => showAuthView("register"));
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAccountForm(loginForm, "login");
});
registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAccountForm(registerForm, "register");
});
logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await requestJson("/api/auth/logout", { method: "POST" });
    showSignedOutAccount();
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    logoutButton.disabled = false;
  }
});
logoutAllButton.addEventListener("click", async () => {
  logoutAllButton.disabled = true;
  authMessage.textContent = "Logging out every device…";
  try {
    await requestJson("/api/auth/logout-all", { method: "POST" });
    showSignedOutAccount();
    authMessage.textContent = "Every session has been logged out.";
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    logoutAllButton.disabled = false;
  }
});
changePasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = changePasswordForm.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(changePasswordForm));
  if (values.newPassword !== values.newPasswordConfirmation) {
    authMessage.textContent = "New passwords do not match";
    return;
  }
  submitButton.disabled = true;
  authMessage.textContent = "Changing password…";
  try {
    await requestJson("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify(values)
    });
    changePasswordForm.reset();
    authMessage.textContent = "Password changed. Other devices were logged out.";
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
deleteAccountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!window.confirm("Permanently delete this account, its games, and its statistics?")) return;
  const submitButton = deleteAccountForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  authMessage.textContent = "Deleting account…";
  try {
    await requestJson("/api/auth/account", {
      method: "DELETE",
      body: JSON.stringify(Object.fromEntries(new FormData(deleteAccountForm)))
    });
    deleteAccountForm.reset();
    showSignedOutAccount();
    authMessage.textContent = "Account deleted.";
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
document.querySelector("#reset-button").addEventListener("click", () => {
  const resetCountsAsLoss = guesses.length > 0 || hintsUsed > 0;
  if (
    !finished &&
    resetCountsAsLoss &&
    !window.confirm("Resetting this game will count as a loss. Start a new game?")
  ) {
    return;
  }
  startGame(true);
});
hardcoreButton.addEventListener("click", async () => {
  if (guesses.length > 0 || requestPending) return;
  const requestedMode = !hardcoreMode;
  requestPending = true;
  hardcoreButton.disabled = true;
  try {
    const payload = await requestGameJson(
      `/api/games/${encodeURIComponent(gameId)}/mode`,
      {
        method: "PUT",
        body: JSON.stringify({ hardcoreMode: requestedMode })
      }
    );
    applyServerGame(payload.game);
    saveGame();
  } catch (error) {
    showMessage(error.message);
  } finally {
    requestPending = false;
    updateHardcoreControl();
  }
});
document.querySelector("#current-year").textContent = new Date().getFullYear();
document.querySelector("#victory-reset-button").addEventListener("click", () => startGame(true));
document.querySelector("#victory-admire-button").addEventListener("click", () => victoryDialog.close());
backgroundFileInput.addEventListener("change", async () => {
  const [file] = backgroundFileInput.files;
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    backgroundStatus.textContent = "Please choose an image file";
    backgroundFileInput.value = "";
    return;
  }

  if (file.size > MAX_BACKGROUND_BYTES) {
    backgroundStatus.textContent = "Image must be 10 MB or smaller";
    backgroundFileInput.value = "";
    return;
  }

  backgroundStatus.textContent = "Saving background…";
  try {
    await saveBackground(file);
    applyBackground(file);
  } catch {
    backgroundStatus.textContent = "Could not save this background";
  } finally {
    backgroundFileInput.value = "";
  }
});
backgroundRemoveButton.addEventListener("click", async () => {
  backgroundRemoveButton.disabled = true;
  backgroundStatus.textContent = "Removing background…";
  try {
    await deleteSavedBackground();
    clearBackground();
  } catch {
    backgroundRemoveButton.disabled = false;
    backgroundStatus.textContent = "Could not remove this background";
  }
});
cameraButton.addEventListener("click", () => {
  if (cameraStream) {
    stopCamera();
  } else {
    startCamera();
  }
});
window.addEventListener("pagehide", () => {
  cameraStream?.getTracks().forEach((track) => track.stop());
  if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
});

async function initializeGame() {
  await loadCurrentUser();
  await startGame();
  startCamera();
  loadVictoryReactions();
  initializeBackground();
}

initializeGame();

if (__DEV_BUILD__) {
  import("./src/dev/debug-panel.js").then(({ mountDebugPanel }) => {
    mountDebugPanel({
      getState: () => ({
        gameId,
        guesses: [...guesses],
        guessResults: guessResults.map((result) => [...result]),
        current,
        finished,
        gameStatus,
        hardcoreMode,
        gameInitializing,
        allowAnyGuess
      }),
      revealAnswer: async () => {
        const payload = await requestGameJson(
          `/api/dev/games/${encodeURIComponent(gameId)}`
        );
        return payload.game.answer;
      },
      toggleAnyGuess: () => {
        allowAnyGuess = !allowAnyGuess;
        return allowAnyGuess;
      },
      resetDatabase: async () => {
        await requestJson("/api/dev/database/reset", {
          method: "POST",
          headers: { "x-wordle-dev-reset": "reset-entire-database" }
        });
        localStorage.removeItem(STORAGE_KEY);
        window.location.reload();
      }
    });
  });
}
