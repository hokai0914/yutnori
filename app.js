/* =========================================================================
   윷놀이 말판 — 바닐라 JS
   윷 던지기는 오프라인. 사용자가 결과를 입력하면 말 이동/규칙을 자동 처리.
   ========================================================================= */

/* ---------- 보드 그래프 (전통 29칸) ----------
   좌표는 6x6 개념 격자 (col 0~5, row 0=상단). 중앙은 (2.5, 2.5).
   외곽 20칸(0~19): 우하단 시작점(0)에서 반시계로 진행.
   대각선/중앙 9칸(20~28).
*/
const GRID = {
  0:[5,5], 1:[5,4], 2:[5,3], 3:[5,2], 4:[5,1],
  5:[5,0], 6:[4,0], 7:[3,0], 8:[2,0], 9:[1,0],
  10:[0,0], 11:[0,1], 12:[0,2], 13:[0,3], 14:[0,4],
  15:[0,5], 16:[1,5], 17:[2,5], 18:[3,5], 19:[4,5],
  // 우상단(5) -> 중앙(22)
  20:[4,1], 21:[3.25,1.75],
  22:[2.5,2.5], // 중앙(방)
  // 중앙 -> 좌하단(15)
  23:[1.75,3.25], 24:[1,4],
  // 좌상단(10) -> 중앙(22)
  25:[1,1], 26:[1.75,1.75],
  // 중앙 -> 우하단/도착(0)
  27:[3.25,3.25], 28:[4,4],
};

// 기본(직진) 다음 칸. 22(중앙)는 진입 방향에 따라 별도 처리.
const DEFAULT_NEXT = {
  0:1,1:2,2:3,3:4,4:5,5:6,6:7,7:8,8:9,9:10,
  10:11,11:12,12:13,13:14,14:15,15:16,16:17,17:18,18:19,19:0,
  20:21,21:22, 23:24,24:15, 25:26,26:22, 27:28,28:0,
};

const BIG_NODES = new Set([5, 10, 15, 0]); // 모서리 강조
const CENTER = 22;

function defaultNextFrom(id, prev) {
  if (id === CENTER) return prev === 26 ? 27 : 23; // 좌상단 대각선에서 왔으면 도착쪽, 아니면 좌하단쪽
  return DEFAULT_NEXT[id];
}

// 말이 어떤 칸에 "정확히 멈춰 있을 때" 이동 첫 걸음
function firstNextFrom(id, prev) {
  if (id === 5) return 20;   // 우상단 모서리 -> 지름길
  if (id === 10) return 25;  // 좌상단 모서리 -> 지름길
  if (id === CENTER) return 27; // 중앙에 멈춤 -> 도착 지름길
  return defaultNextFrom(id, prev);
}

/* ---------- 이동 계산 ---------- */
// 전진: {node, history, finished}
function computeForward(token, steps) {
  const fromHome = token.node === null;
  let history = fromHome ? [] : token.history.slice();
  let prev = history.length >= 2 ? history[history.length - 2] : null;
  let current = fromHome ? 0 : token.node; // 0 = 출발 원점(집에서 진입 시)
  let finished = false;

  for (let s = 0; s < steps; s++) {
    let nx;
    if (s === 0) {
      nx = fromHome ? 1 : firstNextFrom(current, prev);
    } else {
      nx = defaultNextFrom(current, prev);
    }
    prev = current;
    current = nx;
    history.push(current);
    if (current === 0) { finished = true; break; } // 출발점 통과 = 완주
  }
  return { node: finished ? 'done' : current, history, finished };
}

// 백도: 지나온 경로에서 한 칸 뒤로
function computeBackdo(token) {
  const history = token.history.slice();
  history.pop();
  const node = history.length ? history[history.length - 1] : null; // null = 집으로
  return { node, history, finished: false };
}

/* ---------- 게임 상태 ---------- */
const VAL_LABEL = { '-1': '백도', '1': '도', '2': '개', '3': '걸', '4': '윷', '5': '모' };
const PLAYERS = [
  { name: '플레이어 1', cls: 'p0' },
  { name: '플레이어 2', cls: 'p1' },
];
const TOKENS_PER_PLAYER = 4;

let state;

