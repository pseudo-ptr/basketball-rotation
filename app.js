"use strict";

const STORAGE_KEY = "basketballPlayerRotationSessionV2";
const PLAYERS_PER_GAME = 10;
const PLAYERS_PER_TEAM = 5;
const TEAM_LABELS = ["A", "B"];
const MAX_UNDO_SNAPSHOTS = 10;
const FREQUENT_PLAYERS = [
  "邓子浩", "老鲁", "Dave", "Neil", "老肖", "Albert", "韩洋",
  "一达", "常哲", "王哥", "廖凡", "昊天", "赵"
];

function freshState(players = []) {
  return {
    version: 2,
    nextPlayerNumber: 1,
    players,
    selectedPlayerIds: [],
    assignments: { A: [], B: [] },
    phase: "assigning",
    scores: { A: 0, B: 0 },
    history: [],
    undoStack: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.version !== 2 || !Array.isArray(saved.players)) return null;

    return {
      ...freshState(),
      ...saved,
      players: saved.players.map((player, index) => ({
        id: player.id,
        name: player.name || `Player ${index + 1}`,
        points: Number(player.points) || 0,
        gamesPlayed: Number(player.gamesPlayed) || 0,
        waitStreak: Number(player.waitStreak) || 0,
        active: player.active !== false,
        rosterOrder: Number.isFinite(player.rosterOrder) ? player.rosterOrder : index
      })),
      selectedPlayerIds: Array.isArray(saved.selectedPlayerIds) ? saved.selectedPlayerIds : [],
      assignments: {
        A: Array.isArray(saved.assignments?.A) ? saved.assignments.A : [],
        B: Array.isArray(saved.assignments?.B) ? saved.assignments.B : []
      },
      scores: {
        A: Number(saved.scores?.A) || 0,
        B: Number(saved.scores?.B) || 0
      },
      history: Array.isArray(saved.history) ? saved.history : [],
      undoStack: Array.isArray(saved.undoStack) ? saved.undoStack : []
    };
  } catch (error) {
    console.warn("Could not restore the saved session.", error);
    return null;
  }
}

const restoredState = loadState();
let state = restoredState || freshState();
let setupRosterNames = [];

const elements = {
  sessionSummary: document.querySelector("#session-summary"),
  pageTitle: document.querySelector("#page-title"),
  message: document.querySelector("#app-message"),
  assignmentView: document.querySelector("#assignment-view"),
  nextPlayerList: document.querySelector("#next-player-list"),
  selectionHelp: document.querySelector("#selection-help"),
  assignmentCount: document.querySelector("#assignment-count"),
  teamAList: document.querySelector("#team-a-list"),
  teamBList: document.querySelector("#team-b-list"),
  teamACount: document.querySelector("#team-a-count"),
  teamBCount: document.querySelector("#team-b-count"),
  startGame: document.querySelector("#start-game"),
  gameView: document.querySelector("#game-view"),
  currentTeamA: document.querySelector("#current-team-a"),
  currentTeamB: document.querySelector("#current-team-b"),
  scoreboard: document.querySelector("#scoreboard"),
  finishGame: document.querySelector("#finish-game"),
  addPlayerForm: document.querySelector("#add-player-form"),
  newPlayerName: document.querySelector("#new-player-name"),
  newPlayerPoints: document.querySelector("#new-player-points"),
  medianHint: document.querySelector("#median-hint"),
  rosterLockNote: document.querySelector("#roster-lock-note"),
  rosterList: document.querySelector("#roster-list"),
  rosterCount: document.querySelector("#roster-count"),
  standingsBody: document.querySelector("#standings-body"),
  gameCount: document.querySelector("#game-count"),
  historyList: document.querySelector("#history-list"),
  emptyHistory: document.querySelector("#empty-history"),
  undoGame: document.querySelector("#undo-game"),
  newSession: document.querySelector("#new-session"),
  rosterSetup: document.querySelector("#roster-setup"),
  setupPlayerCount: document.querySelector("#setup-player-count"),
  setupTargetCount: document.querySelector("#setup-target-count"),
  setupSelectedCount: document.querySelector("#setup-selected-count"),
  setupRemainingCount: document.querySelector("#setup-remaining-count"),
  frequentPlayerChips: document.querySelector("#frequent-player-chips"),
  setupRosterList: document.querySelector("#setup-roster-list"),
  setupCustomName: document.querySelector("#setup-custom-name"),
  addSetupPlayer: document.querySelector("#add-setup-player"),
  fillRemainingRoster: document.querySelector("#fill-remaining-roster"),
  generateDefaultRoster: document.querySelector("#generate-default-roster"),
  create20Roster: document.querySelector("#create-20-roster"),
  setupMessage: document.querySelector("#setup-message"),
  createRoster: document.querySelector("#create-roster"),
  cancelRosterSetup: document.querySelector("#cancel-roster-setup"),
  newSessionDialog: document.querySelector("#new-session-dialog"),
  keepRoster: document.querySelector("#keep-roster"),
  replaceRoster: document.querySelector("#replace-roster"),
  cancelNewSession: document.querySelector("#cancel-new-session")
};

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save the session.", error);
    showMessage("Safari could not save this session. Check available storage.");
  }
}

