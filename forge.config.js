// Electron Forge 설정 파일
// 공식 문서: https://www.electronforge.io/config/configuration
module.exports = {
  // packagerConfig: 앱을 실행 파일(.app / .exe)로 묶을 때 쓰는 옵션
  packagerConfig: {
    // true 면 소스 코드를 app.asar 한 파일로 묶는다 (배포용 기본값)
    asar: true,
    // 앱 아이콘. 확장자 없이 적으면 mac 은 icon.icns, Windows 는 icon.ico 를 알아서 고른다
    // (npm run icons 로 assets/icon.svg 에서 생성)
    icon: 'assets/icon',
  },
  // makers: 묶인 앱을 배포 파일로 만드는 도구 목록
  makers: [
    {
      // zip 으로 압축 → mac(.app), windows(.exe 폴더) 둘 다 mac 에서 바로 만들 수 있다
      // ponytail: 설치 프로그램(dmg, Setup.exe)이 필요하면 maker-dmg / maker-squirrel 추가
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
  ],
};