function newGame() {
  const tokens = [];
  let id = 0;
  for (let owner = 0; owner < 2; owner++) {
    for (let i = 0; i < TOKENS_PER_PLAYER; i++) {
      tokens.push({ id: id++, owner, node: null, history: [] });
    }
  }
  state = {
    tokens,
    turn: 0,
    chips: [],          // 입력된 결과값 배열
    selectedChip: null, // 선택된 chip의 인덱스
    throwsTaken: 0,     // 이번 턴에 던진 횟수(입력한 결과 수)
    bonusEarned: 0,     // 이번 턴에 얻은 추가 던지기 수(윷/모/잡기)
    locked: false,      // 자동 턴 넘김 대기 중 입력 잠금
    winner: null,
  };
  setMessage('윷을 던진 뒤 결과 버튼을 누르세요.');
  render();
}

/* ---------- 조회 헬퍼 ---------- */
const ownTokens = (owner) => state.tokens.filter(t => t.owner === owner);
const homeCount = (owner) => ownTokens(owner).filter(t => t.node === null).length;
const doneCount = (owner) => ownTokens(owner).filter(t => t.node === 'done').length;
const boardTokens = (owner) => ownTokens(owner).filter(t => typeof t.node === 'number');
// 특정 칸에 있는 소유자 말들 (업힌 말 그룹)
const tokensAt = (owner, nodeId) => state.tokens.filter(t => t.owner === owner && t.node === nodeId);
// 아직 남은 던질 권리 = (기본 1 + 보너스) - 이미 던진 횟수
const throwsOwed = () => (1 + state.bonusEarned) - state.throwsTaken;

/* ---------- 이동 가능 여부 ---------- */
function canUse(token, value) {
  if (token.owner !== state.turn) return false;
  if (token.node === 'done') return false;
  if (value === -1) return token.node !== null; // 백도: 판 위 말만
  return true; // 전진: 집(진입) 또는 판 위 모두 가능
}

/* ---------- 실제 이동 실행 ---------- */
function applyMove(anchorToken, value) {
  // 업힌 말 그룹: 같은 칸의 같은 소유자 말 함께 이동 (집에서 진입은 단일 말)
  let group;
  if (anchorToken.node === null) {
    group = [anchorToken];
  } else {
    group = tokensAt(anchorToken.owner, anchorToken.node);
  }

  const res = value === -1
    ? computeBackdo(anchorToken)
    : computeForward(anchorToken, value);

  // 그룹 전체에 동일 결과 적용
  group.forEach(t => {
    t.node = res.node;
    t.history = res.history.slice();
  });

  // 잡기 판정 (전진/백도로 특정 칸에 도착했을 때)
  let captured = 0;
  if (typeof res.node === 'number') {
    const opp = state.turn === 0 ? 1 : 0;
    const victims = tokensAt(opp, res.node);
    victims.forEach(t => { t.node = null; t.history = []; });
    captured = victims.length;
  }
  if (captured > 0) state.bonusEarned += 1; // 잡으면 한 번 더

  // 사용한 chip 소진
  state.chips.splice(state.selectedChip, 1);
  state.selectedChip = null;

  // 안내 메시지
  const label = VAL_LABEL[value];
  const groupTxt = group.length > 1 ? `말 ${group.length}개(업기) ` : '말 ';
  if (res.finished) {
    setMessage(`${groupTxt}완주! (${label}) 🎉`);
  } else if (captured > 0) {
    setMessage(`잡았습니다! 상대 말 ${captured}개를 집으로 보냈어요. 윷을 한 번 더 던지세요! (${label})`, true);
  } else {
    setMessage(`${groupTxt}이동 완료 (${label})`);
  }

  // 승리 판정
  if (doneCount(state.turn) === TOKENS_PER_PLAYER) {
    state.winner = state.turn;
  }

  render();
  if (state.winner !== null) { showWinner(state.winner); return; }

  // 자동 턴 넘김 판정
  maybeAdvanceTurn(captured > 0, res.finished);
}

/* ---------- 자동 턴 진행 ---------- */
// 결과를 모두 쓰고 더 던질 권리가 없으면 자동으로 다음 플레이어에게 넘김
function maybeAdvanceTurn(justCaptured, justFinished) {
  if (state.winner !== null) return;
  if (state.chips.length > 0) return; // 아직 배정하지 않은 결과가 남음

  if (throwsOwed() > 0) {
    // 보너스(윷/모/잡기)로 한 번 더 던질 수 있음 → 턴 유지
    const why = justCaptured ? '잡았으니' : '윷·모라서';
    setMessage(`${why} 한 번 더! 던진 결과 버튼을 누르세요.`, true);
    return;
  }
  // 더 던질 것이 없음 → 자동 턴 넘김
  autoPassTurn(justFinished);
}

