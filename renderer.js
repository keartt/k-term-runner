// 렌더러: 목록 / 버튼 / 로그 표시 / 검색 / 포트 화면 담당 (preload 의 window.runner 만 사용)
//
// 왼쪽 목록의 명령: { id, name, cmd, cwd, encoding, logFile }
//   logFile 이 비어 있으면 앱 데이터 폴더/logs/<id>.log 에 쌓인다

// 화면에 들고 있는 최대 줄 수. 넘치면 오래된 줄부터 버린다 (전체는 로그 파일에 있음)
const MAX_LINES = 50000;

let procs = []; // 등록 목록
let running = new Set(); // 실행 중인 id
const logs = new Map(); // id → { lines: [완성된 줄], partial: '아직 줄바꿈이 안 온 마지막 조각' }
let currentId = null; // 지금 보고 있는 명령
let query = ''; // 검색어 (소문자)
let editingId = null; // 수정 중인 id (null 이면 새로 추가)
let shownCount = 0; // 지금 로그창에 보이는 줄 수 (검색 결과 개수 표시용)

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const current = () => procs.find((p) => p.id === currentId);
const matches = (line) => line.toLowerCase().includes(query);

// 들어온 텍스트를 줄 단위로 쪼개서 저장. 새로 완성된 줄 목록을 돌려준다
function pushText(id, text) {
  if (!logs.has(id)) logs.set(id, { lines: [], partial: '' });
  const log = logs.get(id);
  const parts = (log.partial + text).split(/\r?\n/);
  log.partial = parts.pop(); // 마지막 조각은 줄이 아직 안 끝났을 수 있으니 보관
  for (const line of parts) log.lines.push(line);
  // 한도의 1.2배를 넘을 때만 한 번에 잘라낸다 (매번 자르면 매번 전체 다시 그리기가 돼서 느림)
  const trimmed = log.lines.length > MAX_LINES * 1.2;
  if (trimmed) log.lines.splice(0, log.lines.length - MAX_LINES);
  return { added: parts, trimmed };
}

// 로그 파일을 다시 읽어서 화면용 로그를 새로 채운다 (앱 시작, 로그 파일 경로 변경 시)
async function loadLog(p) {
  logs.delete(p.id);
  pushText(p.id, await runner.readLog(p));
}

// 로그창이 맨 아래에 붙어 있는지 (사용자가 위로 스크롤해서 보는 중이면 false)
const atBottom = () => logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 5;

// 현재 명령의 로그를 처음부터 다시 그린다 (탭 전환, 검색어 변경 시)
function renderLog() {
  const log = logs.get(currentId);
  const all = log ? log.lines : [];
  const shown = query ? all.filter(matches) : all;
  // textContent 로 넣어야 로그 안의 <태그> 가 HTML 로 해석되지 않는다
  logEl.textContent = shown.length ? shown.join('\n') + '\n' : '';
  shownCount = shown.length;
  updateCount();
  logEl.scrollTop = logEl.scrollHeight;
}

// 줄 수 표시: 검색 중이면 "일치 / 전체"
function updateCount() {
  const total = logs.get(currentId)?.lines.length ?? 0;
  $('count').textContent = query ? `${shownCount} / ${total}줄` : `${total}줄`;
}

// 새 줄만 뒤에 덧붙인다. 위로 스크롤해서 보는 중이면 화면을 움직이지 않는다
// (덧붙이기만 하므로 드래그로 선택해 둔 영역도 풀리지 않는다)
function appendLog(lines) {
  const stick = atBottom();
  const shown = query ? lines.filter(matches) : lines;
  if (shown.length) logEl.append(shown.join('\n') + '\n');
  shownCount += shown.length;
  updateCount();
  if (stick) logEl.scrollTop = logEl.scrollHeight;
}

