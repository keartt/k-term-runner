// 메인 프로세스: 등록된 명령(java -jar ...)을 자식 프로세스로 실행하고,
// 출력(stdout/stderr)을 로그 파일에 쌓으면서 화면(렌더러)으로도 보낸다.
// 그 밖에 포트 조회/종료를 담당한다.
// 창을 닫아도 트레이에 남아서 프로세스는 계속 돌아간다 (nohup 대용).
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ports = require('./ports');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// 사용자 데이터 폴더 (mac: ~/Library/Application Support/k-term-runner, win: %APPDATA%\k-term-runner)
const DATA_DIR = app.getPath('userData');
const CONFIG_FILE = path.join(DATA_DIR, 'processes.json'); // 등록한 항목 목록
const LOG_DIR = path.join(DATA_DIR, 'logs'); // 로그 파일 경로를 따로 지정하지 않은 명령의 로그 위치
fs.mkdirSync(LOG_DIR, { recursive: true });

// mac 에서 Finder/Dock 으로 실행한 앱은 PATH 가 /usr/bin:/bin 정도뿐이라
// brew, docker, sdkman 으로 깐 java 등을 못 찾는다 → 로그인 쉘의 PATH 를 가져와서 쓴다
if (IS_MAC) {
  const r = spawnSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'echo __PATH__$PATH'], { encoding: 'utf8', timeout: 5000 });
  const m = r.stdout && r.stdout.match(/__PATH__(.*)/);
  if (m) process.env.PATH = m[1].trim();
}

// 화면에 보낼 때 ANSI 색상 코드(ESC[...m)는 지운다 (터미널이 아니라서 깨져 보이므로)
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

const children = new Map(); // 실행 중인 프로세스: id → ChildProcess
let win = null;
let tray = null;
let quitting = false; // 진짜 종료 중인지 (아니면 창 닫기 = 숨기기)

// 명령의 로그 파일 경로: 등록할 때 지정했으면 그 경로, 아니면 기본 위치/<id>.log
const logFile = (p) => p.logFile || path.join(LOG_DIR, `${p.id}.log`);

// 창이 살아 있을 때만 렌더러로 메시지 전송
function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// 로그 한 덩어리를 파일에 덧붙이고 화면에도 보낸다
// ponytail: 매 출력마다 동기 append. 초당 수만 줄 수준이면 WriteStream 으로 교체
function writeLog(p, text) {
  fs.appendFileSync(logFile(p), text);
  send('log:data', { id: p.id, text });
}

// 파일의 start 위치부터 end 위치까지 읽는다
function readRange(file, start, end) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(end - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf;
}

// 로그 파일의 마지막 maxBytes 만 읽는다 (파일이 GB 단위로 커져도 앱이 느려지지 않게)
const TAIL_BYTES = 2 * 1024 * 1024;
function readTail(file) {
  try {
    const size = fs.statSync(file).size;
    return readRange(file, Math.max(0, size - TAIL_BYTES), size);
  } catch {
    return Buffer.alloc(0); // 아직 파일이 없음
  }
}

// ===== 프로세스 =====
// p = { id, name, cmd, cwd, encoding, logFile }
function start(p) {
  if (children.has(p.id)) return; // 이미 실행 중

  fs.mkdirSync(path.dirname(logFile(p)), { recursive: true }); // 지정한 로그 폴더가 없으면 만든다
  writeLog(p, `\n[k-term] ${new Date().toLocaleString()} 시작: ${p.cmd}\n`);

  // 작업 폴더가 없으면 spawn 이 "spawn /bin/sh ENOENT" 처럼 알아보기 힘든 에러를 내므로 먼저 알려 준다
  if (p.cwd && !fs.existsSync(p.cwd)) {
    writeLog(p, `[k-term] 실행 실패: 작업 폴더가 없습니다 → ${p.cwd}\n`);
    return;
  }

  const child = spawn(p.cmd, {
    cwd: p.cwd || undefined,
    shell: true, // "java -jar app.jar --옵션" 을 그대로 쓰기 위해 쉘로 실행
    windowsHide: true, // Windows 에서 검은 콘솔 창이 뜨지 않게
    stdio: ['ignore', 'pipe', 'pipe'], // 입력은 쓰지 않고 출력(stdout, stderr)만 받는다
    // mac/linux: 새 프로세스 그룹으로 만들어서, 중지할 때 쉘 + java 를 한 번에 죽인다
    detached: !IS_WIN,
  });
  children.set(p.id, child);
  send('proc:status', { id: p.id, running: true });

  // stdout, stderr 각각 디코더를 둔다 (한글이 바이트 중간에서 잘려 와도 stream 옵션이 이어 붙여 줌)
  // 한글 Windows 의 java 는 파이프로 출력할 때 MS949(euc-kr) 로 내보내는 경우가 많아 인코딩을 고를 수 있게 했다
  for (const stream of [child.stdout, child.stderr]) {
    const decoder = new TextDecoder(p.encoding || 'utf-8');
    stream.on('data', (buf) => writeLog(p, decoder.decode(buf, { stream: true }).replace(ANSI, '')));
  }

  // 실행 자체가 실패한 경우 (잘못된 작업 폴더 등)
  child.on('error', (err) => {
    children.delete(p.id);
    writeLog(p, `[k-term] 실행 실패: ${err.message}\n`);
    send('proc:status', { id: p.id, running: false });
  });

  // 프로세스가 끝난 경우 (정상 종료, 중지, 크래시 모두)
  child.on('exit', (code, signal) => {
    children.delete(p.id);
    writeLog(p, `[k-term] ${new Date().toLocaleString()} 종료 (code=${code}, signal=${signal})\n`);
    send('proc:status', { id: p.id, running: false });
  });
}