function autoPassTurn(justFinished) {
  state.locked = true;
  render(); // 입력 잠금 반영
  setMessage(justFinished
    ? '완주! 다음 플레이어로 넘어갑니다…'
    : '이동 완료 — 다음 플레이어로 넘어갑니다…');
  setTimeout(() => { if (state.locked) endTurn(); }, 850); // 대기 중 새 게임 시 무시
}

/* ---------- 턴/입력 조작 ---------- */
function addChip(value) {
  if (state.winner !== null || state.locked) return;
  if (throwsOwed() <= 0) return; // 더 던질 권리 없음(버튼도 비활성)
  state.chips.push(value);
  state.throwsTaken += 1;
  if (value === 4 || value === 5) state.bonusEarned += 1; // 윷·모 → 한 번 더
  // 방금 넣은 결과를 자동 선택
  state.selectedChip = state.chips.length - 1;
  const noMove = currentOptions(value).length === 0;
  if ((value === 4 || value === 5) && !noMove) {
    setMessage(`${VAL_LABEL[value]}! 한 번 더 던질 수 있어요. 이동할 위치를 보드에서 선택하세요.`, true);
  } else {
    setMessage(optionMessage(value));
  }
  render();
}

function selectChip(index) {
  state.selectedChip = state.selectedChip === index ? null : index;
  const value = state.selectedChip === null ? null : state.chips[state.selectedChip];
  if (value === null) setMessage('사용할 결과를 선택하세요.');
  else setMessage(optionMessage(value));
  render();
}

function discardSelected() {
  if (state.selectedChip === null || state.locked) return;
  const v = state.chips[state.selectedChip];
  state.chips.splice(state.selectedChip, 1);
  state.selectedChip = null;
  setMessage(`'${VAL_LABEL[v]}' 결과를 버렸습니다.`);
  render();
  maybeAdvanceTurn(false, false); // 버려서 남은 결과가 없으면 자동 넘김
}

function endTurn() {
  if (state.winner !== null) return;
  state.turn = state.turn === 0 ? 1 : 0;
  state.chips = [];
  state.selectedChip = null;
  state.throwsTaken = 0;
  state.bonusEarned = 0;
  state.locked = false;
  setMessage(`${PLAYERS[state.turn].name} 차례입니다. 윷을 던지세요.`);
  render();
}

// 말/집 클릭 → 선택된 chip으로 이동
function handleTokenClick(token) {
  if (state.locked) return;
  if (state.selectedChip === null) {
    setMessage('먼저 사용할 결과를 선택하세요.');
    return;
  }
  const value = state.chips[state.selectedChip];
  if (!canUse(token, value)) return;
  applyMove(token, value);
}

/* ---------- 렌더링 ---------- */
const boardEl = document.getElementById('board');
const linesEl = document.getElementById('board-lines');
let previewLayer = null; // 이동 경로 미리보기 라인 레이어
const px = (c) => 7 + c * 17.2; // 격자 -> 퍼센트(0~100)

function buildBoard() {
  // 라인 (외곽 사각 + 대각선)
  const ring = [...Array(20).keys()].concat(0);
  const diagA = [5, 20, 21, 22, 23, 24, 15];
  const diagB = [10, 25, 26, 22, 27, 28, 0];
  const toPts = (ids) => ids.map(id => `${px(GRID[id][0])},${px(GRID[id][1])}`).join(' ');
  linesEl.innerHTML = `
    <polyline class="ring" points="${toPts(ring)}" />
    <polyline class="diag" points="${toPts(diagA)}" />
    <polyline class="diag" points="${toPts(diagB)}" />
    <g class="preview-layer"></g>
  `;
  previewLayer = linesEl.querySelector('.preview-layer');
  // 노드
  Object.keys(GRID).forEach(id => {
    id = Number(id);
    const [c, r] = GRID[id];
    const el = document.createElement('div');
    let cls = 'node';
    if (id === CENTER) cls += ' node--center';
    else if (BIG_NODES.has(id)) cls += ' node--big';
    el.className = cls;
    el.style.left = px(c) + '%';
    el.style.top = px(r) + '%';
    el.dataset.node = id;
    el.addEventListener('click', () => onNodeClick(id));
    boardEl.appendChild(el);
  });
}

function onNodeClick(nodeId) {
  // 현재 차례 소유자의 말이 있는 칸이면 이동
  const mine = tokensAt(state.turn, nodeId);
  if (mine.length) handleTokenClick(mine[0]);
}

/* ---------- 선택 가능한 이동 옵션 ---------- */
// 현재 차례 + 선택된 결과(value)로 만들 수 있는 이동 목록
function currentOptions(value) {
  if (value === null) return [];
  const owner = state.turn;
  const opts = [];
  // 판 위 말(칸별 그룹 1개 앵커)
  const seen = new Set();
  boardTokens(owner).forEach(t => {
    if (seen.has(t.node)) return;
    seen.add(t.node);
    if (!canUse(t, value)) return;
    const res = value === -1 ? computeBackdo(t) : computeForward(t, value);
    opts.push({ type: 'board', anchor: t, from: t.node, res, count: tokensAt(owner, t.node).length });
  });
  // 집에서 진입 (전진만)
  if (value > 0) {
    const homeTok = ownTokens(owner).find(t => t.node === null);
    if (homeTok) {
      opts.push({ type: 'home', anchor: homeTok, from: null, res: computeForward(homeTok, value), count: 1 });
    }
  }
  return opts;
}

// 목적지 고스트 마커 + 경로선 렌더
function renderOptions(value) {
  boardEl.querySelectorAll('.ghost').forEach(e => e.remove());
  if (previewLayer) previewLayer.innerHTML = '';
  if (value === null) return;

  const opts = currentOptions(value);
  const usedCell = {}; // 같은 칸에 옵션이 겹칠 때 오프셋

  opts.forEach(o => {
    const dest = o.res.node; // 'done' | number | null(백도로 집 복귀)

    // 경로선 (판 위 말 & 목적지가 칸일 때)
    if (o.type === 'board' && dest !== null && previewLayer) {
      const steps = value === -1 ? 1 : value;
      const tail = o.res.history.slice(-steps);
      const ids = [o.from, ...tail];
      const pts = ids.map(id => `${px(GRID[id][0])},${px(GRID[id][1])}`).join(' ');
      previewLayer.insertAdjacentHTML('beforeend', `<polyline class="path" points="${pts}" />`);
    }

    if (dest === null) return; // 백도로 집 복귀: 보드 고스트 없음(말 클릭으로 실행)

    const coordId = dest === 'done' ? 0 : dest;
    let [c, r] = GRID[coordId];
    const n = (usedCell[coordId] = (usedCell[coordId] || 0) + 1);
    if (n > 1) { c += 0.34 * (n - 1); r -= 0.34 * (n - 1); }

    const g = document.createElement('div');
    g.className = 'ghost ' + (dest === 'done' ? 'ghost--done' : 'ghost--' + PLAYERS[state.turn].cls);
    g.style.left = px(c) + '%';
    g.style.top = px(r) + '%';
    g.innerHTML = dest === 'done'
      ? '<span class="ghost__label">완주</span>'
      : (o.type === 'home' ? '<span class="ghost__label">입장</span>' : '<span class="ghost__dot"></span>');
    g.title = '이 위치로 이동';
    g.addEventListener('click', (e) => { e.stopPropagation(); applyMove(o.anchor, value); });
    boardEl.appendChild(g);
  });
}

// 선택된 결과에 맞는 안내 메시지
function optionMessage(value) {
  if (value === null) return null;
  const opts = currentOptions(value);
  if (opts.length === 0) {
    return `'${VAL_LABEL[value]}'(으)로 움직일 수 있는 말이 없어요. '선택 결과 버리기'를 누르세요.`;
  }
  return `'${VAL_LABEL[value]}' — 이동할 위치를 보드에서 선택하세요.`;
}