// 왼쪽 목록 + 버튼 활성/비활성 갱신
function renderList() {
  $('list').replaceChildren(
    ...procs.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.name;
      li.title = p.cmd;
      li.classList.toggle('active', p.id === currentId);
      li.classList.toggle('running', running.has(p.id));
      li.onclick = () => select(p.id);
      return li;
    }),
  );
  $('portsBtn').classList.toggle('active', !$('portView').hidden);

  const p = current();
  const isRunning = !!p && running.has(p.id);
  $('title').textContent = p ? `${p.name} — ${p.cmd}` : '왼쪽에서 명령을 추가하세요';
  $('start').disabled = !p || isRunning;
  $('stop').disabled = !isRunning;
  $('restart').disabled = !p;
  $('edit').disabled = !p;
  $('remove').disabled = !p || isRunning; // 실행 중에는 삭제 불가
  $('openLog').disabled = !p;
  $('clearLog').disabled = !p;
}

// 왼쪽에서 명령 선택 → 로그 화면
function select(id) {
  currentId = id;
  $('logView').hidden = false;
  $('portView').hidden = true;
  renderList();
  renderLog();
}

// ===== 로그 화면 버튼 =====
$('start').onclick = () => runner.start(current());
$('stop').onclick = () => runner.stop(currentId);
$('restart').onclick = () => runner.restart(current());
$('openLog').onclick = () => runner.openLog(current());
$('clearLog').onclick = async () => {
  await runner.clearLog(current());
  logs.set(currentId, { lines: [], partial: '' });
  renderLog();
};
$('remove').onclick = async () => {
  const p = current();
  // 로그 파일 경로를 직접 지정한 경우는 사용자가 관리하는 파일이라 지우지 않는다
  const msg = p.logFile
    ? `'${p.name}' 을(를) 삭제할까요? (로그 파일 ${p.logFile} 은 남겨 둡니다)`
    : `'${p.name}' 을(를) 삭제할까요? 로그 파일도 지워집니다.`;
  if (!confirm(msg)) return;
  if (!p.logFile) await runner.removeLog(p);
  logs.delete(p.id);
  procs = procs.filter((x) => x.id !== p.id);
  await runner.save(procs);
  select(procs[0]?.id ?? null);
};

// ===== 검색 =====
// 입력이 멈추고 150ms 뒤에 필터링 (긴 로그에서 글자마다 다시 그리면 버벅임)
let searchTimer;
$('search').oninput = (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = e.target.value.toLowerCase();
    renderLog();
  }, 150);
};
// Ctrl+F (Windows) / Cmd+F (mac) → 지금 화면의 검색창으로
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    $($('portView').hidden ? 'search' : 'portSearch').select();
  }
});

// ===== 포트 관리 화면 =====
let portList = [];

async function loadPorts() {
  $('portRows').replaceChildren(row(['조회 중...']));
  try {
    portList = await runner.ports();
  } catch (e) {
    portList = [];
    $('portRows').replaceChildren(row([`조회 실패: ${e.message}`]));
    return;
  }
  renderPorts();
}

// 표의 한 줄 만들기 (값은 textContent 로 넣어서 HTML 로 해석되지 않게)
function row(cells) {
  const tr = document.createElement('tr');
  for (const c of cells) {
    const td = document.createElement('td');
    if (c instanceof Node) td.append(c);
    else td.textContent = c;
    if (cells.length === 1) td.colSpan = 5; // 안내 문구 한 칸짜리 줄은 표 전체 폭으로
    tr.append(td);
  }
  return tr;
}

function renderPorts() {
  const q = $('portSearch').value.trim().toLowerCase();
  const shown = portList.filter((p) => !q || `${p.port} ${p.pid} ${p.name} ${p.addr}`.toLowerCase().includes(q));
  $('portRows').replaceChildren(
    ...shown.map((p) => {
      const kill = document.createElement('button');
      kill.textContent = '종료';
      kill.className = 'danger';
      kill.onclick = async () => {
        if (!confirm(`${p.port} 포트의 ${p.name} (PID ${p.pid}) 를 강제 종료할까요?`)) return;
        const err = await runner.killPid(p.pid);
        if (err) alert(`종료 실패: ${err}`);
        loadPorts();
      };
      return row([p.port, p.addr, p.pid, p.name, kill]);
    }),
  );
  if (!shown.length) $('portRows').replaceChildren(row([q ? '일치하는 포트가 없습니다' : '열린 포트가 없습니다']));
}

