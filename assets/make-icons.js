// 아이콘 생성 스크립트: icon.svg / tray.svg → 앱/트레이에 필요한 PNG, ICO, ICNS
// 실행: npm run icons   (SVG 를 고친 뒤 다시 실행하면 된다)
//
// 만드는 파일
//   icon.png                 1024px 원본 (개발 실행 시 Dock/창 아이콘)
//   icon.ico                 Windows 실행 파일 아이콘 (여러 크기 PNG 를 한 파일에)
//   icon.icns                mac 앱 아이콘 (mac 의 iconutil 로 생성 → mac 에서만 만들어짐)
//   tray.png                 Windows 트레이 (컬러)
//   trayTemplate(@2x).png    mac 메뉴바 (검정, 다크/라이트 자동)
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = __dirname;

// SVG 를 size x size PNG(nativeImage)로 그린다
// offscreen 창은 화면 배율이 1 이라서 레티나에서도 정확히 size 픽셀로 캡처된다
async function render(svgFile, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  const svg = fs.readFileSync(path.join(DIR, svgFile), 'utf8');
  const html = `<body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const img = await win.webContents.capturePage();
  win.destroy();
  return img.resize({ width: size, height: size });
}

// ICO 파일 = 헤더(6바이트) + 크기별 목록(16바이트씩) + PNG 데이터들
function writeIco(file, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // 예약
  header.writeUInt16LE(1, 2); // 1 = 아이콘
  header.writeUInt16LE(pngs.length, 4); // 이미지 개수
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 너비 (256 은 0 으로 적는 규칙)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // 높이
    e.writeUInt16LE(1, 4); // 색상 평면
    e.writeUInt16LE(32, 6); // 픽셀당 비트
    e.writeUInt32LE(data.length, 8); // 데이터 크기
    e.writeUInt32LE(offset, 12); // 데이터 위치
    offset += data.length;
    return e;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));
}

// 그릴 때마다 창을 닫는데, 기본 동작(모든 창이 닫히면 앱 종료)으로 중간에 꺼지지 않게 막는다
app.on('window-all-closed', () => {});

app.whenReady().then(main).catch((e) => {
  console.error(e);
  app.exit(1);
});

async function main() {
  const big = await render('icon.svg', 1024);
  fs.writeFileSync(path.join(DIR, 'icon.png'), big.toPNG());
  // 작은 크기는 SVG 에서 직접 다시 그려야 선이 또렷하다
  const png = async (size) => (await render('icon.svg', size)).toPNG();

  // Windows .ico
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  // 창을 동시에 여러 개 띄우면 로드가 실패할 수 있어서 한 장씩 순서대로 그린다
  const icoPngs = [];
  for (const size of icoSizes) icoPngs.push({ size, data: await png(size) });
  writeIco(path.join(DIR, 'icon.ico'), icoPngs);

  // Windows 트레이 (컬러, 32px 을 Electron 이 알아서 줄여 씀)
  fs.writeFileSync(path.join(DIR, 'tray.png'), await png(32));

  // mac 메뉴바 Template 이미지 (16px + 레티나용 32px)
  fs.writeFileSync(path.join(DIR, 'trayTemplate.png'), (await render('tray.svg', 16)).toPNG());
  fs.writeFileSync(path.join(DIR, 'trayTemplate@2x.png'), (await render('tray.svg', 32)).toPNG());

  // mac .icns: 정해진 이름의 PNG 들을 .iconset 폴더에 넣고 iconutil 로 묶는다
  if (process.platform === 'darwin') {
    const set = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-')) + '/icon.iconset';
    fs.mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
      fs.writeFileSync(`${set}/icon_${s}x${s}.png`, await png(s));
      fs.writeFileSync(`${set}/icon_${s}x${s}@2x.png`, await png(s * 2));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(DIR, 'icon.icns')]);
  } else {
    console.log('icon.icns 는 mac 에서만 만들 수 있어 건너뜀');
  }

  console.log('아이콘 생성 완료:', fs.readdirSync(DIR).filter((f) => /\.(png|ico|icns)$/.test(f)).join(', '));
  app.quit();
}