function render() {
  // 기존 토큰 제거
  boardEl.querySelectorAll('.token').forEach(e => e.remove());

  const value = state.selectedChip !== null ? state.chips[state.selectedChip] : null;

  // 칸별 소유자 그룹 렌더 (한 칸엔 한 소유자만 존재: 잡기 규칙)
  const occupied = {}; // nodeId -> tokens[]
  state.tokens.forEach(t => {
    if (typeof t.node === 'number') {
      (occupied[t.node] = occupied[t.node] || []).push(t);
    }
  });

  Object.keys(occupied).forEach(nodeId => {
    nodeId = Number(nodeId);
    const group = occupied[nodeId];
    const owner = group[0].owner;
    const [c, r] = GRID[nodeId];
    const el = document.createElement('div');
    el.className = `token token--${PLAYERS[owner].cls}`;
    el.style.left = px(c) + '%';
    el.style.top = px(r) + '%';
    if (group.length > 1) {
      el.innerHTML = `<span class="token__badge">×${group.length}</span>`;
    }
    // 이동 가능 강조
    if (owner === state.turn && value !== null && canUse(group[0], value)) {
      el.classList.add('token--movable');
      el.addEventListener('click', (e) => { e.stopPropagation(); handleTokenClick(group[0]); });
    }
    boardEl.appendChild(el);

    // 노드 강조
    const nodeEl = boardEl.querySelector(`.node[data-node="${nodeId}"]`);
    if (nodeEl) nodeEl.classList.toggle('node--movable',
      owner === state.turn && value !== null && canUse(group[0], value));
  });

  // 나머지 노드 강조 해제
  boardEl.querySelectorAll('.node').forEach(n => {
    if (!occupied[Number(n.dataset.node)]) n.classList.remove('node--movable');
  });

  // 이동 옵션(목적지 미리보기) 렌더
  renderOptions(value);

  renderPanel(value);
}

function renderPanel(value) {
  // 현재 차례 색을 전역 테마로 반영 (배너·보드·카드가 함께 사용)
  document.body.dataset.turn = state.turn;

  // 턴 배너
  const banner = document.getElementById('turn-banner');
  banner.className = `turn turn--${PLAYERS[state.turn].cls}`;
  document.getElementById('turn-player').textContent = PLAYERS[state.turn].name;

  // 점수 카드
  [0, 1].forEach(owner => {
    const card = document.getElementById('score-' + owner);
    const canEnter = owner === state.turn && value !== null && value > 0 && homeCount(owner) > 0;
    const homeDots = ownTokens(owner)
      .filter(t => t.node === null)
      .map((t, i) => {
        const cls = `home-dot home-dot--${PLAYERS[owner].cls}` +
          (canEnter ? ' home-dot--movable' : '');
        return `<span class="${cls}" data-home="${t.id}"></span>`;
      }).join('');
    const done = doneCount(owner);
    const finishSlots = Array.from({ length: TOKENS_PER_PLAYER }, (_, i) =>
      `<span class="finish-slot${i < done ? ' finish-slot--done' : ''}">${i < done ? '★' : '☆'}</span>`
    ).join('');
    const isTurn = owner === state.turn;
    card.className = 'score-card score-card--' + PLAYERS[owner].cls +
      (isTurn ? ' score-card--active' : ' score-card--inactive');
    card.innerHTML = `
      <div class="score-card__name">
        <span class="score-card__dot home-dot--${PLAYERS[owner].cls}"></span>${PLAYERS[owner].name}
        ${isTurn ? '<span class="score-card__turn">지금 차례</span>' : ''}
      </div>
      <div class="score-card__stats">
        <span><b>${homeCount(owner)}</b>대기</span>
        <span><b>${boardTokens(owner).length}</b>판 위</span>
        <span><b>${done}</b>완주</span>
      </div>
      <div class="finish-track">
        <span class="finish-track__label">완주</span>
        <span class="finish-track__slots">${finishSlots}</span>
        <span class="finish-track__count">${done} / ${TOKENS_PER_PLAYER}</span>
      </div>
      <div class="score-card__home" aria-label="대기 중인 말">${homeDots}</div>
    `;
    if (canEnter) {
      card.querySelectorAll('[data-home]').forEach(dot => {
        dot.addEventListener('click', () => {
          const tok = state.tokens.find(t => t.id === Number(dot.dataset.home));
          if (tok) handleTokenClick(tok);
        });
      });
    }
  });

  // chips
  const chipsEl = document.getElementById('chips');
  if (state.chips.length === 0) {
    chipsEl.innerHTML = '<span class="chips__empty">아직 입력된 결과가 없어요</span>';
  } else {
    chipsEl.innerHTML = '';
    state.chips.forEach((v, i) => {
      const chip = document.createElement('span');
      let cls = 'chip';
      if (i === state.selectedChip) cls += ' chip--selected';
      if (v === -1) cls += ' chip--back';
      if (v === 4 || v === 5) cls += ' chip--bonus';
      chip.className = cls;
      chip.textContent = VAL_LABEL[v];
      chip.addEventListener('click', () => selectChip(i));
      chipsEl.appendChild(chip);
    });
  }

  document.getElementById('btn-discard').disabled = state.selectedChip === null || state.locked;

  // 던지기 버튼: 남은 던질 권리가 있고 잠금 상태가 아닐 때만 활성
  const canThrow = !state.locked && state.winner === null && throwsOwed() > 0;
  document.querySelectorAll('.throw-btn').forEach(b => { b.disabled = !canThrow; });
  document.getElementById('btn-endturn').disabled = state.locked || state.winner !== null;
}

