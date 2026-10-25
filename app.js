"use strict";

const STORAGE_KEY = "basketballPlayerRotationSessionV2";
const PLAYERS_PER_GAME = 10;
const PLAYERS_PER_TEAM = 5;
const TEAM_LABELS = ["A", "B"];
const MAX_UNDO_SNAPSHOTS = 10;
const GAME_DURATION_SECONDS = 10 * 60;
const GAME_DURATION_MS = GAME_DURATION_SECONDS * 1000;
const FREQUENT_PLAYERS = [
  "Eddie Chang", "Leo Chang", "Sam Chang", "Zihao Deng", "Min Fang",
  "Zhijian Fei", "Yanjun Gan", "Yang Han", "Albert Huang", "Haiqin Li",
  "George Lin", "Liaofan Lin", "Xifeng Lu", "Chong Shen", "Max Siewert",
  "Weijun Tan", "Bryan Wallace", "Guorong Wang", "Qi Wang", "Sean Wang",
  "Chuanwei Wu", "Jianliang Xiao", "Eric Zhang", "Haotian Zhang",
  "Yida Zhang", "Joey Zhao"
];

function freshState(players = []) {
  return {
    version: 2,
    nextPlayerNumber: 1,
    players,
    recommendedPlayerIds: [],
    selectedPlayerIds: [],
    selectionConfirmed: false,
    swapOutPlayerId: null,
    pendingYieldMemberId: null,
    proxyYields: [],
    assignments: { A: [], B: [] },
    phase: "assigning",
    scores: { A: 0, B: 0 },
    gameStartedAt: null,
    gameEndsAt: null,
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

    const validPhases = new Set(["assigning", "playing", "awaitingScore"]);
    const phase = validPhases.has(saved.phase) ? saved.phase : "assigning";
    let gameStartedAt = Number.isFinite(saved.gameStartedAt) ? saved.gameStartedAt : null;
    let gameEndsAt = Number.isFinite(saved.gameEndsAt) ? saved.gameEndsAt : null;

    // A pre-timer saved live game cannot have a trustworthy elapsed time. Give
    // that one legacy game a fresh full clock instead of losing its lineup.
    if (phase === "playing" && (!gameStartedAt || !gameEndsAt)) {
      gameStartedAt = Date.now();
      gameEndsAt = gameStartedAt + GAME_DURATION_MS;
    }
    if (phase === "assigning") {
      gameStartedAt = null;
      gameEndsAt = null;
    }

    return {
      ...freshState(),
      ...saved,
      phase,
      gameStartedAt,
      gameEndsAt,
      players: saved.players.map((player, index) => {
        const name = player.name || `Player ${index + 1}`;
        const presetName = canonicalPresetName(name) ||
          canonicalPresetName(typeof player.presetName === "string" ? player.presetName : "");
        const gamesPlayed = Number(player.gamesPlayed) || 0;
        const savedIsMember = typeof player.isMember === "boolean"
          ? player.isMember
          : Boolean(presetName);
        const isMember = Boolean(presetName) || savedIsMember;
        return {
          id: player.id,
          name,
          points: Number(player.points) || 0,
          gamesPlayed,
          waitStreak: Number(player.waitStreak) || 0,
          active: player.active !== false,
          rosterOrder: Number.isFinite(player.rosterOrder) ? player.rosterOrder : index,
          presetName: presetName || null,
          isMember,
          limitReached: !isMember && (player.limitReached === true || gamesPlayed >= 2),
          skipCurrentGame: player.skipCurrentGame === true
        };
      }),
      recommendedPlayerIds: Array.isArray(saved.recommendedPlayerIds) ? saved.recommendedPlayerIds : [],
      selectedPlayerIds: Array.isArray(saved.selectedPlayerIds) ? saved.selectedPlayerIds : [],
      selectionConfirmed: saved.selectionConfirmed === true,
      swapOutPlayerId: typeof saved.swapOutPlayerId === "string" ? saved.swapOutPlayerId : null,
      pendingYieldMemberId: typeof saved.pendingYieldMemberId === "string" ? saved.pendingYieldMemberId : null,
      proxyYields: Array.isArray(saved.proxyYields)
        ? saved.proxyYields
          .map((relationship) => ({
            yieldedByMemberId: relationship.yieldedByMemberId || relationship.memberId,
            proxyPlayerId: relationship.proxyPlayerId
          }))
          .filter((relationship) =>
            typeof relationship.yieldedByMemberId === "string" &&
            typeof relationship.proxyPlayerId === "string")
        : [],
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
let setupRosterEntries = [];
let timerIntervalId = null;

const elements = {
  sessionSummary: document.querySelector("#session-summary"),
  pageTitle: document.querySelector("#page-title"),
  message: document.querySelector("#app-message"),
  assignmentView: document.querySelector("#assignment-view"),
  nextPlayerList: document.querySelector("#next-player-list"),
  selectionHelp: document.querySelector("#selection-help"),
  selectionLabel: document.querySelector("#selection-label"),
  swapInstruction: document.querySelector("#swap-instruction"),
  waitingPlayersSection: document.querySelector("#waiting-players-section"),
  waitingPlayerList: document.querySelector("#waiting-player-list"),
  confirmSelection: document.querySelector("#confirm-selection"),
  changeSelection: document.querySelector("#change-selection"),
  teamAssignmentPanel: document.querySelector("#team-assignment-panel"),
  assignmentCount: document.querySelector("#assignment-count"),
  teamAList: document.querySelector("#team-a-list"),
  teamBList: document.querySelector("#team-b-list"),
  teamACount: document.querySelector("#team-a-count"),
  teamBCount: document.querySelector("#team-b-count"),
  startGame: document.querySelector("#start-game"),
  gameView: document.querySelector("#game-view"),
  currentTeamA: document.querySelector("#current-team-a"),
  currentTeamB: document.querySelector("#current-team-b"),
  gameClock: document.querySelector("#game-clock"),
  gameTimer: document.querySelector("#game-timer"),
  timerStatus: document.querySelector("#timer-status"),
  scoreboard: document.querySelector("#scoreboard"),
  finalScorePanel: document.querySelector("#final-score-panel"),
  finalScoreA: document.querySelector("#final-score-a"),
  finalScoreB: document.querySelector("#final-score-b"),
  finishGame: document.querySelector("#finish-game"),
  openAddPlayer: document.querySelector("#open-add-player"),
  addPlayerDialog: document.querySelector("#add-player-dialog"),
  addPlayerTimingNote: document.querySelector("#add-player-timing-note"),
  sessionPresetChips: document.querySelector("#session-preset-chips"),
  noSessionPresets: document.querySelector("#no-session-presets"),
  sessionInactiveList: document.querySelector("#session-inactive-list"),
  noSessionInactive: document.querySelector("#no-session-inactive"),
  sessionPlayerName: document.querySelector("#session-player-name"),
  sessionPlayerPoints: document.querySelector("#session-player-points"),
  sessionPlayerMembership: document.querySelector("#session-player-membership"),
  sessionMedianHint: document.querySelector("#session-median-hint"),
  addSessionPlayer: document.querySelector("#add-session-player"),
  addPlayerDialogMessage: document.querySelector("#add-player-dialog-message"),
  closeAddPlayer: document.querySelector("#close-add-player"),
  rosterLockNote: document.querySelector("#roster-lock-note"),
  activePlayerList: document.querySelector("#active-player-list"),
  inactivePlayerList: document.querySelector("#inactive-player-list"),
  activePlayerCount: document.querySelector("#active-player-count"),
  inactivePlayerCount: document.querySelector("#inactive-player-count"),
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
  setupPlayerMembership: document.querySelector("#setup-player-membership"),
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

function normalizedName(name) {
  return String(name).trim().toLocaleLowerCase();
}

function canonicalPresetName(name) {
  const normalized = normalizedName(name);
  return FREQUENT_PLAYERS.find((preset) => normalizedName(preset) === normalized) || null;
}

function playerForDisplayName(name) {
  const normalized = normalizedName(name);
  return state.players.find((player) => normalizedName(player.name) === normalized);
}

function playerForPreset(presetName) {
  const normalized = normalizedName(presetName);
  return state.players.find((player) =>
    normalizedName(player.presetName || player.name) === normalized
  );
}

function isRotationEligible(player) {
  return player.active && !player.limitReached;
}

function isLimitReachedFallback(player) {
  return player.active && !player.isMember && player.limitReached;
}

function membershipText(player) {
  if (player.isMember) return "MEMBER";
  const gameCount = Number(player.gamesPlayed) || 0;
  return `NON-MEMBER · ${gameCount}/2${player.limitReached ? " · LIMIT REACHED" : ""}`;
}

function membershipBadge(player) {
  const className = player.isMember ? "member" : player.limitReached ? "limit-reached" : "non-member";
  return `<span class="membership-badge ${className}">${membershipText(player)}</span>`;
}

function comparePriority(playerA, playerB) {
  return (
    playerB.points - playerA.points ||
    playerB.waitStreak - playerA.waitStreak ||
    playerA.gamesPlayed - playerB.gamesPlayed ||
    playerA.rosterOrder - playerB.rosterOrder
  );
}

function compareFallbackPriority(playerA, playerB) {
  const extraGamesA = Math.max(playerA.gamesPlayed - 2, 0);
  const extraGamesB = Math.max(playerB.gamesPlayed - 2, 0);
  return (
    extraGamesA - extraGamesB ||
    playerB.waitStreak - playerA.waitStreak ||
    playerA.rosterOrder - playerB.rosterOrder
  );
}

function rankedActivePlayers() {
  const normallyEligible = state.players.filter(isRotationEligible).sort(comparePriority);
  if (normallyEligible.length >= PLAYERS_PER_GAME) return normallyEligible;

  // Limit-Reached Non-Members enter the pool only during a roster shortage.
  // Their frozen ranking score is deliberately excluded from fallback order.
  const fallbackPlayers = state.players.filter(isLimitReachedFallback).sort(compareFallbackPriority);
  return [...normallyEligible, ...fallbackPlayers];
}

function allBenchCandidatePlayers() {
  const normallyEligible = state.players.filter(isRotationEligible).sort(comparePriority);
  const limitReached = state.players.filter(isLimitReachedFallback).sort(compareFallbackPriority);
  return [...normallyEligible, ...limitReached];
}

function proxyYieldForProxy(playerId) {
  return state.proxyYields.find((relationship) => relationship.proxyPlayerId === playerId) || null;
}

function proxyYieldForMember(playerId) {
  return state.proxyYields.find((relationship) => relationship.yieldedByMemberId === playerId) || null;
}

function baseSelectionMeetsEligibilityRules(playerIds) {
  if (playerIds.length !== PLAYERS_PER_GAME || new Set(playerIds).size !== PLAYERS_PER_GAME) return false;

  const selectedPlayers = playerIds.map(getPlayer);
  if (selectedPlayers.some((player) => !player || !player.active)) return false;

  const normallyEligibleCount = state.players.filter(isRotationEligible).length;
  const requiredNormallyEligible = Math.min(normallyEligibleCount, PLAYERS_PER_GAME);
  const selectedNormallyEligible = selectedPlayers.filter(isRotationEligible).length;
  const fallbackAllowed = normallyEligibleCount < PLAYERS_PER_GAME;

  return selectedNormallyEligible === requiredNormallyEligible &&
    selectedPlayers.every((player) => isRotationEligible(player) ||
      (fallbackAllowed && isLimitReachedFallback(player)));
}

function selectionMeetsEligibilityRules(playerIds = state.selectedPlayerIds) {
  if (playerIds.length !== PLAYERS_PER_GAME || new Set(playerIds).size !== PLAYERS_PER_GAME) return false;

  const physicalIds = new Set(playerIds);
  const yieldedMemberIds = new Set();
  const proxyPlayerIds = new Set();
  for (const relationship of state.proxyYields) {
    const member = getPlayer(relationship.yieldedByMemberId);
    const proxy = getPlayer(relationship.proxyPlayerId);
    if (!member?.active || !member.isMember || !proxy || !isLimitReachedFallback(proxy) ||
        !physicalIds.has(proxy.id) || physicalIds.has(member.id) ||
        yieldedMemberIds.has(member.id) || proxyPlayerIds.has(proxy.id)) {
      return false;
    }
    yieldedMemberIds.add(member.id);
    proxyPlayerIds.add(proxy.id);
  }

  const creditedSlotIds = playerIds.map((playerId) =>
    proxyYieldForProxy(playerId)?.yieldedByMemberId || playerId
  );
  return baseSelectionMeetsEligibilityRules(creditedSlotIds);
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

function addPlayerRecord(name, startingPoints, options = {}) {
  const nextOrder = state.players.reduce(
    (highest, player) => Math.max(highest, player.rosterOrder),
    -1
  ) + 1;
  const presetName = options.presetName || canonicalPresetName(name);
  const isMember = Boolean(presetName) || options.isMember === true;
  const player = {
    id: nextPlayerId(),
    name: name.trim(),
    points: startingPoints,
    gamesPlayed: 0,
    waitStreak: 0,
    active: true,
    rosterOrder: nextOrder,
    presetName: presetName || null,
    isMember,
    limitReached: !isMember && options.limitReached === true,
    skipCurrentGame: options.skipCurrentGame === true
  };
  state.players.push(player);
  return player;
}

function pruneProxyYields() {
  const selectedIds = new Set(state.selectedPlayerIds);
  state.proxyYields = state.proxyYields.filter((relationship) => {
    const member = getPlayer(relationship.yieldedByMemberId);
    const proxy = getPlayer(relationship.proxyPlayerId);
    return member?.active && member.isMember && isLimitReachedFallback(proxy) &&
      selectedIds.has(proxy.id) && !selectedIds.has(member.id);
  });

  const pendingMember = getPlayer(state.pendingYieldMemberId);
  if (!pendingMember?.active || !pendingMember.isMember ||
      !selectedIds.has(pendingMember.id) || state.selectionConfirmed) {
    state.pendingYieldMemberId = null;
  }
}

// Reconcile the physical selection with the active roster. Manual swaps and
// explicit Member Yield relationships survive normal roster refreshes.
function refreshSelection(preserveAssignments = true, resetToRecommendation = false) {
  if (resetToRecommendation) {
    state.proxyYields = [];
    state.pendingYieldMemberId = null;
  } else {
    pruneProxyYields();
  }
  const rankedIds = rankedActivePlayers().map((player) => player.id);
  const previousSelection = [...state.selectedPlayerIds];
  state.recommendedPlayerIds = rankedIds.slice(0, PLAYERS_PER_GAME);

  if (resetToRecommendation || state.selectedPlayerIds.length === 0) {
    state.selectedPlayerIds = [...state.recommendedPlayerIds];
    state.selectionConfirmed = false;
    state.swapOutPlayerId = null;
  } else {
    const activeIds = new Set([
      ...rankedIds,
      ...state.proxyYields.map((relationship) => relationship.proxyPlayerId)
    ]);
    state.selectedPlayerIds = [...new Set(state.selectedPlayerIds)]
      .filter((playerId) => activeIds.has(playerId))
      .slice(0, PLAYERS_PER_GAME);
    rankedIds.forEach((playerId) => {
      if (state.selectedPlayerIds.length < PLAYERS_PER_GAME && !state.selectedPlayerIds.includes(playerId)) {
        state.selectedPlayerIds.push(playerId);
      }
    });
    if (!state.selectedPlayerIds.includes(state.swapOutPlayerId)) state.swapOutPlayerId = null;
    const selectionChanged = previousSelection.length !== state.selectedPlayerIds.length ||
      previousSelection.some((playerId, index) => playerId !== state.selectedPlayerIds[index]);
    if (selectionChanged || state.selectedPlayerIds.length !== PLAYERS_PER_GAME) {
      state.selectionConfirmed = false;
    }
    if (state.selectedPlayerIds.length === PLAYERS_PER_GAME && !selectionMeetsEligibilityRules()) {
      state.selectedPlayerIds = [...state.recommendedPlayerIds];
      state.selectionConfirmed = false;
      state.swapOutPlayerId = null;
    }
  }
  pruneProxyYields();

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

function chooseSwapOut(playerId) {
  if (state.phase !== "assigning" || state.selectionConfirmed ||
      !state.selectedPlayerIds.includes(playerId) || proxyYieldForProxy(playerId)) return;
  state.pendingYieldMemberId = null;
  state.swapOutPlayerId = state.swapOutPlayerId === playerId ? null : playerId;
  showMessage(state.swapOutPlayerId ? "Now choose a Waiting / Bench player to swap in." : "Swap cancelled.");
  saveState();
  render();
}

function swapInPlayer(playerId) {
  if (state.phase !== "assigning" || state.selectionConfirmed) return;
  if (!state.swapOutPlayerId) {
    showMessage("Tap Swap beside a selected player first.");
    return;
  }
  const incomingPlayer = getPlayer(playerId);
  const outgoingId = state.swapOutPlayerId;
  const outgoingPlayer = getPlayer(outgoingId);
  const candidateIds = new Set(rankedActivePlayers().map((player) => player.id));
  if (!incomingPlayer || !candidateIds.has(playerId) || state.selectedPlayerIds.includes(playerId) ||
      proxyYieldForMember(playerId)) return;
  if (incomingPlayer.limitReached && !outgoingPlayer?.limitReached) {
    showMessage("A fallback Non-Member cannot replace a normally eligible player.");
    return;
  }

  const selectedIndex = state.selectedPlayerIds.indexOf(outgoingId);
  if (selectedIndex < 0) return;
  state.selectedPlayerIds[selectedIndex] = playerId;
  TEAM_LABELS.forEach((team) => {
    state.assignments[team] = state.assignments[team].filter((id) => id !== outgoingId);
  });
  state.swapOutPlayerId = null;
  state.pendingYieldMemberId = null;
  state.selectionConfirmed = false;
  showMessage(`${incomingPlayer.name} swapped in; ${outgoingPlayer?.name || "the selected player"} moved to Waiting / Bench.`);
  saveState();
  render();
}

function chooseMemberYield(playerId) {
  const member = getPlayer(playerId);
  if (state.phase !== "assigning" || state.selectionConfirmed || !member?.active ||
      !member.isMember || !state.selectedPlayerIds.includes(playerId)) return;

  state.swapOutPlayerId = null;
  state.pendingYieldMemberId = state.pendingYieldMemberId === playerId ? null : playerId;
  showMessage(state.pendingYieldMemberId
    ? `Choose the Limit-Reached Non-Member who will physically play for ${member.name}.`
    : "Member Yield cancelled.");
  saveState();
  render();
}

function giveMemberSpotTo(proxyPlayerId) {
  if (state.phase !== "assigning" || state.selectionConfirmed || !state.pendingYieldMemberId) return;
  const member = getPlayer(state.pendingYieldMemberId);
  const proxy = getPlayer(proxyPlayerId);
  const selectedIndex = state.selectedPlayerIds.indexOf(member?.id);
  if (!member?.active || !member.isMember || selectedIndex < 0 ||
      !isLimitReachedFallback(proxy) || state.selectedPlayerIds.includes(proxyPlayerId)) return;

  state.selectedPlayerIds[selectedIndex] = proxyPlayerId;
  state.proxyYields = state.proxyYields.filter((relationship) =>
    relationship.yieldedByMemberId !== member.id && relationship.proxyPlayerId !== proxyPlayerId
  );
  state.proxyYields.push({ yieldedByMemberId: member.id, proxyPlayerId });
  TEAM_LABELS.forEach((team) => {
    state.assignments[team] = state.assignments[team].filter((id) => id !== member.id);
  });
  state.pendingYieldMemberId = null;
  state.swapOutPlayerId = null;
  showMessage(`${member.name} gives this game's spot to ${proxy.name}.`);
  saveState();
  render();
}

function undoMemberYield(proxyPlayerId) {
  if (state.phase !== "assigning" || state.selectionConfirmed) return;
  const relationship = proxyYieldForProxy(proxyPlayerId);
  const member = getPlayer(relationship?.yieldedByMemberId);
  const selectedIndex = state.selectedPlayerIds.indexOf(proxyPlayerId);
  if (!relationship || !member?.active || selectedIndex < 0 || state.selectedPlayerIds.includes(member.id)) return;

  state.selectedPlayerIds[selectedIndex] = member.id;
  state.proxyYields = state.proxyYields.filter((candidate) => candidate !== relationship);
  TEAM_LABELS.forEach((team) => {
    state.assignments[team] = state.assignments[team].filter((id) => id !== proxyPlayerId);
  });
  state.pendingYieldMemberId = null;
  showMessage(`${member.name}'s Member Yield was cancelled.`);
  saveState();
  render();
}

function confirmFinalSelection() {
  if (!selectionMeetsEligibilityRules()) {
    showMessage("Select all normally eligible players first, using Limit-Reached Non-Members only when needed to reach 10.");
    return;
  }
  state.selectionConfirmed = true;
  state.swapOutPlayerId = null;
  state.pendingYieldMemberId = null;
  showMessage("Final 10 confirmed. Assign 5 players to either team; the rest can be filled automatically.");
  saveState();
  render();
}

function changeFinalSelection() {
  if (state.phase !== "assigning") return;
  state.selectionConfirmed = false;
  state.pendingYieldMemberId = null;
  showMessage("You can swap selected and waiting players again.");
  saveState();
  render();
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
  if (state.phase !== "assigning" || !state.selectionConfirmed ||
      !state.selectedPlayerIds.includes(playerId)) return;
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

// Starting is allowed as soon as one side has five players. Any selected
// players still unassigned can then fill the opposite side automatically.
function teamAssignmentsCanBeCompleted() {
  if (!state.selectionConfirmed || !selectionMeetsEligibilityRules()) return false;

  const selectedIds = new Set(state.selectedPlayerIds);
  if (selectedIds.size !== PLAYERS_PER_GAME) return false;
  const teamAIds = new Set(state.assignments.A);
  const teamBIds = new Set(state.assignments.B);
  const allAssignmentsAreValid =
    teamAIds.size === state.assignments.A.length &&
    teamBIds.size === state.assignments.B.length &&
    [...teamAIds].every((playerId) => selectedIds.has(playerId) && !teamBIds.has(playerId)) &&
    [...teamBIds].every((playerId) => selectedIds.has(playerId));

  if (!allAssignmentsAreValid || teamAIds.size > PLAYERS_PER_TEAM || teamBIds.size > PLAYERS_PER_TEAM) {
    return false;
  }

  return teamAIds.size === PLAYERS_PER_TEAM || teamBIds.size === PLAYERS_PER_TEAM;
}

function completeTeamAssignments() {
  if (!teamAssignmentsCanBeCompleted()) return false;

  const assignedIds = new Set([...state.assignments.A, ...state.assignments.B]);
  const unassignedIds = state.selectedPlayerIds.filter((playerId) => !assignedIds.has(playerId));
  if (state.assignments.A.length < PLAYERS_PER_TEAM) state.assignments.A.push(...unassignedIds);
  else if (state.assignments.B.length < PLAYERS_PER_TEAM) state.assignments.B.push(...unassignedIds);

  return state.assignments.A.length === PLAYERS_PER_TEAM &&
    state.assignments.B.length === PLAYERS_PER_TEAM;
}

function hasCurrentGame(stateToCheck = state) {
  return stateToCheck.phase === "playing" || stateToCheck.phase === "awaitingScore";
}

function stopGameTimerLoop() {
  if (timerIntervalId !== null) {
    window.clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

function remainingGameSeconds() {
  if (state.phase === "awaitingScore") return 0;
  if (state.phase !== "playing" || !Number.isFinite(state.gameEndsAt)) return GAME_DURATION_SECONDS;
  return Math.max(0, Math.ceil((state.gameEndsAt - Date.now()) / 1000));
}

function renderGameTimer() {
  const secondsRemaining = remainingGameSeconds();
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  elements.gameTimer.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
  elements.gameClock.classList.toggle("warning", secondsRemaining > 30 && secondsRemaining <= 120);
  elements.gameClock.classList.toggle("urgent", secondsRemaining > 0 && secondsRemaining <= 30);
  elements.gameClock.classList.toggle("expired", state.phase === "awaitingScore");
  elements.timerStatus.textContent = state.phase === "awaitingScore" ? "TIME'S UP" : "";
}

// The clock always derives from the persisted end timestamp. This remains
// accurate after Safari throttles timers, the phone locks, or the page reloads.
function syncGameTimer() {
  if (state.phase !== "playing") {
    stopGameTimerLoop();
    renderGameTimer();
    return;
  }

  if (!Number.isFinite(state.gameEndsAt) || Date.now() >= state.gameEndsAt) {
    state.phase = "awaitingScore";
    stopGameTimerLoop();
    saveState();
    showMessage("TIME'S UP. Confirm the final score, then finish and save the game.");
    render();
    return;
  }

  renderGameTimer();
}

function startGameTimerLoop() {
  stopGameTimerLoop();
  syncGameTimer();
  if (state.phase === "playing") {
    timerIntervalId = window.setInterval(syncGameTimer, 250);
  }
}

function startGame() {
  if (state.phase !== "assigning") return;
  if (!completeTeamAssignments()) {
    showMessage("Confirm the final 10, then assign at least one complete 5-player team before starting.");
    return;
  }

  state.phase = "playing";
  state.scores = { A: 0, B: 0 };
  state.gameStartedAt = Date.now();
  state.gameEndsAt = state.gameStartedAt + GAME_DURATION_MS;
  showMessage("10:00 game started. Late arrivals can be added to the waiting bench.");
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function adjustScore(team, amount) {
  if (state.phase !== "playing") return;
  syncGameTimer();
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
  if (state.phase !== "awaitingScore") return;
  const scoreA = Number(elements.finalScoreA.value);
  const scoreB = Number(elements.finalScoreB.value);
  if (!Number.isInteger(scoreA) || scoreA < 0 || !Number.isInteger(scoreB) || scoreB < 0) {
    showMessage("Final scores must be whole numbers of zero or greater.");
    return;
  }

  state.scores = { A: scoreA, B: scoreB };
  addUndoSnapshot();
  const winner = scoreA === scoreB ? null : scoreA > scoreB ? "A" : "B";
  const participantIds = new Set([...state.assignments.A, ...state.assignments.B]);
  const proxyCreditByMemberId = new Map(state.proxyYields.map((relationship) => [
    relationship.yieldedByMemberId,
    state.assignments.A.includes(relationship.proxyPlayerId) ? "A" : "B"
  ]));

  state.players.forEach((player) => {
    if (!player.active) return;
    const participated = participantIds.has(player.id);

    // A player added or reactivated after this game began enters the ranking
    // cycle after it ends. They get neither game nor waiting credit here.
    if (player.skipCurrentGame) {
      player.skipCurrentGame = false;
      return;
    }

    const proxyCreditTeam = proxyCreditByMemberId.get(player.id);
    if (proxyCreditTeam) {
      // The yielding Member uses their playing opportunity and receives the
      // score of the team on which their physical proxy played.
      player.points += state.scores[proxyCreditTeam];
      player.gamesPlayed += 1;
      player.waitStreak = 0;
      return;
    }

    if (participated) {
      const team = state.assignments.A.includes(player.id) ? "A" : "B";
      const pointsWereAlreadyFrozen = player.limitReached;
      // A Non-Member receives normal team-score credit through game 2. Any
      // physical fallback/proxy appearance after that adds no ranking points.
      if (!pointsWereAlreadyFrozen) player.points += state.scores[team];
      player.gamesPlayed += 1;
      player.waitStreak = 0;
      // Non-Members remain Limit Reached from game 2 onward, including when
      // they participate as shortage fallback players.
      if (!player.isMember && player.gamesPlayed >= 2) player.limitReached = true;
    } else {
      player.waitStreak += 1;
      // Wait streak still tracks time since the last physical game for
      // fallback priority, but Limit-Reached ranking points stay frozen.
      if (!player.limitReached) player.points += waitingPoints(player.waitStreak);
    }
  });

  const completedProxyYields = state.proxyYields.map((relationship) => {
    const member = getPlayer(relationship.yieldedByMemberId);
    const proxy = getPlayer(relationship.proxyPlayerId);
    return {
      yieldedByMemberId: relationship.yieldedByMemberId,
      yieldedByMemberName: member?.name || "Removed player",
      proxyPlayerId: relationship.proxyPlayerId,
      proxyPlayerName: proxy?.name || "Removed player",
      team: state.assignments.A.includes(relationship.proxyPlayerId) ? "A" : "B"
    };
  });

  state.history.push({
    id: `game-${Date.now().toString(36)}-${state.history.length + 1}`,
    number: state.history.length + 1,
    scoreA,
    scoreB,
    winner,
    durationSeconds: GAME_DURATION_SECONDS,
    teamA: state.assignments.A.map(playerNameSnapshot),
    teamB: state.assignments.B.map(playerNameSnapshot),
    proxyYields: completedProxyYields
  });

  state.phase = "assigning";
  state.scores = { A: 0, B: 0 };
  state.gameStartedAt = null;
  state.gameEndsAt = null;
  state.pendingYieldMemberId = null;
  state.proxyYields = [];
  refreshSelection(false, true);
  showMessage(winner
    ? `Game saved. Team ${winner} won ${scoreA}-${scoreB}.`
    : `Game saved as a ${scoreA}-${scoreB} tie.`);
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function undoLastGame() {
  if (hasCurrentGame() || state.undoStack.length === 0) return;
  const remainingSnapshots = state.undoStack.slice(0, -1);
  const restored = JSON.parse(state.undoStack[state.undoStack.length - 1]);

  // Undo game scoring/history, but preserve roster changes made after that game.
  // This prevents Undo from resurrecting a deleted player or changing Active status.
  const restoredPlayers = new Map(restored.players.map((player) => [player.id, player]));
  const currentRoster = state.players.map((currentPlayer) => {
    const restoredPlayer = restoredPlayers.get(currentPlayer.id);
    if (!restoredPlayer) {
      return {
        ...currentPlayer,
        skipCurrentGame: hasCurrentGame(restored) && currentPlayer.active
      };
    }
    return {
      ...restoredPlayer,
      name: currentPlayer.name,
      active: currentPlayer.active,
      rosterOrder: currentPlayer.rosterOrder,
      presetName: currentPlayer.presetName || restoredPlayer.presetName || null,
      isMember: currentPlayer.isMember === true,
      limitReached: currentPlayer.isMember !== true &&
        (restoredPlayer.limitReached === true || Number(restoredPlayer.gamesPlayed) >= 2),
      skipCurrentGame: hasCurrentGame(restored) && currentPlayer.active && !restoredPlayer.active
        ? true
        : restoredPlayer.skipCurrentGame === true
    };
  });

  state = {
    ...freshState(),
    ...restored,
    players: currentRoster,
    nextPlayerNumber: Math.max(state.nextPlayerNumber, restored.nextPlayerNumber || 1),
    undoStack: remainingSnapshots
  };

  const restoredParticipants = [...state.assignments.A, ...state.assignments.B];
  const restoredGameIsValid = selectionMeetsEligibilityRules(restoredParticipants);

  if (hasCurrentGame() && !restoredGameIsValid) {
    state.phase = "assigning";
    state.scores = { A: 0, B: 0 };
    state.gameStartedAt = null;
    state.gameEndsAt = null;
    refreshSelection(false);
    showMessage("Last game undone. Current Active/Inactive roster choices were preserved; assign the recalculated next 10.");
  } else {
    showMessage("Last game undone. Its teams and final score are restored for editing; the completed timer remains at 0:00.");
  }
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function replaceRosterWithEntries(entries) {
  if (entries.length < PLAYERS_PER_GAME) {
    elements.setupMessage.textContent = `Enter at least ${PLAYERS_PER_GAME} players. You currently have ${entries.length}.`;
    return false;
  }

  if (state.players.length > 0) {
    const confirmed = window.confirm(
      `Replace the existing ${state.players.length}-player roster? Current scores and history will be reset.`
    );
    if (!confirmed) return false;
  }

  state = freshState();
  entries.forEach((entry) => addPlayerRecord(entry.name, 0, {
    presetName: entry.presetName || canonicalPresetName(entry.name),
    isMember: entry.isMember
  }));
  refreshSelection(false);
  elements.rosterSetup.hidden = true;
  elements.setupMessage.textContent = "";
  showMessage(`Session started with ${entries.length} active players.`);
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
  return setupRosterEntries.some(
    (entry, index) => index !== ignoredIndex &&
      entry.name.toLocaleLowerCase() === normalizedName
  );
}

function setupHasPreset(name, ignoredIndex = -1) {
  const normalized = normalizedName(name);
  return setupRosterEntries.some((entry, index) =>
    index !== ignoredIndex && normalizedName(entry.presetName || entry.name) === normalized
  );
}

function renderSetupRoster() {
  const target = targetPlayerCount();
  const selected = setupRosterEntries.length;
  const remaining = target ? Math.max(target - selected, 0) : 0;

  elements.setupTargetCount.textContent = target || "–";
  elements.setupSelectedCount.textContent = selected;
  elements.setupRemainingCount.textContent = target ? remaining : "–";

  elements.frequentPlayerChips.innerHTML = FREQUENT_PLAYERS.map((name) => {
    const isSelected = setupHasPreset(name);
    return `<button class="frequent-chip ${isSelected ? "selected" : ""}" type="button" data-frequent-name="${escapeHtml(name)}" aria-pressed="${isSelected}">${escapeHtml(name)}</button>`;
  }).join("");

  elements.setupRosterList.innerHTML = selected
    ? setupRosterEntries.map((entry, index) => `
        <li class="setup-roster-item">
          <span class="setup-player-identity">
            <input type="text" maxlength="40" value="${escapeHtml(entry.name)}" data-setup-name-index="${index}" aria-label="Edit player ${index + 1}">
            ${membershipBadge(entry)}
          </span>
          <button class="setup-remove" type="button" data-remove-setup-index="${index}" aria-label="Remove ${escapeHtml(entry.name)}">&times;</button>
        </li>`).join("")
    : '<li class="setup-roster-empty">No players selected yet.</li>';

  elements.fillRemainingRoster.textContent =
    `Fill ${remaining} Remaining Player${remaining === 1 ? "" : "s"}`;
  elements.fillRemainingRoster.disabled = !target || remaining <= 0;
  elements.addSetupPlayer.disabled = false;
  elements.createRoster.disabled = selected < PLAYERS_PER_GAME;
}

function addNameToSetup(name, isMember = false) {
  const cleanName = name.trim();
  if (!cleanName) return false;
  const presetName = canonicalPresetName(cleanName);
  const displayName = presetName || cleanName;
  if (setupHasName(displayName) || (presetName && setupHasPreset(presetName))) {
    elements.setupMessage.textContent = `${displayName} is already in the roster.`;
    return false;
  }

  setupRosterEntries.push({
    name: displayName,
    isMember: Boolean(presetName) || isMember,
    presetName: presetName || null
  });
  elements.setupMessage.textContent = "";
  renderSetupRoster();
  return true;
}

function toggleFrequentPlayer(name) {
  const existingIndex = setupRosterEntries.findIndex(
    (entry) => normalizedName(entry.presetName || entry.name) === normalizedName(name)
  );
  if (existingIndex >= 0) {
    setupRosterEntries.splice(existingIndex, 1);
    elements.setupMessage.textContent = "";
    renderSetupRoster();
    return;
  }
  addNameToSetup(name, true);
}

function fillRemainingRoster() {
  const target = targetPlayerCount();
  if (!target) return;
  let placeholderNumber = 1;
  while (setupRosterEntries.length < target) {
    const placeholder = `Player ${String(placeholderNumber).padStart(2, "0")}`;
    if (!setupHasName(placeholder)) {
      setupRosterEntries.push({ name: placeholder, isMember: false, presetName: null });
    }
    placeholderNumber += 1;
  }
  elements.setupMessage.textContent = "Remaining spots filled with default players.";
  renderSetupRoster();
}

function createInitialRoster() {
  if (setupRosterEntries.length < PLAYERS_PER_GAME) {
    elements.setupMessage.textContent = `Add at least ${PLAYERS_PER_GAME} players before starting the session.`;
    return;
  }
  if (replaceRosterWithEntries(setupRosterEntries.map((entry) => ({ ...entry })))) setupRosterEntries = [];
}

function generateDefaultRoster(playerCount = targetPlayerCount()) {
  if (!Number.isInteger(playerCount) || playerCount < PLAYERS_PER_GAME) {
    elements.setupMessage.textContent = `Choose a whole number of at least ${PLAYERS_PER_GAME} players.`;
    return;
  }
  if (setupRosterEntries.length > 0 && !window.confirm("Replace the names currently selected on this setup screen?")) return;

  elements.setupPlayerCount.value = String(playerCount);
  setupRosterEntries = Array.from(
    { length: playerCount },
    (_, index) => ({
      name: `Player ${String(index + 1).padStart(2, "0")}`,
      isMember: false,
      presetName: null
    })
  );
  elements.setupMessage.textContent = `${playerCount} default players are ready. Review or rename them, then start the session.`;
  renderSetupRoster();
}

function addPlayerToSession(name, pointsOverride = "", presetName = null, requestedIsMember = false) {
  const cleanName = name.trim();
  if (!cleanName) return { ok: false, message: "Enter a player name." };

  const resolvedPresetName = presetName || canonicalPresetName(cleanName);
  const displayName = resolvedPresetName || cleanName;
  const existingPresetPlayer = resolvedPresetName ? playerForPreset(resolvedPresetName) : null;
  const existingNamedPlayer = playerForDisplayName(cleanName);
  const existingPlayer = existingPresetPlayer || existingNamedPlayer;
  if (existingPlayer) {
    return {
      ok: false,
      message: existingPlayer.active
        ? `${existingPlayer.name} is already active in today’s roster.`
        : `${existingPlayer.name} is already in today’s roster. Use Reactivate instead.`
    };
  }

  const median = medianActiveScore();
  const startingPoints = pointsOverride === "" ? median : Number(pointsOverride);
  if (!Number.isFinite(startingPoints) || startingPoints < 0) {
    return { ok: false, message: "Starting points must be zero or greater." };
  }

  const addedDuringGame = hasCurrentGame();
  const player = addPlayerRecord(displayName, startingPoints, {
    presetName: resolvedPresetName,
    isMember: Boolean(resolvedPresetName) || requestedIsMember,
    skipCurrentGame: addedDuringGame
  });

  // Never disturb the current teams. Outside a live game, reconcile the next
  // selection immediately so the new active player can be ranked normally.
  if (!addedDuringGame) refreshSelection(true);
  saveState();
  render();

  const scoreMessage = pointsOverride === ""
    ? `the active-player median of ${formatPoints(startingPoints)} points`
    : `${formatPoints(startingPoints)} starting points`;
  const membershipMessage = player.isMember ? "Member" : "Non-Member";
  return {
    ok: true,
    player,
    message: addedDuringGame
      ? `${player.name} added as a ${membershipMessage} at ${scoreMessage}. They are waiting, receive no points for the current game, and become eligible after it finishes.`
      : `${player.name} added as a ${membershipMessage} at ${scoreMessage} and is eligible for the next selection.`
  };
}

function reactivatePlayerFromDialog(playerId) {
  const player = getPlayer(playerId);
  if (!player || player.active) return;

  player.active = true;
  player.skipCurrentGame = hasCurrentGame();
  if (!hasCurrentGame()) refreshSelection(true);
  saveState();
  render();

  const message = player.limitReached
    ? `${player.name} reactivated as present and remains Limit Reached. They can be used as a future shortage fallback or through Member Yield.`
    : hasCurrentGame()
      ? `${player.name} reactivated with their existing score and statistics. They receive no points for the current game and become eligible after it finishes.`
      : `${player.name} reactivated with their existing score and statistics and is eligible for the next selection.`;
  showMessage(message);
  elements.addPlayerDialogMessage.textContent = message;
  renderAddPlayerDialog();
}

function renderAddPlayerDialog() {
  const availablePresets = FREQUENT_PLAYERS.filter((name) => !playerForPreset(name));
  const inactivePlayers = [...state.players]
    .filter((player) => !player.active)
    .sort((a, b) => a.rosterOrder - b.rosterOrder);

  elements.addPlayerTimingNote.textContent = hasCurrentGame()
    ? "The current teams stay unchanged. Anyone added now receives no points for this game and becomes eligible after it finishes."
    : "New players join the waiting bench and are eligible for the next selection.";
  elements.sessionMedianHint.textContent = `(active median: ${formatPoints(medianActiveScore())})`;
  elements.sessionPresetChips.innerHTML = availablePresets.map((name) =>
    `<button class="frequent-chip" type="button" data-session-preset-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`
  ).join("");
  elements.noSessionPresets.hidden = availablePresets.length > 0;
  elements.sessionInactiveList.innerHTML = inactivePlayers.map((player) => `
    <li>
      <span>${escapeHtml(player.name)} ${membershipBadge(player)}<small>${formatPoints(player.points)} pts · ${player.gamesPlayed} played · ${player.waitStreak} waited</small></span>
      <button class="small-button reactivate" type="button" data-dialog-reactivate-id="${player.id}">Reactivate</button>
    </li>`).join("");
  elements.noSessionInactive.hidden = inactivePlayers.length > 0;
}

function openAddPlayerDialog() {
  elements.addPlayerDialogMessage.textContent = "";
  elements.sessionPlayerName.value = "";
  elements.sessionPlayerPoints.value = "";
  elements.sessionPlayerMembership.value = "non-member";
  renderAddPlayerDialog();
  elements.addPlayerDialog.hidden = false;
  const firstPreset = elements.sessionPresetChips.querySelector("button");
  (firstPreset || elements.sessionPlayerName).focus();
}

function closeAddPlayerDialog() {
  elements.addPlayerDialog.hidden = true;
  elements.openAddPlayer.focus();
}

function addCustomSessionPlayer() {
  const result = addPlayerToSession(
    elements.sessionPlayerName.value,
    elements.sessionPlayerPoints.value.trim(),
    null,
    elements.sessionPlayerMembership.value === "member"
  );
  elements.addPlayerDialogMessage.textContent = result.message;
  showMessage(result.message);
  if (result.ok) {
    elements.sessionPlayerName.value = "";
    elements.sessionPlayerPoints.value = "";
    elements.sessionPlayerMembership.value = "non-member";
    renderAddPlayerDialog();
  }
}

function manageRosterPlayer(playerId, action) {
  if (hasCurrentGame()) {
    showMessage("Finish or undo the current game before changing the roster.");
    return;
  }
  const player = getPlayer(playerId);
  if (!player) return;
  const wasSelected = state.selectedPlayerIds.includes(playerId) ||
    state.assignments.A.includes(playerId) || state.assignments.B.includes(playerId);

  if (action === "edit") {
    const updatedName = window.prompt("Edit player name or code:", player.name)?.trim();
    if (!updatedName) return;
    player.name = updatedName;
    showMessage(`Player renamed to ${updatedName}. Existing game history keeps its saved name.`);
  }

  if (action === "deactivate" && player.active) {
    player.active = false;
    showMessage(
      wasSelected
        ? `${player.name} deactivated. The next 10 and team assignments were recalculated.`
        : `${player.name} moved to Inactive Players. Their score and statistics were preserved.`
    );
  }

  if (action === "reactivate" && !player.active) {
    player.active = true;
    showMessage(player.limitReached
      ? `${player.name} reactivated as present and remains Limit Reached. They can be used as a shortage fallback or through Member Yield.`
      : `${player.name} reactivated with their existing score and statistics.`);
  }

  if (action === "delete" && !player.active) {
    const confirmed = window.confirm("Are you sure you want to permanently delete this player?");
    if (!confirmed) return;
    state.players = state.players.filter((candidate) => candidate.id !== playerId);
    showMessage(`${player.name} permanently deleted. Completed game history was preserved.`);
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
    waitStreak: 0,
    limitReached: false,
    skipCurrentGame: false
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
  setupRosterEntries = [];
  elements.setupMessage.textContent = "";
  elements.cancelRosterSetup.hidden = false;
  elements.rosterSetup.hidden = false;
  renderSetupRoster();
  elements.setupPlayerCount.focus();
}

function renderTeamList(element, playerIds) {
  const players = playerIds.map(getPlayer).filter(Boolean);
  element.innerHTML = players.length
    ? players.map((player) => {
        const relationship = proxyYieldForProxy(player.id);
        const member = getPlayer(relationship?.yieldedByMemberId);
        return `<li>${escapeHtml(player.name)}${member
          ? `<span class="proxy-for">Proxy for ${escapeHtml(member.name)}</span>`
          : ""}</li>`;
      }).join("")
    : '<li class="empty-slot">Unassigned</li>';
}

function renderAssignmentView() {
  const selectedPlayers = state.selectedPlayerIds.map(getPlayer).filter(Boolean);
  const selectedIdSet = new Set(state.selectedPlayerIds);
  const waitingPlayers = allBenchCandidatePlayers().filter((player) => !selectedIdSet.has(player.id));
  const eligibleCount = state.players.filter(isRotationEligible).length;
  const fallbackMode = eligibleCount < PLAYERS_PER_GAME;
  const lastCompletedGame = state.history[state.history.length - 1];
  const lastGameParticipantIds = new Set(lastCompletedGame
    ? [...lastCompletedGame.teamA, ...lastCompletedGame.teamB].map((player) => player.playerId)
    : []);
  const recommendationSet = new Set(state.recommendedPlayerIds);
  const matchesRecommendation = state.selectedPlayerIds.length === state.recommendedPlayerIds.length &&
    state.selectedPlayerIds.every((playerId) => recommendationSet.has(playerId));

  elements.nextPlayerList.innerHTML = selectedPlayers.map((player) => {
    const assignedTeam = assignmentFor(player.id);
    const isSwapPending = state.swapOutPlayerId === player.id;
    const yieldRelationship = proxyYieldForProxy(player.id);
    const yieldingMember = getPlayer(yieldRelationship?.yieldedByMemberId);
    let controls;
    if (state.selectionConfirmed) {
      controls = `<span class="assign-buttons" aria-label="Assign ${escapeHtml(player.name)}">
          <button class="assign-button ${assignedTeam === "A" ? "selected" : ""}" type="button" data-assign-id="${player.id}" data-team="A" aria-pressed="${assignedTeam === "A"}">A</button>
          <button class="assign-button ${assignedTeam === "B" ? "selected" : ""}" type="button" data-assign-id="${player.id}" data-team="B" aria-pressed="${assignedTeam === "B"}">B</button>
        </span>`;
    } else if (yieldRelationship) {
      controls = `<button class="swap-button undo-yield" type="button" data-undo-yield-proxy-id="${player.id}">Undo Yield</button>`;
    } else {
      controls = `<span class="selection-player-actions">
        <button class="swap-button ${isSwapPending ? "pending" : ""}" type="button" data-swap-out-id="${player.id}">${isSwapPending ? "Cancel" : "Swap"}</button>
        ${player.isMember ? `<button class="give-spot-button ${state.pendingYieldMemberId === player.id ? "pending" : ""}" type="button" data-yield-member-id="${player.id}">${state.pendingYieldMemberId === player.id ? "Cancel Yield" : "Give Spot"}</button>` : ""}
      </span>`;
    }
    const participationBadge = yieldingMember
      ? `<span class="proxy-badge">Proxy for ${escapeHtml(yieldingMember.name)}</span>`
      : player.limitReached ? '<span class="fallback-badge">Fallback</span>' : "";
    return `
      <li class="next-player ${lastCompletedGame && lastGameParticipantIds.has(player.id) ? "played-last-game" : ""} ${isSwapPending ? "swap-pending" : ""}">
        <span class="next-player-info">
          <span class="next-player-name">${escapeHtml(player.name)} ${participationBadge}</span>
          <span class="player-metrics">${formatPoints(player.points)} pts · ${player.gamesPlayed} played · ${player.waitStreak} waited</span>
        </span>
        ${controls}
      </li>`;
  }).join("");

  elements.waitingPlayerList.innerHTML = waitingPlayers.length
    ? waitingPlayers.map((player) => {
        const yieldedRelationship = proxyYieldForMember(player.id);
        let action;
        if (yieldedRelationship) {
          action = '<span class="yielding-note">Yielding spot</span>';
        } else if (player.limitReached && state.pendingYieldMemberId) {
          action = `<button class="receive-spot-button" type="button" data-receive-yield-player-id="${player.id}">Receive Spot</button>`;
        } else {
          const outgoingPlayer = getPlayer(state.swapOutPlayerId);
          const canSwap = Boolean(outgoingPlayer) &&
            (!player.limitReached || (fallbackMode && outgoingPlayer.limitReached));
          action = `<button class="swap-in-button" type="button" data-swap-in-id="${player.id}" ${canSwap ? "" : "disabled"}>${player.limitReached && !fallbackMode ? "Give Spot only" : "Swap In"}</button>`;
        }
        return `
        <li class="waiting-player ${lastCompletedGame && !lastGameParticipantIds.has(player.id) ? "rested-last-game" : ""}">
          <span class="waiting-player-name">
            ${escapeHtml(player.name)}
            ${membershipBadge(player)}
            <span class="player-metrics">${formatPoints(player.points)} pts · ${player.gamesPlayed} played · ${player.waitStreak} waited</span>
            ${player.limitReached ? '<span class="fallback-note">Ranking frozen · fallback or Member Yield only</span>' : ""}
          </span>
          ${action}
        </li>`;
      }).join("")
    : '<li class="roster-empty">No other active players are waiting.</li>';

  const candidateCount = rankedActivePlayers().length;
  if (state.pendingYieldMemberId) {
    const member = getPlayer(state.pendingYieldMemberId);
    elements.selectionHelp.textContent = `Choose a Limit-Reached Non-Member below to physically play for ${member?.name || "this Member"}.`;
  } else if (candidateCount < PLAYERS_PER_GAME) {
    elements.selectionHelp.textContent =
      `Only ${candidateCount} active candidate${candidateCount === 1 ? " is" : "s are"} available, including shortage fallbacks. Add or reactivate players to reach 10.`;
  } else if (state.selectionConfirmed) {
    elements.selectionHelp.textContent = "Assign 5 players to either team. Any remaining players will join the other team when you start.";
  } else if (eligibleCount < PLAYERS_PER_GAME) {
    const fallbackCount = PLAYERS_PER_GAME - eligibleCount;
    elements.selectionHelp.textContent =
      `Roster shortage: ${fallbackCount} Limit-Reached Non-Member${fallbackCount === 1 ? " is" : "s are"} included as fallback. All ${eligibleCount} normally eligible players remain first priority.`;
  } else {
    elements.selectionHelp.textContent = "This is the ranking recommendation. Swap anyone if needed, then confirm the final 10.";
  }

  const pendingPlayer = getPlayer(state.swapOutPlayerId);
  const pendingYieldMember = getPlayer(state.pendingYieldMemberId);
  elements.swapInstruction.textContent = pendingYieldMember
    ? `${pendingYieldMember.name} is giving their spot. Choose a Limit-Reached Non-Member below.`
    : pendingPlayer
      ? `${pendingPlayer.name} will move to the bench. Choose a waiting player to swap in.`
      : "Use Swap for normal changes, or Give Spot for a Member Yield.";
  elements.swapInstruction.classList.toggle("active", Boolean(pendingPlayer || pendingYieldMember));
  elements.selectionLabel.textContent = state.proxyYields.length ? "Proxy adjusted" : matchesRecommendation ? "Recommended" : "Adjusted";
  elements.waitingPlayersSection.hidden = state.selectionConfirmed;
  elements.swapInstruction.hidden = state.selectionConfirmed;
  elements.confirmSelection.hidden = state.selectionConfirmed;
  elements.confirmSelection.disabled = !selectionMeetsEligibilityRules();
  elements.changeSelection.hidden = !state.selectionConfirmed;
  elements.teamAssignmentPanel.hidden = !state.selectionConfirmed;

  renderTeamList(elements.teamAList, state.assignments.A);
  renderTeamList(elements.teamBList, state.assignments.B);
  elements.teamACount.textContent = `${state.assignments.A.length}/5`;
  elements.teamBCount.textContent = `${state.assignments.B.length}/5`;
  elements.assignmentCount.textContent = `A: ${state.assignments.A.length}/5 · B: ${state.assignments.B.length}/5`;
  elements.startGame.disabled = !teamAssignmentsCanBeCompleted();
}

function renderScoreboard() {
  elements.scoreboard.innerHTML = TEAM_LABELS.map((team) => `
    <article class="team-score">
      <h3 class="team-label">Team ${team}</h3>
      <output class="score" aria-label="Team ${team} score">${state.scores[team]}</output>
      ${state.phase === "playing" ? `<div class="score-controls">
        <button class="score-button" type="button" data-score-team="${team}" data-amount="1" aria-label="Add 1 to Team ${team}">+1</button>
        <button class="score-button" type="button" data-score-team="${team}" data-amount="2" aria-label="Add 2 to Team ${team}">+2</button>
        <button class="score-button minus" type="button" data-score-team="${team}" data-amount="-1" aria-label="Subtract 1 from Team ${team}">&minus;1</button>
      </div>` : '<p class="score-frozen">Final score pending</p>'}
    </article>`).join("");
}

function renderGameView() {
  renderTeamList(elements.currentTeamA, state.assignments.A);
  renderTeamList(elements.currentTeamB, state.assignments.B);
  renderGameTimer();
  renderScoreboard();
  const awaitingScore = state.phase === "awaitingScore";
  elements.finalScorePanel.hidden = !awaitingScore;
  if (awaitingScore) {
    elements.finalScoreA.value = String(state.scores.A);
    elements.finalScoreB.value = String(state.scores.B);
  }
}

function renderRoster() {
  const activeCount = state.players.filter((player) => player.active).length;
  const eligibleCount = state.players.filter(isRotationEligible).length;
  elements.rosterCount.textContent = `${state.players.length} player${state.players.length === 1 ? "" : "s"}`;
  elements.rosterLockNote.textContent = hasCurrentGame()
    ? "The current lineup stays unchanged. Use the main + Add Player button for late arrivals."
    : "View player status, edit names, deactivate players, or reactivate inactive players below.";

  const sortedPlayers = [...state.players].sort((a, b) => a.rosterOrder - b.rosterOrder);
  const activePlayers = sortedPlayers.filter((player) => player.active);
  const inactivePlayers = sortedPlayers.filter((player) => !player.active);
  const disabled = hasCurrentGame() ? "disabled" : "";

  elements.activePlayerList.innerHTML = activePlayers.length
    ? activePlayers.map((player) => `
        <li class="roster-player ${player.limitReached ? "limit-reached-player" : ""}">
          <span class="roster-name">
            ${escapeHtml(player.name)}
            ${membershipBadge(player)}
            <span class="player-metrics">${formatPoints(player.points)} pts · ${player.gamesPlayed} played · ${player.waitStreak} waited</span>
          </span>
          <span class="roster-actions">
            <button class="small-button" type="button" data-roster-action="edit" data-player-id="${player.id}" ${disabled}>Edit</button>
            <button class="small-button deactivate" type="button" data-roster-action="deactivate" data-player-id="${player.id}" ${disabled}>Deactivate</button>
          </span>
        </li>`).join("")
    : '<li class="roster-empty">No active players.</li>';

  elements.inactivePlayerList.innerHTML = inactivePlayers.length
    ? inactivePlayers.map((player) => `
        <li class="roster-player inactive">
          <span class="roster-name">
            ${escapeHtml(player.name)}
            ${membershipBadge(player)}
            <span class="player-metrics">${formatPoints(player.points)} pts · ${player.gamesPlayed} played · ${player.waitStreak} waited</span>
          </span>
          <span class="roster-actions">
            <button class="small-button" type="button" data-roster-action="edit" data-player-id="${player.id}" ${disabled}>Edit</button>
            <button class="small-button reactivate" type="button" data-roster-action="reactivate" data-player-id="${player.id}" ${disabled}>Reactivate</button>
            <button class="small-button delete-permanently" type="button" data-roster-action="delete" data-player-id="${player.id}" ${disabled}>Delete Permanently</button>
          </span>
        </li>`).join("")
    : '<li class="roster-empty">No inactive players.</li>';

  elements.activePlayerCount.textContent = `${activePlayers.length} · ${eligibleCount} normally eligible`;
  elements.inactivePlayerCount.textContent = inactivePlayers.length;
  elements.sessionSummary.textContent = `${activeCount} active · ${eligibleCount} normally eligible · ${state.players.length} total`;
}

function renderStandings() {
  const selectedIds = new Set(state.selectedPlayerIds);
  const fallbackMode = state.players.filter(isRotationEligible).length < PLAYERS_PER_GAME;
  const players = [...state.players].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.active ? comparePriority(a, b) : a.rosterOrder - b.rosterOrder;
  });

  elements.standingsBody.innerHTML = players.map((player) => `
    <tr class="${selectedIds.has(player.id) ? "selected-row" : ""} ${player.active ? "" : "inactive-row"} ${player.limitReached ? "limit-reached-row" : ""}">
      <td>${escapeHtml(player.name)} ${membershipBadge(player)}</td>
      <td>${formatPoints(player.points)}</td>
      <td>${player.gamesPlayed}</td>
      <td>${player.waitStreak}</td>
      <td class="${player.active && !player.limitReached ? "status-active" : player.limitReached ? "status-limit" : ""}">${player.active ? (player.limitReached ? (fallbackMode ? "Limit Reached · Fallback" : "Limit Reached") : "Active") : "Inactive"}</td>
    </tr>`).join("");

  const count = state.history.length;
  elements.gameCount.textContent = `${count} game${count === 1 ? "" : "s"}`;
}

function renderHistory() {
  elements.historyList.innerHTML = [...state.history].reverse().map((game) => `
    <details class="history-game">
      <summary>Game ${game.number}<span class="history-score">Team A ${game.scoreA}–${game.scoreB} Team B</span></summary>
      ${game.durationSeconds ? `<p class="history-duration">Duration: ${Math.floor(game.durationSeconds / 60)}:${String(game.durationSeconds % 60).padStart(2, "0")}</p>` : ""}
      <div class="history-rosters">
        <div><h3>Team A</h3><ul>${game.teamA.map((player) => `<li>${escapeHtml(player.name)}</li>`).join("")}</ul></div>
        <div><h3>Team B</h3><ul>${game.teamB.map((player) => `<li>${escapeHtml(player.name)}</li>`).join("")}</ul></div>
      </div>
      ${Array.isArray(game.proxyYields) && game.proxyYields.length
        ? `<div class="history-proxies"><strong>Member Yield</strong><ul>${game.proxyYields.map((relationship) =>
            `<li>${escapeHtml(relationship.proxyPlayerName)} played on Team ${relationship.team} for ${escapeHtml(relationship.yieldedByMemberName)}</li>`
          ).join("")}</ul></div>`
        : ""}
    </details>`).join("");
  elements.emptyHistory.hidden = state.history.length > 0;
  elements.undoGame.disabled = hasCurrentGame() || state.undoStack.length === 0;
}

function render() {
  const currentGameOpen = hasCurrentGame();
  elements.pageTitle.textContent = currentGameOpen ? "Current Game" : "Next 10 Players";
  elements.assignmentView.hidden = currentGameOpen;
  elements.gameView.hidden = !currentGameOpen;
  if (currentGameOpen) renderGameView();
  else renderAssignmentView();
  renderRoster();
  renderStandings();
  renderHistory();
  if (state.phase === "playing") startGameTimerLoop();
  else stopGameTimerLoop();
}

elements.nextPlayerList.addEventListener("click", (event) => {
  const assignButton = event.target.closest("[data-assign-id]");
  if (assignButton) assignPlayer(assignButton.dataset.assignId, assignButton.dataset.team);
  const swapButton = event.target.closest("[data-swap-out-id]");
  if (swapButton) chooseSwapOut(swapButton.dataset.swapOutId);
  const yieldButton = event.target.closest("[data-yield-member-id]");
  if (yieldButton) chooseMemberYield(yieldButton.dataset.yieldMemberId);
  const undoYieldButton = event.target.closest("[data-undo-yield-proxy-id]");
  if (undoYieldButton) undoMemberYield(undoYieldButton.dataset.undoYieldProxyId);
});
elements.waitingPlayerList.addEventListener("click", (event) => {
  const swapButton = event.target.closest("[data-swap-in-id]");
  if (swapButton) swapInPlayer(swapButton.dataset.swapInId);
  const receiveSpotButton = event.target.closest("[data-receive-yield-player-id]");
  if (receiveSpotButton) giveMemberSpotTo(receiveSpotButton.dataset.receiveYieldPlayerId);
});
elements.confirmSelection.addEventListener("click", confirmFinalSelection);
elements.changeSelection.addEventListener("click", changeFinalSelection);

elements.startGame.addEventListener("click", startGame);
elements.scoreboard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-score-team]");
  if (button) adjustScore(button.dataset.scoreTeam, Number(button.dataset.amount));
});
function updateFinalScoreDraft(team, value) {
  if (state.phase !== "awaitingScore" || !/^\d+$/.test(value)) return;
  state.scores[team] = Number(value);
  saveState();
}
elements.finalScoreA.addEventListener("input", () => updateFinalScoreDraft("A", elements.finalScoreA.value));
elements.finalScoreB.addEventListener("input", () => updateFinalScoreDraft("B", elements.finalScoreB.value));
elements.finishGame.addEventListener("click", finishGame);
elements.undoGame.addEventListener("click", undoLastGame);
elements.openAddPlayer.addEventListener("click", openAddPlayerDialog);
elements.closeAddPlayer.addEventListener("click", closeAddPlayerDialog);
elements.addSessionPlayer.addEventListener("click", addCustomSessionPlayer);
elements.sessionPlayerName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCustomSessionPlayer();
  }
});
elements.sessionPresetChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-preset-name]");
  if (!button) return;
  const name = button.dataset.sessionPresetName;
  const result = addPlayerToSession(name, "", name, true);
  elements.addPlayerDialogMessage.textContent = result.message;
  showMessage(result.message);
  if (result.ok) renderAddPlayerDialog();
});
elements.sessionInactiveList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dialog-reactivate-id]");
  if (button) reactivatePlayerFromDialog(button.dataset.dialogReactivateId);
});
elements.addPlayerDialog.addEventListener("click", (event) => {
  if (event.target === elements.addPlayerDialog) closeAddPlayerDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.addPlayerDialog.hidden) closeAddPlayerDialog();
});
function handleRosterAction(event) {
  const button = event.target.closest("[data-roster-action]");
  if (button) manageRosterPlayer(button.dataset.playerId, button.dataset.rosterAction);
}
elements.activePlayerList.addEventListener("click", handleRosterAction);
elements.inactivePlayerList.addEventListener("click", handleRosterAction);

