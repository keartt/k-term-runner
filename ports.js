// 포트 관리: 지금 열려 있는(LISTEN) TCP 포트와 그 포트를 잡고 있는 프로세스를 조회하고 종료한다
// mac: lsof, Windows: netstat + tasklist 결과를 파싱한다 (OS 기본 명령이라 따로 설치할 것 없음)
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const IS_WIN = process.platform === 'win32';

// "127.0.0.1:8080", "*:8080", "[::1]:8080" → { addr, port }
function splitAddr(s) {
  const i = s.lastIndexOf(':');
  return { addr: s.slice(0, i), port: Number(s.slice(i + 1)) };
}

// mac lsof 출력 파싱
// COMMAND   PID   USER   FD   TYPE  DEVICE  SIZE/OFF  NODE  NAME
// java    12345 keartt   45u  IPv6  0x...       0t0   TCP   *:8080 (LISTEN)
function parseLsof(out) {
  const seen = new Map();
  for (const line of out.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 10) continue;
    const { addr, port } = splitAddr(cols[cols.length - 2]); // 마지막은 "(LISTEN)"
    const pid = Number(cols[1]);
    // 같은 포트가 IPv4 / IPv6 로 두 줄 나오는 경우가 많아서 pid+포트+주소로 중복 제거
    // lsof 는 이름 안의 공백을 \x20 으로 내보낸다
    seen.set(`${pid}:${port}:${addr}`, { port, addr, pid, name: cols[0].replace(/\\x20/g, ' ') });
  }
  return [...seen.values()];
}

// Windows tasklist /fo csv /nh 출력 파싱 → Map(pid → 프로세스 이름)
// "java.exe","12345","Console","1","123,456 K"
function parseTasklist(out) {
  const names = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^"([^"]*)","(\d+)"/);
    if (m) names.set(Number(m[2]), m[1]);
  }
  return names;
}

// Windows netstat -ano 출력 파싱
//   TCP    0.0.0.0:8080     0.0.0.0:0     LISTENING     12345
// 상태 글자(LISTENING)는 OS 언어에 따라 바뀔 수 있어서, 상대 주소가 ":0" 인 줄(= 대기 중)로 판단한다
function parseNetstat(out, names) {
  const seen = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+(\S+)\s+(\S+)\s+.*?(\d+)$/);
    if (!m || !m[2].endsWith(':0')) continue;
    const { addr, port } = splitAddr(m[1]);
    const pid = Number(m[3]);
    seen.set(`${pid}:${port}:${addr}`, { port, addr, pid, name: names.get(pid) ?? '?' });
  }
  return [...seen.values()];
}

// 열린 포트 목록 (포트 번호순)
async function listPorts() {
  let list;
  if (IS_WIN) {
    const [net, task] = await Promise.all([run('netstat', ['-ano']), run('tasklist', ['/fo', 'csv', '/nh'])]);
    list = parseNetstat(net.stdout, parseTasklist(task.stdout));
  } else {
    // -nP: 이름 변환 없이 숫자로(빠름), +c 0: 프로세스 이름을 자르지 않음
    // 열린 포트가 하나도 없으면 lsof 는 종료 코드 1 을 내므로 그 경우는 빈 목록으로 본다
    const out = await run('lsof', ['-nP', '+c', '0', '-iTCP', '-sTCP:LISTEN'], { maxBuffer: 10 * 1024 * 1024 }).catch((e) =>
      e.code === 1 ? { stdout: '' } : Promise.reject(e),
    );
    list = parseLsof(out.stdout);
  }
  return list.sort((a, b) => a.port - b.port || a.pid - b.pid);
}

// 프로세스 강제 종료 (포트를 비우는 게 목적이라 바로 강제 종료한다)
// 실패하면 에러 메시지를, 성공하면 null 을 돌려준다
function killPid(pid) {
  if (IS_WIN) {
    const r = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { encoding: 'utf8' });
    return r.status === 0 ? null : (r.stderr || r.stdout).trim();
  }
  try {
    process.kill(pid, 'SIGKILL');
    return null;
  } catch (e) {
    // EPERM: 다른 사용자(root 등)의 프로세스라 권한 없음
    return e.code === 'EPERM' ? '권한이 없습니다 (다른 사용자/관리자 프로세스)' : e.message;
  }
}

module.exports = { listPorts, killPid, parseLsof, parseNetstat, parseTasklist };