// 프로세스 중지
// 쉘로 띄웠기 때문에 child.kill() 만 하면 쉘만 죽고 java 는 남는다 → 자식까지 같이 죽인다
function stop(id) {
  const child = children.get(id);
  if (!child) return;
  if (IS_WIN) {
    // /T: 자식 프로세스까지, /F: 강제 종료
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    // 첫 번째는 SIGTERM (스프링 graceful shutdown), 안 죽어서 한 번 더 누르면 SIGKILL
    const signal = child.stopping ? 'SIGKILL' : 'SIGTERM';
    child.stopping = true;
    try {
      process.kill(-child.pid, signal); // 음수 pid = 프로세스 그룹 전체
    } catch {
      // 이미 죽은 경우
    }
  }
}

// ===== 렌더러(화면)에서 호출하는 IPC =====
ipcMain.handle('procs:list', () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return []; // 처음 실행
  }
});
ipcMain.handle('procs:save', (_e, procs) => fs.writeFileSync(CONFIG_FILE, JSON.stringify(procs, null, 2)));
ipcMain.handle('proc:running', () => [...children.keys()]);
ipcMain.handle('proc:start', (_e, p) => start(p));
ipcMain.handle('proc:stop', (_e, id) => stop(id));
ipcMain.handle('proc:restart', (_e, p) => {
  const child = children.get(p.id);
  if (!child) return start(p);
  child.once('exit', () => start(p)); // 완전히 종료된 뒤에 다시 시작 (포트 충돌 방지)
  stop(p.id);
});

// 앱을 다시 켰을 때 이전 로그를 보여주기 위해 파일 끝부분(2MB)을 읽는다
// 로그 관련은 명령 정보(p)를 받는다 (로그 파일 경로가 명령마다 다를 수 있으므로)
ipcMain.handle('log:read', (_e, p) => readTail(logFile(p)).toString('utf8'));
ipcMain.handle('log:clear', (_e, p) => fs.existsSync(logFile(p)) && fs.writeFileSync(logFile(p), ''));
ipcMain.handle('log:remove', (_e, p) => fs.rmSync(logFile(p), { force: true }));
// 전체 로그는 OS 기본 편집기로 연다 (화면에는 최근 일부만 들고 있으므로)
ipcMain.handle('log:open', (_e, p) => shell.openPath(logFile(p)));

ipcMain.handle('ports:list', () => ports.listPorts());
ipcMain.handle('ports:kill', (_e, pid) => ports.killPid(pid));

ipcMain.handle('dialog:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
// 로그 파일 경로 + 파일 이름 고르기 (저장 창이라 없는 파일 이름도 새로 적을 수 있다)
// mac 은 이미 있는 파일을 고르면 "대치할까요?" 를 묻지만, 실제로는 지우지 않고 뒤에 이어 쓴다
ipcMain.handle('dialog:pickLogFile', async (_e, defaultPath) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath,
    filters: [{ name: '로그', extensions: ['log', 'txt'] }],
  });
  return r.canceled ? null : r.filePath;
});

// ===== 창 / 트레이 =====
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'k-term-runner',
    icon: path.join(__dirname, 'assets', 'icon.png'), // Windows/Linux 개발 실행 시 창 아이콘 (빌드본은 .ico/.icns 사용)
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // 창 닫기(X) = 숨기기. 프로세스는 계속 실행된다. 진짜 종료는 트레이 메뉴에서
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  // mac 메뉴바: 파일 이름이 ...Template.png 이면 다크/라이트 모드에 맞춰 색이 자동으로 바뀐다
  // (@2x 파일이 있으면 레티나에서 자동 사용) / Windows 작업표시줄: 컬러 아이콘
  tray = new Tray(path.join(__dirname, 'assets', IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  tray.setToolTip('k-term-runner');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '열기', click: () => win.show() },
      { type: 'separator' },
      { label: '종료 (실행 중인 프로세스도 모두 중지)', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => win.show()); // Windows: 트레이 아이콘 왼쪽 클릭
}

// 앱을 두 번 실행하면 프로세스 관리가 꼬이므로 하나만 뜨게 한다
// 공식 문서: https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelock
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 두 번째 실행 시도 → 기존 창을 보여준다
  app.on('second-instance', () => win && win.show());

  app.whenReady().then(() => {
    // mac 개발 실행(npm start) 시 Dock 아이콘 (빌드본은 .icns 를 쓰므로 필요 없음)
    if (IS_MAC && !app.isPackaged) app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
    createWindow();
    createTray();
    app.on('activate', () => win.show()); // mac: Dock 아이콘 클릭
  });

  // 진짜 종료 (트레이 종료, mac Cmd+Q): 실행 중인 프로세스를 모두 중지
  // ponytail: 앱 종료 = 프로세스 종료. 앱 없이도 계속 돌아야 하면 OS 서비스(launchd, NSSM)로
  app.on('before-quit', () => {
    quitting = true;
    for (const id of children.keys()) stop(id);
  });
}