elements.createRoster.addEventListener("click", createInitialRoster);
elements.generateDefaultRoster.addEventListener("click", () => generateDefaultRoster());
elements.create20Roster.addEventListener("click", () => generateDefaultRoster(20));
elements.setupPlayerCount.addEventListener("input", renderSetupRoster);
elements.frequentPlayerChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-frequent-name]");
  if (button) toggleFrequentPlayer(button.dataset.frequentName);
});
elements.setupRosterList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-setup-index]");
  if (!button) return;
  setupRosterEntries.splice(Number(button.dataset.removeSetupIndex), 1);
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
  const presetName = canonicalPresetName(newName);
  if (presetName && setupHasPreset(presetName, index)) {
    elements.setupMessage.textContent = `${presetName} is already in the roster.`;
    renderSetupRoster();
    return;
  }
  setupRosterEntries[index].name = presetName || newName;
  if (presetName) {
    setupRosterEntries[index].isMember = true;
    setupRosterEntries[index].presetName = setupRosterEntries[index].presetName || presetName;
  }
  elements.setupMessage.textContent = "";
  renderSetupRoster();
});
function addCustomSetupPlayer() {
  if (addNameToSetup(
    elements.setupCustomName.value,
    elements.setupPlayerMembership.value === "member"
  )) {
    elements.setupCustomName.value = "";
    elements.setupPlayerMembership.value = "non-member";
  }
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
  setupRosterEntries = [];
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
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && hasCurrentGame()) syncGameTimer();
});
window.addEventListener("pageshow", () => {
  if (hasCurrentGame()) syncGameTimer();
});

if (state.phase === "assigning") refreshSelection(true);
if (state.phase === "playing") saveState();
render();
if (!restoredState || state.players.length === 0) {
  elements.cancelRosterSetup.hidden = true;
  elements.rosterSetup.hidden = false;
  renderSetupRoster();
  elements.setupPlayerCount.focus();
}