function showMessage(text) {
  elements.message.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPoints(points) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

function getPlayer(playerId) {
  return state.players.find((player) => player.id === playerId);
}

function comparePriority(playerA, playerB) {
  return (
    playerB.points - playerA.points ||
    playerB.waitStreak - playerA.waitStreak ||
    playerA.gamesPlayed - playerB.gamesPlayed ||
    playerA.rosterOrder - playerB.rosterOrder
  );
}

function rankedActivePlayers() {
  return state.players.filter((player) => player.active).sort(comparePriority);
}

function medianActiveScore() {
  const scores = state.players
    .filter((player) => player.active)
    .map((player) => player.points)
    .sort((a, b) => a - b);
  if (!scores.length) return 0;
  const middle = Math.floor(scores.length / 2);
  return scores.length % 2 ? scores[middle] : (scores[middle - 1] + scores[middle]) / 2;
}

function waitingPoints(waitStreak) {
  return 15 + (waitStreak - 1) * 5;
}

function nextPlayerId() {
  const id = `player-${Date.now().toString(36)}-${state.nextPlayerNumber}`;
  state.nextPlayerNumber += 1;
  return id;
}

function addPlayerRecord(name, startingPoints) {
  const nextOrder = state.players.reduce(
    (highest, player) => Math.max(highest, player.rosterOrder),
    -1
  ) + 1;
  const player = {
    id: nextPlayerId(),
    name: name.trim(),
    points: startingPoints,
    gamesPlayed: 0,
    waitStreak: 0,
    active: true,
    rosterOrder: nextOrder
  };
  state.players.push(player);
  return player;
}

// Select only active players, using ranking points and every specified tie-break.
function refreshSelection(preserveAssignments = true) {
  state.selectedPlayerIds = rankedActivePlayers()
    .slice(0, PLAYERS_PER_GAME)
    .map((player) => player.id);

  const selectedIds = new Set(state.selectedPlayerIds);
  if (preserveAssignments) {
    state.assignments.A = state.assignments.A.filter((id) => selectedIds.has(id));
    state.assignments.B = state.assignments.B.filter((id) => selectedIds.has(id));
  } else {
    state.assignments = { A: [], B: [] };
  }
}

function assignmentFor(playerId) {
  if (state.assignments.A.includes(playerId)) return "A";
  if (state.assignments.B.includes(playerId)) return "B";
  return "";
}

function snapshotCurrentState() {
  const { undoStack, ...snapshot } = state;
  return JSON.stringify(snapshot);
}

function addUndoSnapshot() {
  state.undoStack.push(snapshotCurrentState());
  if (state.undoStack.length > MAX_UNDO_SNAPSHOTS) state.undoStack.shift();
}

function assignPlayer(playerId, team) {
  if (state.phase !== "assigning" || !state.selectedPlayerIds.includes(playerId)) return;
  const currentTeam = assignmentFor(playerId);

  if (currentTeam === team) {
    state.assignments[team] = state.assignments[team].filter((id) => id !== playerId);
  } else {
    if (state.assignments[team].length >= PLAYERS_PER_TEAM) {
      showMessage(`Team ${team} already has 5 players.`);
      return;
    }
    TEAM_LABELS.forEach((label) => {
      state.assignments[label] = state.assignments[label].filter((id) => id !== playerId);
    });
    state.assignments[team].push(playerId);
  }

  showMessage("");
  saveState();
  render();
}

function startGame() {
  const ready = state.selectedPlayerIds.length === PLAYERS_PER_GAME &&
    state.assignments.A.length === PLAYERS_PER_TEAM &&
    state.assignments.B.length === PLAYERS_PER_TEAM;
  if (!ready) {
    showMessage("Assign exactly 5 selected players to each team before starting.");
    return;
  }

  state.phase = "playing";
  state.scores = { A: 0, B: 0 };
  showMessage("Game started. Roster changes are locked until it is finished.");
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function adjustScore(team, amount) {
  if (state.phase !== "playing") return;
  state.scores[team] = Math.max(0, state.scores[team] + amount);
  showMessage("");
  saveState();
  renderScoreboard();
}

function playerNameSnapshot(playerId) {
  const player = getPlayer(playerId);
  return { playerId, name: player ? player.name : "Removed player" };
}

function finishGame() {
  if (state.phase !== "playing") return;
  const scoreA = state.scores.A;
  const scoreB = state.scores.B;
  if (scoreA === scoreB) {
    showMessage("A completed game must have a winner. Adjust the score first.");
    return;
  }

  addUndoSnapshot();
  const winner = scoreA > scoreB ? "A" : "B";
  const participantIds = new Set([...state.assignments.A, ...state.assignments.B]);

  state.players.forEach((player) => {
    if (!player.active) return;

    if (participantIds.has(player.id)) {
      const team = state.assignments.A.includes(player.id) ? "A" : "B";
      player.points += Math.min(state.scores[team], 6) + (team === winner ? 1 : 0);
      player.gamesPlayed += 1;
      player.waitStreak = 0;
    } else {
      player.waitStreak += 1;
      player.points += waitingPoints(player.waitStreak);
    }
  });

  state.history.push({
    id: `game-${Date.now().toString(36)}-${state.history.length + 1}`,
    number: state.history.length + 1,
    scoreA,
    scoreB,
    winner,
    teamA: state.assignments.A.map(playerNameSnapshot),
    teamB: state.assignments.B.map(playerNameSnapshot)
  });

  state.phase = "assigning";
  state.scores = { A: 0, B: 0 };
  refreshSelection(false);
  showMessage(`Game saved. Team ${winner} won ${scoreA}-${scoreB}.`);
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function undoLastGame() {
  if (state.phase === "playing" || state.undoStack.length === 0) return;
  const remainingSnapshots = state.undoStack.slice(0, -1);
  const restored = JSON.parse(state.undoStack[state.undoStack.length - 1]);
  state = { ...freshState(), ...restored, undoStack: remainingSnapshots };
  showMessage("Last game undone. Its teams and score are restored for editing.");
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function replaceRosterWithNames(names) {
  if (names.length < PLAYERS_PER_GAME) {
    elements.setupMessage.textContent = `Enter at least ${PLAYERS_PER_GAME} players. You currently have ${names.length}.`;
    return false;
  }

  if (state.players.length > 0) {
    const confirmed = window.confirm(
      `Replace the existing ${state.players.length}-player roster? Current scores and history will be reset.`
    );
    if (!confirmed) return false;
  }

  state = freshState();
  names.forEach((name) => addPlayerRecord(name, 0));
  refreshSelection(false);
  elements.rosterSetup.hidden = true;
  elements.setupMessage.textContent = "";
  showMessage(`Session started with ${names.length} active players.`);
  saveState();
  render();
  return true;
}

function targetPlayerCount() {
  const count = Number(elements.setupPlayerCount.value);
  return Number.isInteger(count) && count >= PLAYERS_PER_GAME ? count : 0;
}

function setupHasName(name, ignoredIndex = -1) {
  const normalizedName = name.trim().toLocaleLowerCase();
  return setupRosterNames.some(
    (existingName, index) => index !== ignoredIndex &&
      existingName.toLocaleLowerCase() === normalizedName
  );
}

function renderSetupRoster() {
  const target = targetPlayerCount();
  const selected = setupRosterNames.length;
  const remaining = target - selected;

  elements.setupTargetCount.textContent = target || "–";
  elements.setupSelectedCount.textContent = selected;
  elements.setupRemainingCount.textContent = target ? remaining : "–";

  elements.frequentPlayerChips.innerHTML = FREQUENT_PLAYERS.map((name) => {
    const isSelected = setupHasName(name);
    return `<button class="frequent-chip ${isSelected ? "selected" : ""}" type="button" data-frequent-name="${escapeHtml(name)}" aria-pressed="${isSelected}">${escapeHtml(name)}</button>`;
  }).join("");

  elements.setupRosterList.innerHTML = selected
    ? setupRosterNames.map((name, index) => `
        <li class="setup-roster-item">
          <input type="text" maxlength="40" value="${escapeHtml(name)}" data-setup-name-index="${index}" aria-label="Edit player ${index + 1}">
          <button class="setup-remove" type="button" data-remove-setup-index="${index}" aria-label="Remove ${escapeHtml(name)}">&times;</button>
        </li>`).join("")
    : '<li class="setup-roster-empty">No players selected yet.</li>';

  const remainingForButton = Math.max(0, remaining);
  elements.fillRemainingRoster.textContent =
    `Fill ${remainingForButton} Remaining Player${remainingForButton === 1 ? "" : "s"}`;
  elements.fillRemainingRoster.disabled = !target || remaining <= 0;
  elements.addSetupPlayer.disabled = !target || remaining <= 0;
  elements.createRoster.disabled = !target || selected !== target;
}

function addNameToSetup(name) {
  const cleanName = name.trim();
  const target = targetPlayerCount();
  if (!target) {
    elements.setupMessage.textContent = `Choose a whole-number target of at least ${PLAYERS_PER_GAME}.`;
    return false;
  }
  if (!cleanName) return false;
  if (setupRosterNames.length >= target) {
    elements.setupMessage.textContent = "The target roster is full. Increase Number of Players before adding more.";
    return false;
  }
  if (setupHasName(cleanName)) {
    elements.setupMessage.textContent = `${cleanName} is already in the roster.`;
    return false;
  }

  setupRosterNames.push(cleanName);
  elements.setupMessage.textContent = "";
  renderSetupRoster();
  return true;
}

function toggleFrequentPlayer(name) {
  const existingIndex = setupRosterNames.findIndex(
    (existingName) => existingName.toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  if (existingIndex >= 0) {
    setupRosterNames.splice(existingIndex, 1);
    elements.setupMessage.textContent = "";
    renderSetupRoster();
    return;
  }
  addNameToSetup(name);
}

function fillRemainingRoster() {
  const target = targetPlayerCount();
  if (!target) return;
  let placeholderNumber = 1;
  while (setupRosterNames.length < target) {
    const placeholder = `Player ${String(placeholderNumber).padStart(2, "0")}`;
    if (!setupHasName(placeholder)) setupRosterNames.push(placeholder);
    placeholderNumber += 1;
  }
  elements.setupMessage.textContent = "Remaining spots filled with default players.";
  renderSetupRoster();
}

function createInitialRoster() {
  const target = targetPlayerCount();
  if (!target || setupRosterNames.length !== target) {
    elements.setupMessage.textContent = "Fill every target roster spot before starting the session.";
    return;
  }
  if (replaceRosterWithNames([...setupRosterNames])) setupRosterNames = [];
}

function generateDefaultRoster(playerCount = targetPlayerCount()) {
  if (!Number.isInteger(playerCount) || playerCount < PLAYERS_PER_GAME) {
    elements.setupMessage.textContent = `Choose a whole number of at least ${PLAYERS_PER_GAME} players.`;
    return;
  }
  if (setupRosterNames.length > 0 && !window.confirm("Replace the names currently selected on this setup screen?")) return;

  elements.setupPlayerCount.value = String(playerCount);
  setupRosterNames = Array.from(
    { length: playerCount },
    (_, index) => `Player ${String(index + 1).padStart(2, "0")}`
  );
  elements.setupMessage.textContent = `${playerCount} default players are ready. Review or rename them, then start the session.`;
  renderSetupRoster();
}

function addPlayer(event) {
  event.preventDefault();
  if (state.phase === "playing") return;
  const name = elements.newPlayerName.value.trim();
  if (!name) return;

  const median = medianActiveScore();
  const override = elements.newPlayerPoints.value.trim();
  const startingPoints = override === "" ? median : Number(override);
  if (!Number.isFinite(startingPoints) || startingPoints < 0) {
    showMessage("Starting points must be zero or greater.");
    return;
  }

  const player = addPlayerRecord(name, startingPoints);
  refreshSelection(true);
  elements.addPlayerForm.reset();
  showMessage(
    override === ""
      ? `${player.name} added at the active-player median: ${formatPoints(startingPoints)} points.`
      : `${player.name} added with ${formatPoints(startingPoints)} starting points.`
  );
  saveState();
  render();
}

function manageRosterPlayer(playerId, action) {
  if (state.phase === "playing") {
    showMessage("Finish or undo the current game before changing the roster.");
    return;
  }
  const player = getPlayer(playerId);
  if (!player) return;

  if (action === "edit") {
    const updatedName = window.prompt("Edit player name or code:", player.name)?.trim();
    if (!updatedName) return;
    player.name = updatedName;
    showMessage(`Player renamed to ${updatedName}. Existing game history keeps its saved name.`);
  }

  if (action === "toggle") {
    player.active = !player.active;
    if (!player.active) player.waitStreak = 0;
    showMessage(`${player.name} is now ${player.active ? "active" : "inactive"}.`);
  }

  if (action === "remove") {
    const confirmed = window.confirm(
      `Remove ${player.name} from the roster? Completed game history will be preserved.`
    );
    if (!confirmed) return;
    state.players = state.players.filter((candidate) => candidate.id !== playerId);
    showMessage(`${player.name} removed. Completed game history was preserved.`);
  }

  refreshSelection(true);
  saveState();
  render();
}

function resetWithCurrentRoster() {
  const players = state.players.map((player) => ({
    ...player,
    points: 0,
    gamesPlayed: 0,
    waitStreak: 0
  }));
  const nextPlayerNumber = state.nextPlayerNumber;
  state = freshState(players);
  state.nextPlayerNumber = nextPlayerNumber;
  refreshSelection(false);
  elements.newSessionDialog.hidden = true;
  showMessage("New session started with the current roster. Player names were kept.");
  saveState();
  render();
}

function resetWithNewRoster() {
  elements.newSessionDialog.hidden = true;
  elements.setupPlayerCount.value = "20";
  setupRosterNames = [];
  elements.setupMessage.textContent = "";
  elements.cancelRosterSetup.hidden = false;
  elements.rosterSetup.hidden = false;
  renderSetupRoster();
  elements.setupPlayerCount.focus();
}

function renderTeamList(element, playerIds) {
  const names = playerIds.map((id) => getPlayer(id)?.name).filter(Boolean);
  element.innerHTML = names.length
    ? names.map((name) => `<li>${escapeHtml(name)}</li>`).join("")
    : '<li class="empty-slot">Unassigned</li>';
}

function renderAssignmentView() {
  const selectedPlayers = state.selectedPlayerIds.map(getPlayer).filter(Boolean);
  elements.nextPlayerList.innerHTML = selectedPlayers.map((player) => {
    const assignedTeam = assignmentFor(player.id);
    return `
      <li class="next-player">
        <span class="next-player-info">
          <span class="next-player-name">${escapeHtml(player.name)}</span>
          <span class="player-metrics">${formatPoints(player.points)} pts · ${player.gamesPlayed} played · ${player.waitStreak} waited</span>
        </span>
        <span class="assign-buttons" aria-label="Assign ${escapeHtml(player.name)}">
          <button class="assign-button ${assignedTeam === "A" ? "selected" : ""}" type="button" data-assign-id="${player.id}" data-team="A" aria-pressed="${assignedTeam === "A"}">A</button>
          <button class="assign-button ${assignedTeam === "B" ? "selected" : ""}" type="button" data-assign-id="${player.id}" data-team="B" aria-pressed="${assignedTeam === "B"}">B</button>
        </span>
      </li>`;
  }).join("");

  const activeCount = state.players.filter((player) => player.active).length;
  elements.selectionHelp.textContent = activeCount >= PLAYERS_PER_GAME
    ? "Assign every selected player: exactly 5 to Team A and 5 to Team B."
    : `Only ${activeCount} active player${activeCount === 1 ? " is" : "s are"} available. Add or reactivate players to reach 10.`;

  renderTeamList(elements.teamAList, state.assignments.A);
  renderTeamList(elements.teamBList, state.assignments.B);
  elements.teamACount.textContent = `${state.assignments.A.length}/5`;
  elements.teamBCount.textContent = `${state.assignments.B.length}/5`;
  elements.assignmentCount.textContent = `A: ${state.assignments.A.length}/5 · B: ${state.assignments.B.length}/5`;
  elements.startGame.disabled = selectedPlayers.length !== PLAYERS_PER_GAME ||
    state.assignments.A.length !== PLAYERS_PER_TEAM ||
    state.assignments.B.length !== PLAYERS_PER_TEAM;
}

function renderScoreboard() {
  elements.scoreboard.innerHTML = TEAM_LABELS.map((team) => `
    <article class="team-score">
      <h3 class="team-label">Team ${team}</h3>
      <output class="score" aria-label="Team ${team} score">${state.scores[team]}</output>
      <div class="score-controls">
        <button class="score-button" type="button" data-score-team="${team}" data-amount="1" aria-label="Add 1 to Team ${team}">+1</button>
        <button class="score-button" type="button" data-score-team="${team}" data-amount="2" aria-label="Add 2 to Team ${team}">+2</button>
        <button class="score-button minus" type="button" data-score-team="${team}" data-amount="-1" aria-label="Subtract 1 from Team ${team}">&minus;1</button>
      </div>
    </article>`).join("");
}

function renderGameView() {
  renderTeamList(elements.currentTeamA, state.assignments.A);
  renderTeamList(elements.currentTeamB, state.assignments.B);
  renderScoreboard();
}

function renderRoster() {
  const activeCount = state.players.filter((player) => player.active).length;
  elements.rosterCount.textContent = `${state.players.length} player${state.players.length === 1 ? "" : "s"}`;
  elements.medianHint.textContent = `(active median: ${formatPoints(medianActiveScore())})`;
  elements.rosterLockNote.textContent = state.phase === "playing"
    ? "Roster changes are locked during a live game."
    : "New players default to the median score of active players; enter a value to override it.";

  const controls = elements.addPlayerForm.querySelectorAll("input, button");
  controls.forEach((control) => { control.disabled = state.phase === "playing"; });

  elements.rosterList.innerHTML = [...state.players]
    .sort((a, b) => a.rosterOrder - b.rosterOrder)
    .map((player) => `
      <li class="roster-player ${player.active ? "" : "inactive"}">
        <span class="roster-name">
          ${escapeHtml(player.name)}
          <span class="player-metrics">${formatPoints(player.points)} pts · ${player.active ? "Active" : "Inactive"}</span>
        </span>
        <span class="roster-actions">
          <button class="small-button" type="button" data-roster-action="edit" data-player-id="${player.id}" ${state.phase === "playing" ? "disabled" : ""}>Edit</button>
          <button class="small-button" type="button" data-roster-action="toggle" data-player-id="${player.id}" ${state.phase === "playing" ? "disabled" : ""}>${player.active ? "Inactive" : "Activate"}</button>
          <button class="small-button remove" type="button" data-roster-action="remove" data-player-id="${player.id}" ${state.phase === "playing" ? "disabled" : ""}>Remove</button>
        </span>
      </li>`).join("");

  elements.sessionSummary.textContent = `${activeCount} active · ${state.players.length} total`;
}

function renderStandings() {
  const selectedIds = new Set(state.selectedPlayerIds);
  const players = [...state.players].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.active ? comparePriority(a, b) : a.rosterOrder - b.rosterOrder;
  });

  elements.standingsBody.innerHTML = players.map((player) => `
    <tr class="${selectedIds.has(player.id) ? "selected-row" : ""} ${player.active ? "" : "inactive-row"}">
      <td>${escapeHtml(player.name)}</td>
      <td>${formatPoints(player.points)}</td>
      <td>${player.gamesPlayed}</td>
      <td>${player.waitStreak}</td>
      <td class="${player.active ? "status-active" : ""}">${player.active ? "Active" : "Inactive"}</td>
    </tr>`).join("");

  const count = state.history.length;
  elements.gameCount.textContent = `${count} game${count === 1 ? "" : "s"}`;
}

function renderHistory() {
  elements.historyList.innerHTML = [...state.history].reverse().map((game) => `
    <details class="history-game">
      <summary>Game ${game.number}<span class="history-score">Team A ${game.scoreA}–${game.scoreB} Team B</span></summary>
      <div class="history-rosters">
        <div><h3>Team A</h3><ul>${game.teamA.map((player) => `<li>${escapeHtml(player.name)}</li>`).join("")}</ul></div>
        <div><h3>Team B</h3><ul>${game.teamB.map((player) => `<li>${escapeHtml(player.name)}</li>`).join("")}</ul></div>
      </div>
    </details>`).join("");
  elements.emptyHistory.hidden = state.history.length > 0;
  elements.undoGame.disabled = state.phase === "playing" || state.undoStack.length === 0;
}

function render() {
  const isPlaying = state.phase === "playing";
  elements.pageTitle.textContent = isPlaying ? "Current Game" : "Next 10 Players";
  elements.assignmentView.hidden = isPlaying;
  elements.gameView.hidden = !isPlaying;
  if (isPlaying) renderGameView();
  else renderAssignmentView();
  renderRoster();
  renderStandings();
  renderHistory();
}

elements.nextPlayerList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-assign-id]");
  if (button) assignPlayer(button.dataset.assignId, button.dataset.team);
});