function setMessage(text, alert = false) {
  const el = document.getElementById('message');
  el.textContent = text;
  el.classList.toggle('message--alert', alert);
}

/* ---------- 승리 모달 ---------- */
function showWinner(owner) {
  document.getElementById('modal-title').textContent = `${PLAYERS[owner].name} 승리!`;
  document.getElementById('modal').hidden = false;
}
function hideWinner() {
  document.getElementById('modal').hidden = true;
}

/* ---------- 시작 설정(이름 입력) ---------- */
const DEFAULT_NAMES = ['플레이어 1', '플레이어 2'];

function showSetup() {
  hideWinner();
  // 현재 이름을 미리 채워 편집 가능하게
  document.getElementById('name-0').value = PLAYERS[0].name;
  document.getElementById('name-1').value = PLAYERS[1].name;
  document.getElementById('setup').hidden = false;
  const first = document.getElementById('name-0');
  first.focus();
  first.select();
}

function startGameFromSetup() {
  const n0 = document.getElementById('name-0').value.trim();
  const n1 = document.getElementById('name-1').value.trim();
  PLAYERS[0].name = n0 || DEFAULT_NAMES[0];
  PLAYERS[1].name = n1 || DEFAULT_NAMES[1];
  document.getElementById('setup').hidden = true;
  newGame();
}

/* ---------- 윷 막대 아이콘 ---------- */
// flat = 배(평평한 밝은 면)가 위로 향한 막대 수, backdo = 백도 표식 여부
function yutStickSVG(flat, backdo) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const x = 3 + i * 9;
    if (i < flat) {
      // 배(밝은 면) - 위로 향함
      parts.push(`<rect x="${x}" y="2" width="6" height="22" rx="3" fill="#f6ecd0" stroke="#c9a86a" stroke-width="0.9"/>`);
      if (backdo && i === 0) {
        // 백도 표식(X)
        parts.push(`<path d="M${x + 1.4} 8 L${x + 4.6} 18 M${x + 4.6} 8 L${x + 1.4} 18" stroke="#d63a53" stroke-width="1.2" stroke-linecap="round"/>`);
      }
    } else {
      // 등(둥근 면) - 어두운 나무
      parts.push(`<rect x="${x}" y="2" width="6" height="22" rx="3" fill="#b07d4b" stroke="#7a5a34" stroke-width="0.8"/>`);
      parts.push(`<rect x="${x + 1.6}" y="4.5" width="1.4" height="15" rx="0.7" fill="rgba(255,255,255,0.42)"/>`);
    }
  }
  return `<svg viewBox="0 0 39 26" class="yut-icon__svg" aria-hidden="true">${parts.join('')}</svg>`;
}

function decorateThrowButtons() {
  const map = {
    '-1': { flat: 1, backdo: true },
    '1': { flat: 1 }, '2': { flat: 2 }, '3': { flat: 3 },
    '4': { flat: 4 }, '5': { flat: 0 },
  };
  document.querySelectorAll('.throw-btn').forEach(btn => {
    const cfg = map[btn.dataset.val];
    if (!cfg) return;
    const icon = document.createElement('span');
    icon.className = 'yut-icon';
    icon.innerHTML = yutStickSVG(cfg.flat, !!cfg.backdo);
    btn.insertBefore(icon, btn.firstChild); // 텍스트 위에 아이콘
  });
}

/* ---------- 이벤트 바인딩 ---------- */
document.querySelectorAll('.throw-btn').forEach(btn => {
  btn.addEventListener('click', () => addChip(Number(btn.dataset.val)));
});
document.getElementById('btn-discard').addEventListener('click', discardSelected);
document.getElementById('btn-endturn').addEventListener('click', endTurn);
document.getElementById('btn-reset').addEventListener('click', showSetup);
document.getElementById('modal-restart').addEventListener('click', showSetup);

// 설정 화면
document.getElementById('setup-start').addEventListener('click', startGameFromSetup);
document.querySelectorAll('.setup__input').forEach(inp => {
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') startGameFromSetup(); });
});

/* ---------- 시작 ---------- */
buildBoard();
decorateThrowButtons();
newGame();
showSetup(); // 게임 시작 전 이름 입력
