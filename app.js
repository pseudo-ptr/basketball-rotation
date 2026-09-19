"use strict";

const STORAGE_KEY = "basketballRotationSessionV1";
const ALL_TEAM_IDS = ["A", "B", "C", "D"];

function teamIdsFor(teamCount) {
  return ALL_TEAM_IDS.slice(0, teamCount);
}

function freshTeams(teamCount) {
  return Object.fromEntries(
    teamIdsFor(teamCount).map((id) => [id, { points: 0, gamesPlayed: 0, waitStreak: 0 }])
  );
}

function freshState(teamCount) {
  return {
    teamCount,
    teams: freshTeams(teamCount),
    currentTeams: ["A", "B"],
    scores: { A: 0, B: 0 },
    history: [],
    undoStack: []
  };
}

function loadState() {
  try {
    const storedValue = localStorage.getItem(STORAGE_KEY);
    if (!storedValue) return null;

    const saved = JSON.parse(storedValue);
    if (!saved || !saved.teams || !Array.isArray(saved.currentTeams)) return null;

    // Sessions saved before team-count support were always four-team sessions.
    const teamCount = saved.teamCount === 3 ? 3 : 4;
    const activeIds = teamIdsFor(teamCount);
    const teams = Object.fromEntries(activeIds.map((id) => [
      id,
      { points: 0, gamesPlayed: 0, waitStreak: 0, ...saved.teams[id] }
    ]));
    const currentTeamsAreValid = saved.currentTeams.length === 2 &&
      saved.currentTeams.every((id) => activeIds.includes(id));

    return {
      teamCount,
      teams,
      currentTeams: currentTeamsAreValid ? saved.currentTeams : ["A", "B"],
      scores: saved.scores || { A: 0, B: 0 },
      history: Array.isArray(saved.history) ? saved.history : [],
      undoStack: Array.isArray(saved.undoStack) ? saved.undoStack : []
    };
  } catch (error) {
    console.warn("Could not load saved session; asking for a new one.", error);
    return null;
  }
}

const savedState = loadState();
let state = savedState || freshState(4);

const scoreboard = document.querySelector("#scoreboard");
const matchup = document.querySelector("#current-matchup");
const nextGame = document.querySelector("#next-game");
const message = document.querySelector("#game-message");
const standingsBody = document.querySelector("#standings-body");
const historyList = document.querySelector("#history-list");
const emptyHistory = document.querySelector("#empty-history");
const gameCount = document.querySelector("#game-count");
const finishButton = document.querySelector("#finish-game");
const undoButton = document.querySelector("#undo-game");
const resetButton = document.querySelector("#reset-session");
const sessionMode = document.querySelector("#session-mode");
const setupOverlay = document.querySelector("#session-setup");

function activeTeamIds() {
  return teamIdsFor(state.teamCount);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Sort strictly by ranking points, then the three specified tie-break rules.
function rankedTeams() {
  const activeIds = activeTeamIds();
  return [...activeIds].sort((a, b) => {
    const teamA = state.teams[a];
    const teamB = state.teams[b];
    return (
      teamB.points - teamA.points ||
      teamB.waitStreak - teamA.waitStreak ||
      teamA.gamesPlayed - teamB.gamesPlayed ||
      activeIds.indexOf(a) - activeIds.indexOf(b)
    );
  });
}

function adjustScore(teamId, amount) {
  state.scores[teamId] = Math.max(0, (state.scores[teamId] || 0) + amount);
  message.textContent = "";
  saveState();
  render();
}

function finishGame() {
  const [teamA, teamB] = state.currentTeams;
  const scoreA = state.scores[teamA] || 0;
  const scoreB = state.scores[teamB] || 0;

  if (scoreA === scoreB) {
    message.textContent = "A game must have a winner. Adjust the score first.";
    return;
  }

  // Keep an exact snapshot so Undo restores standings, matchup, and entered score.
  state.undoStack.push(JSON.stringify({
    teamCount: state.teamCount,
    teams: state.teams,
    currentTeams: state.currentTeams,
    scores: state.scores,
    history: state.history
  }));

  activeTeamIds().forEach((teamId) => {
    const team = state.teams[teamId];
    if (teamId === teamA || teamId === teamB) {
      team.gamesPlayed += 1;
      team.waitStreak = 0;
      // On-court scoring contributes at most 5 points.
      team.points += Math.min(state.scores[teamId] || 0, 5);
    } else {
      team.waitStreak += 1;
      // Waiting awards 15, 20, 25... for consecutive sit-outs.
      team.points += 15 + (team.waitStreak - 1) * 5;
    }
  });

  const winner = scoreA > scoreB ? teamA : teamB;
  state.teams[winner].points += 2;
  state.history.push({ teamA, teamB, scoreA, scoreB });

  state.currentTeams = rankedTeams().slice(0, 2);
  state.scores = Object.fromEntries(state.currentTeams.map((id) => [id, 0]));
  message.textContent = `Game saved. Team ${winner} won.`;
  saveState();
  render();
}

function undoLastGame() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) return;

  const restored = JSON.parse(snapshot);
  // Older undo snapshots do not contain teamCount; they came from four-team sessions.
  state = { ...restored, teamCount: restored.teamCount || state.teamCount, undoStack: state.undoStack };
  message.textContent = "Last game undone. Its score is ready to edit.";
  saveState();
  render();
}

