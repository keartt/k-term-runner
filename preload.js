// preload: 렌더러(화면)에서 쓸 기능만 window.runner 로 노출한다
// 공식 문서: https://www.electronjs.org/docs/latest/tutorial/ipc
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('runner', {
  // 등록 목록 읽기 / 저장
  list: () => ipcRenderer.invoke('procs:list'),
  save: (procs) => ipcRenderer.invoke('procs:save', procs),
  // 실행 중인 id 목록 (화면을 새로 열었을 때 상태 복원용)
  running: () => ipcRenderer.invoke('proc:running'),
  // 프로세스 제어
  start: (p) => ipcRenderer.invoke('proc:start', p),
  stop: (id) => ipcRenderer.invoke('proc:stop', id),
  restart: (p) => ipcRenderer.invoke('proc:restart', p),
  // 로그 파일 (명령마다 경로가 다를 수 있어서 명령 정보 p 를 넘긴다)
  readLog: (p) => ipcRenderer.invoke('log:read', p),
  clearLog: (p) => ipcRenderer.invoke('log:clear', p),
  removeLog: (p) => ipcRenderer.invoke('log:remove', p),
  openLog: (p) => ipcRenderer.invoke('log:open', p), // OS 기본 프로그램으로 열기
  // 포트
  ports: () => ipcRenderer.invoke('ports:list'),
  killPid: (pid) => ipcRenderer.invoke('ports:kill', pid),
  // 폴더 / 파일 선택 창
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  pickLogFile: (defaultPath) => ipcRenderer.invoke('dialog:pickLogFile', defaultPath),
  // 메인 → 렌더러 이벤트: 새 로그, 실행 상태 변경
  onLog: (cb) => ipcRenderer.on('log:data', (_e, d) => cb(d)),
  onStatus: (cb) => ipcRenderer.on('proc:status', (_e, d) => cb(d)),
});
