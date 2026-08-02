const accountsBody = document.querySelector("#accounts-body");
const searchInput = document.querySelector("#account-search");
const dashboardStatus = document.querySelector("#dashboard-status");
const refreshButton = document.querySelector("#refresh-button");
const detailDialog = document.querySelector("#account-detail-dialog");
const detailTitle = document.querySelector("#detail-title");
const detailList = document.querySelector("#account-detail-list");
const detailGamesBody = document.querySelector("#detail-games-body");
const detailStatus = document.querySelector("#detail-status");

let users = [];

function formatDate(value) {
  if (!value) return "Never";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function requestJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function setCell(row, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = String(value);
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function updateSummary() {
  document.querySelector("#total-accounts").textContent = users.length.toLocaleString();
  document.querySelector("#total-sessions").textContent = users
    .reduce((total, user) => total + user.activeSessions, 0)
    .toLocaleString();
  document.querySelector("#total-games").textContent = users
    .reduce((total, user) => total + user.statistics.games, 0)
    .toLocaleString();
  document.querySelector("#total-wins").textContent = users
    .reduce((total, user) => total + user.statistics.wins, 0)
    .toLocaleString();
  document.querySelector("#total-games-no-hints").textContent = users
    .reduce((total, user) => total + user.statistics.gamesNoHints, 0)
    .toLocaleString();
  document.querySelector("#total-wins-no-hints").textContent = users
    .reduce((total, user) => total + user.statistics.winsNoHints, 0)
    .toLocaleString();
}

function renderUsers() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = users.filter((user) =>
    user.username.toLowerCase().includes(query) || user.id.toLowerCase().includes(query)
  );
  accountsBody.replaceChildren();

  filtered.forEach((user) => {
    const row = document.createElement("tr");
    setCell(row, user.username, "username-cell");
    setCell(row, user.id, "id-cell");
    setCell(row, formatDate(user.createdAt));
    setCell(row, user.activeSessions);
    setCell(row, user.statistics.games);
    setCell(row, user.statistics.wins);
    setCell(row, user.statistics.gamesNoHints);
    setCell(row, user.statistics.winsNoHints);
    setCell(row, user.losses);
    setCell(row, formatDate(user.lastGameAt));
    const actionCell = document.createElement("td");
    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "view-account-button";
    detailButton.dataset.userId = user.id;
    detailButton.textContent = "View";
    detailButton.setAttribute("aria-label", `View ${user.username}`);
    actionCell.appendChild(detailButton);
    row.appendChild(actionCell);
    accountsBody.appendChild(row);
  });

  dashboardStatus.textContent = users.length === 0
    ? "No accounts in the local development database."
    : `Showing ${filtered.length} of ${users.length} accounts.`;
}

async function loadUsers() {
  refreshButton.disabled = true;
  dashboardStatus.textContent = "Loading accounts…";
  try {
    const payload = await requestJson("/api/dev/users");
    users = payload.users;
    updateSummary();
    renderUsers();
  } catch (error) {
    dashboardStatus.textContent = `Could not load accounts: ${error.message}`;
  } finally {
    refreshButton.disabled = false;
  }
}

function addDetail(label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = String(value);
  detailList.append(term, description);
}

async function showAccount(userId) {
  detailList.replaceChildren();
  detailGamesBody.replaceChildren();
  detailTitle.textContent = "Loading account…";
  detailStatus.textContent = "Loading game history…";
  detailDialog.showModal();
  try {
    const payload = await requestJson(`/api/dev/users/${encodeURIComponent(userId)}`);
    detailTitle.textContent = payload.user.username;
    addDetail("Account ID", payload.user.id);
    addDetail("Created", formatDate(payload.user.createdAt));
    addDetail("Active sessions", payload.user.activeSessions);
    addDetail("Games", payload.user.statistics.games);
    addDetail("Wins", payload.user.statistics.wins);
    addDetail("Win rate", `${payload.user.statistics.winRate}%`);
    addDetail("Games (no hints)", payload.user.statistics.gamesNoHints);
    addDetail("Wins (no hints)", payload.user.statistics.winsNoHints);
    addDetail("Win rate (no hints)", `${payload.user.statistics.winRateNoHints}%`);
    payload.user.statistics.guessDistribution.forEach((wins, index) => {
      addDetail(`Wins in ${index + 1}`, wins);
    });

    payload.games.forEach((game) => {
      const row = document.createElement("tr");
      setCell(row, game.id, "id-cell");
      setCell(row, game.status);
      setCell(row, game.guesses);
      setCell(row, game.hintsUsed);
      setCell(row, game.countsTowardStatistics ? "Yes" : "No");
      setCell(row, game.hardcoreMode ? "Yes" : "No");
      setCell(row, formatDate(game.createdAt));
      detailGamesBody.appendChild(row);
    });
    detailStatus.textContent = payload.games.length
      ? `Showing ${payload.games.length} most recent games.`
      : "This account has no games yet.";
  } catch (error) {
    detailTitle.textContent = "Account unavailable";
    detailStatus.textContent = error.message;
  }
}

searchInput.addEventListener("input", renderUsers);
refreshButton.addEventListener("click", loadUsers);
accountsBody.addEventListener("click", (event) => {
  const userId = event.target.closest("[data-user-id]")?.dataset.userId;
  if (userId) showAccount(userId);
});
document.querySelector("#detail-close").addEventListener("click", () => detailDialog.close());

loadUsers();