function resetSession() {
  if (!window.confirm("Start a new session? All scores and game history will be erased.")) return;
  showTeamCountSelector();
}

function showTeamCountSelector() {
  setupOverlay.hidden = false;
  setupOverlay.querySelector("button").focus();
}

function startNewSession(teamCount) {
  state = freshState(teamCount);
  setupOverlay.hidden = true;
  message.textContent = `New ${teamCount}-team session started.`;
  saveState();
  render();
}

function renderScoreboard() {
  const [teamA, teamB] = state.currentTeams;
  matchup.innerHTML = `${teamA} <span>vs</span> ${teamB}`;
  nextGame.textContent = `NEXT GAME: ${teamA} vs ${teamB}`;

  scoreboard.innerHTML = state.currentTeams.map((teamId) => `
    <article class="team-score">
      <h2 class="team-label">Team ${teamId}</h2>
      <output class="score" aria-label="Team ${teamId} score">${state.scores[teamId] || 0}</output>
      <div class="score-controls">
        <button class="score-button" type="button" data-team="${teamId}" data-amount="1" aria-label="Add 1 to Team ${teamId}">+1</button>
        <button class="score-button" type="button" data-team="${teamId}" data-amount="2" aria-label="Add 2 to Team ${teamId}">+2</button>
        <button class="score-button minus" type="button" data-team="${teamId}" data-amount="-1" aria-label="Subtract 1 from Team ${teamId}">−1</button>
      </div>
    </article>
  `).join("");
}

function renderStandings() {
  standingsBody.innerHTML = activeTeamIds().map((id) => {
    const team = state.teams[id];
    return `<tr><td>${id}</td><td>${team.points}</td><td>${team.gamesPlayed}</td><td>${team.waitStreak}</td></tr>`;
  }).join("");
  const count = state.history.length;
  gameCount.textContent = `${count} game${count === 1 ? "" : "s"}`;
  sessionMode.textContent = `${state.teamCount}-team session`;
}

function renderHistory() {
  historyList.innerHTML = state.history.map((game) =>
    `<li>${game.teamA} ${game.scoreA} – ${game.scoreB} ${game.teamB}</li>`
  ).join("");
  emptyHistory.hidden = state.history.length > 0;
  undoButton.disabled = state.undoStack.length === 0;
}

function render() {
  renderScoreboard();
  renderStandings();
  renderHistory();
}

scoreboard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-team]");
  if (button) adjustScore(button.dataset.team, Number(button.dataset.amount));
});
finishButton.addEventListener("click", finishGame);
undoButton.addEventListener("click", undoLastGame);
resetButton.addEventListener("click", resetSession);
setupOverlay.addEventListener("click", (event) => {
  const button = event.target.closest("[data-team-count]");
  if (button) startNewSession(Number(button.dataset.teamCount));
});

render();
if (!savedState) showTeamCountSelector();