$('portsBtn').onclick = () => {
  currentId = null;
  $('logView').hidden = true;
  $('portView').hidden = false;
  renderList();
  loadPorts();
};
$('portRefresh').onclick = loadPorts;
$('portSearch').oninput = renderPorts;

// ===== 추가 / 수정 창 =====
// form.name 은 폼 자체의 name 속성이라 입력칸은 form.elements 로 꺼낸다
const form = $('form').querySelector('form').elements;
function openForm(p) {
  editingId = p ? p.id : null;
  form.name.value = p?.name ?? '';
  form.cmd.value = p?.cmd ?? '';
  form.cwd.value = p?.cwd ?? '';
  form.logFile.value = p?.logFile ?? '';
  form.encoding.value = p?.encoding ?? 'utf-8';
  $('form').showModal();
}
$('add').onclick = () => openForm(null);
$('edit').onclick = () => openForm(current()); // 수정 내용은 다음 시작부터 적용
$('pickDir').onclick = async () => {
  const dir = await runner.pickDir();
  if (dir) form.cwd.value = dir;
};
// 로그 파일 찾기: 입력된 값 → 작업 폴더/이름.log 순으로 기본 위치를 잡아 준다
$('pickLog').onclick = async () => {
  const name = `${form.name.value.trim() || 'app'}.log`;
  const def = form.logFile.value.trim() || (form.cwd.value.trim() ? `${form.cwd.value.trim()}/${name}` : name);
  const file = await runner.pickLogFile(def);
  if (file) form.logFile.value = file;
};
// dialog 가 닫히면 어떤 버튼으로 닫혔는지(returnValue) 보고 저장
$('form').addEventListener('close', async () => {
  if ($('form').returnValue !== 'save') return;
  const data = {
    name: form.name.value.trim(),
    cmd: form.cmd.value.trim(),
    cwd: form.cwd.value.trim(),
    logFile: form.logFile.value.trim(),
    encoding: form.encoding.value,
  };

  let p;
  if (editingId) {
    p = procs.find((x) => x.id === editingId);
    const logChanged = p.logFile !== data.logFile;
    Object.assign(p, data);
    // 로그 파일 경로를 바꿨으면 새 파일 내용으로 화면을 다시 채운다
    // (실행 중이면 지금 프로세스는 이전 파일에 계속 쓰므로, 재시작 후에 반영)
    if (logChanged && !running.has(p.id)) await loadLog(p);
  } else {
    p = { id: Date.now().toString(36), ...data }; // id 는 기본 로그 파일 이름으로도 쓰인다
    procs.push(p);
    await loadLog(p); // 이미 있는 로그 파일을 지정했으면 그 내용이 바로 보인다
  }
  await runner.save(procs);
  select(p.id);
});

// ===== 시작 =====
async function init() {
  procs = await runner.list();
  running = new Set(await runner.running());
  // 앱을 다시 켜도 이전 로그가 보이도록 로그 파일 끝부분을 불러온다
  for (const p of procs) await loadLog(p);

  // ponytail: 위에서 파일을 읽는 사이에 들어온 로그 몇 줄은 화면에서 빠질 수 있음 (파일에는 남아 있음)
  runner.onLog(({ id, text }) => {
    const { added, trimmed } = pushText(id, text);
    if (id !== currentId) return; // 안 보고 있는 명령은 저장만
    trimmed ? renderLog() : appendLog(added);
  });
  runner.onStatus(({ id, running: on }) => {
    on ? running.add(id) : running.delete(id);
    renderList();
  });

  select(procs[0]?.id ?? null);
}
init();
