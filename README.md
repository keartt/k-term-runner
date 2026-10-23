# k-term-runner

`java -jar` 같은 명령을 여러 개 띄워 두고, 로그를 쌓고 검색하는 앱. 포트 관리 포함. Windows / mac 공용.

## 기능

| 왼쪽 버튼 | 하는 일 |
|---|---|
| `🔌 포트 관리` (맨 위) | 열린(LISTEN) 포트 + PID + 프로세스 이름 목록, 검색, `종료` 로 강제 종료 ("8080 이미 사용 중" 해결) |
| `+ 명령 추가` (맨 아래) | `java -jar app.jar` 같은 명령을 등록 → ▶ 시작 / ■ 중지 / ↻ 재시작 |

명령 등록 항목: 이름, 명령, 작업 폴더, **로그 파일(경로 + 파일 이름)**, 출력 인코딩

공통
- **nohup 대용**: 창을 닫아도(X) 트레이에 남아 계속 실행. 진짜 종료는 트레이 메뉴 → 종료 (실행 중인 프로세스도 모두 중지)
- **로그 누적**: 출력은 명령별 로그 파일에 계속 쌓이고(이어 쓰기), 앱을 다시 켜도 이전 로그가 보인다
  - 등록할 때 로그 파일을 지정하면 그 경로에 쌓인다 (예: `D:\logs\api-server.log`, 폴더가 없으면 만든다)
  - 비워 두면 기본 위치: mac `~/Library/Application Support/k-term-runner/logs/`, Windows `%APPDATA%\k-term-runner\logs\`
  - 경로 변경은 다음 시작부터 적용. 명령을 삭제하면 기본 위치 로그는 지우고, 직접 지정한 로그 파일은 남겨 둔다
- **검색**: Ctrl/Cmd+F → 검색어가 들어간 줄만 표시 (grep 처럼). 포트 화면에서는 포트 검색
- **스크롤**: 맨 아래면 새 로그를 따라가고, 위로 올려 두면 그 자리에 멈춘다. 드래그 선택해도 프로세스가 멈추지 않는다
  (Windows 콘솔은 클릭/드래그 시 "빠른 편집 모드"로 출력이 막혀 java 까지 멈춤)
- 목록의 점: 초록 = 실행 중, 회색 = 중지

## 실행

```bash
npm install
npm start
npm test        # 포트 조회 결과 파싱 테스트 (mac lsof / Windows netstat)
```

확인
1. `+ 명령 추가` → 명령 `java -jar 내앱.jar`, 작업 폴더, 로그 파일 지정 → 저장 → `▶ 시작`
2. 로그가 올라오는지, 지정한 로그 파일에도 쌓이는지(`파일 열기`), 검색창에 `ERROR` 입력
3. `🔌 포트 관리` → 1번 앱의 포트가 보이는지 → `종료`

## 빌드

```bash
npm run make:mac   # → out/make/zip/darwin/arm64/k-term-runner-darwin-arm64-1.0.0.zip
npm run make:win   # → out/make/zip/win32/x64/k-term-runner-win32-x64-1.0.0.zip
```

## 아이콘 바꾸기

`assets/icon.svg`(앱), `assets/tray.svg`(mac 메뉴바) 를 고친 뒤 `npm run icons` → png / ico / icns 가 다시 만들어진다 (icns 는 mac 에서만).

## 알아둘 점

- **한글이 깨지면** (주로 한글 Windows): 수정 → 출력 인코딩을 `EUC-KR` 로.
  또는 명령에 `java -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -jar app.jar` (Java 18+)
- **중지**: mac 은 SIGTERM(스프링 graceful shutdown) → 안 죽으면 한 번 더 눌러 강제 종료. Windows 는 `taskkill /T /F` 로 바로 강제 종료.
  포트 관리의 `종료` 는 OS 모두 바로 강제 종료.
- **포트 목록**: mac 은 내 계정 프로세스만 보인다 (root 프로세스는 `sudo lsof` 필요). Windows 의 시스템 프로세스는 종료 권한이 없을 수 있다.
- mac 에서 Finder 로 실행한 앱은 PATH 가 짧아서, 시작할 때 로그인 쉘의 PATH 를 가져와 쓴다 (brew, sdkman java 등).
- 화면에는 최근 5만 줄만 들고 있다. 그 이전은 `파일 열기` 로 본다. 로그 파일은 자동으로 지워지지 않는다.
- 앱을 종료하면 프로세스도 같이 중지된다. 앱과 상관없이 계속 돌아야 하면 OS 서비스(mac launchd, Windows NSSM)를 써야 한다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `main.js` | 프로세스 실행/중지, 로그 기록, 트레이 |
| `ports.js` | 열린 포트 조회(lsof / netstat) 와 프로세스 종료 |
| `ports.test.js` | 포트 조회 결과 파싱 테스트 |
| `preload.js` | 화면에 노출할 API (`window.runner`) |
| `index.html`, `style.css`, `renderer.js` | 목록, 버튼, 로그 표시, 검색, 포트 표 |
| `assets/` | 아이콘 원본(svg), 생성 스크립트, 생성된 png/ico/icns |

## 참고

- 자식 프로세스: https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
- 파일 저장 창: https://www.electronjs.org/docs/latest/api/dialog#dialogshowsavedialogwindow-options
- 트레이 / Template 이미지: https://www.electronjs.org/docs/latest/api/tray , https://www.electronjs.org/docs/latest/api/native-image#template-image-macos
- 앱 아이콘(Forge): https://www.electronforge.io/guides/create-and-add-icons
- 단일 인스턴스: https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelock
