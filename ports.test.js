// ports.js 파싱 테스트: npm test (node --test 내장 테스트 러너 사용, 설치 필요 없음)
const test = require('node:test');
const assert = require('node:assert');
const { parseLsof, parseNetstat, parseTasklist } = require('./ports');

test('mac lsof: IPv4/IPv6 중복 제거, 주소/포트 분리, 공백 이름 복원', () => {
  const out = [
    'COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
    'java      12345 keartt   45u  IPv4 0x1111111111111111      0t0  TCP *:8080 (LISTEN)',
    'java      12345 keartt   46u  IPv6 0x2222222222222222      0t0  TCP *:8080 (LISTEN)',
    'postgres    700 keartt    7u  IPv6 0x3333333333333333      0t0  TCP [::1]:5432 (LISTEN)',
    'Code\\x20Helper 800 keartt 9u IPv4 0x4444444444444444      0t0  TCP 127.0.0.1:3000 (LISTEN)',
  ].join('\n');
  assert.deepStrictEqual(parseLsof(out), [
    { port: 8080, addr: '*', pid: 12345, name: 'java' },
    { port: 5432, addr: '[::1]', pid: 700, name: 'postgres' },
    { port: 3000, addr: '127.0.0.1', pid: 800, name: 'Code Helper' },
  ]);
});

test('Windows netstat + tasklist: 대기 중(상대 주소 :0)만, 이름 매칭, 한글 상태값도 처리', () => {
  const names = parseTasklist('"java.exe","12345","Console","1","123,456 K"\r\n"System","4","Services","0","100 K"\r\n');
  const out = [
    '',
    '활성 연결',
    '',
    '  프로토콜  로컬 주소              외부 주소              상태            PID',
    '  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       12345',
    '  TCP    [::]:8080              [::]:0                 LISTENING       12345',
    '  TCP    0.0.0.0:445            0.0.0.0:0              수신 대기       4',
    '  TCP    192.168.0.2:50000      142.250.1.1:443        ESTABLISHED     12345',
    '  UDP    0.0.0.0:5353           *:*                                    999',
  ].join('\r\n');
  assert.deepStrictEqual(parseNetstat(out, names), [
    { port: 8080, addr: '0.0.0.0', pid: 12345, name: 'java.exe' },
    { port: 8080, addr: '[::]', pid: 12345, name: 'java.exe' },
    { port: 445, addr: '0.0.0.0', pid: 4, name: 'System' },
  ]);
});
