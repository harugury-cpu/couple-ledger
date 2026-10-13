// sql.js의 asm.js 빌드(wasm 파일 없이 동작)는 기본 진입점과 같은 모양이다.
declare module 'sql.js/dist/sql-asm.js' {
  import initSqlJs from 'sql.js';
  export default initSqlJs;
}