elements.startGame.addEventListener("click", startGame);
elements.scoreboard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-score-team]");
  if (button) adjustScore(button.dataset.scoreTeam, Number(button.dataset.amount));
});
elements.finishGame.addEventListener("click", finishGame);
elements.undoGame.addEventListener("click", undoLastGame);
elements.addPlayerForm.addEventListener("submit", addPlayer);
elements.rosterList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-roster-action]");
  if (button) manageRosterPlayer(button.dataset.playerId, button.dataset.rosterAction);
});

elements.createRoster.addEventListener("click", createInitialRoster);
elements.generateDefaultRoster.addEventListener("click", () => generateDefaultRoster());
elements.create20Roster.addEventListener("click", () => generateDefaultRoster(20));
elements.setupPlayerCount.addEventListener("input", renderSetupRoster);
elements.setupPlayerCount.addEventListener("change", () => {
  const target = targetPlayerCount();
  if (target && target < setupRosterNames.length) {
    elements.setupPlayerCount.value = String(Math.max(PLAYERS_PER_GAME, setupRosterNames.length));
    elements.setupMessage.textContent = "Remove players before reducing the target below the current roster size.";
  }
  renderSetupRoster();
});
elements.frequentPlayerChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-frequent-name]");
  if (button) toggleFrequentPlayer(button.dataset.frequentName);
});
elements.setupRosterList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-setup-index]");
  if (!button) return;
  setupRosterNames.splice(Number(button.dataset.removeSetupIndex), 1);
  elements.setupMessage.textContent = "";
  renderSetupRoster();
});
elements.setupRosterList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-setup-name-index]");
  if (!input) return;
  const index = Number(input.dataset.setupNameIndex);
  const newName = input.value.trim();
  if (!newName) {
    elements.setupMessage.textContent = "Player names cannot be blank.";
    renderSetupRoster();
    return;
  }
  if (setupHasName(newName, index)) {
    elements.setupMessage.textContent = `${newName} is already in the roster.`;
    renderSetupRoster();
    return;
  }
  setupRosterNames[index] = newName;
  elements.setupMessage.textContent = "";
  renderSetupRoster();
});
function addCustomSetupPlayer() {
  if (addNameToSetup(elements.setupCustomName.value)) elements.setupCustomName.value = "";
}
elements.addSetupPlayer.addEventListener("click", addCustomSetupPlayer);
elements.setupCustomName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCustomSetupPlayer();
  }
});
elements.fillRemainingRoster.addEventListener("click", fillRemainingRoster);
elements.cancelRosterSetup.addEventListener("click", () => {
  setupRosterNames = [];
  elements.rosterSetup.hidden = true;
});
elements.newSession.addEventListener("click", () => {
  elements.newSessionDialog.hidden = false;
  elements.keepRoster.focus();
});
elements.keepRoster.addEventListener("click", resetWithCurrentRoster);
elements.replaceRoster.addEventListener("click", resetWithNewRoster);
elements.cancelNewSession.addEventListener("click", () => {
  elements.newSessionDialog.hidden = true;
});

if (state.phase === "assigning") refreshSelection(true);
render();
if (!restoredState || state.players.length === 0) {
  elements.cancelRosterSetup.hidden = true;
  elements.rosterSetup.hidden = false;
  renderSetupRoster();
  elements.setupPlayerCount.focus();
}
