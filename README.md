# 우리 가계부

월별 예산·지출·수입·저축·계좌 잔액을 관리하는 한국어 웹앱입니다. 달이 바뀌면 직전 달 표를 이어받고, 금액을 입력하면 소계와 요약이 함께 갱신됩니다.

## 공개 데이터 범위

- 초기 표의 예산은 모두 0입니다. 실제 가계부, 개인 재정 기록, 운영 설정은 포함하지 않습니다.
- `src/demo/demo-ledger.ts`와 테스트의 금액은 기능 검증을 위한 가상 데이터입니다.
- 데이터베이스와 백업은 `data/`에, 임시 산출물은 `_scratch/`에 저장되며 Git에서 제외됩니다.
- `.env`, `.dev.vars*`, `wrangler.jsonc`는 로컬 설정입니다. 예시 파일만 공개합니다.
- 저축 명의의 내부 식별자는 `a`와 `b`이고, 기본 표시 이름은 A와 B입니다.

## 로컬 실행

Node.js 26.5 이상이 필요합니다.

```bash
npm ci
cp -n .env.example .env
npm run dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. 개발 서버는 루프백 주소에만 바인딩합니다. `next dev`가 화면과 로컬 API를 함께 제공하므로 Cloudflare 설정 없이 개발할 수 있습니다.

- 데이터는 `data/ledger.db`에 저장됩니다. 파일이 없으면 처음 실행할 때 초기 표가 만들어집니다.
- 저장 위치는 `LEDGER_DB_PATH` 환경변수로 바꿀 수 있습니다.
- `migrations/*.sql`이 저장 구조의 기준입니다. 로컬에서는 아직 적용하지 않은 마이그레이션만 순서대로 실행합니다.
- 설정 화면에서 JSON 전체 내보내기와 가져오기를 지원합니다. 가져오기는 현재 데이터를 교체하며, 교체 직전 백업을 `data/backups/`에 남깁니다.
- `src/app/api/**/route.local.ts`는 개발 phase의 `pageExtensions`에서만 라우트로 인식합니다. 배포용 정적 빌드에는 API 라우트가 포함되지 않습니다.

이미 개인 설정 파일이 있는 환경에서는 예시 파일로 덮어쓰지 마세요.

## 주요 기능

- 월별 표: 예산과 금액 입력, 항목 편집, 행 추가·삭제·정렬, 수입·지출 집계.
- 월 승계: 아직 없는 달은 미리 보기로 보여 주고, 실제 수정 시 생성합니다. 미래 달에는 실사용 금액을 미리 채우지 않습니다.
- 예산·저축·잔액: 카테고리별 요약과 차트, 저축 누적, 계좌별 잔액과 이전 기록 비교.
- 이체 묶음: 같은 이체 계좌의 항목을 묶어 이체 금액 대비 남은 돈을 표시합니다.
- 표에서 바로 입력: 구역 맨 아래 빈 줄에 적으면 줄이 생기고, 수단 칸에 처음 적은 결제수단은 자동으로 추가됩니다.
- 줄 순서: 이름 칸 왼쪽 손잡이를 끌거나, 손잡이에서 위·아래 화살표로 같은 구역 안 순서를 바꿉니다.
- 합계 보기: 숫자 칸을 끌거나 Shift/⌘·Ctrl+클릭으로 여러 칸을 고르면 화면 아래에 합계와 평균이 뜹니다.

## 명세서 읽기

`.env`의 `GEMINI_API_KEY`를 설정하면 카드 명세서 캡처에서 날짜·가맹점·금액을 읽을 수 있습니다. 한 번에 최대 5장을 선택하고, 결과를 확인한 뒤 확정해야 저장됩니다. 이미 입력한 거래는 중복 후보로 표시합니다.

이 기능은 이미지를 Gemini API로 전송합니다. 이름·카드번호 등 불필요한 정보는 가린 뒤 사용하고, 해당 서비스의 데이터 처리 정책을 확인하세요. API 키는 클라이언트 코드나 Git에 넣지 않습니다.

## 카드 알림 수신

서버의 `INGEST_TOKEN`을 설정하고 `POST /api/ingest`로 알림을 보냅니다.

```text
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{"app":"카드 앱 이름","title":"알림 제목","text":"알림 본문"}
```

결제수단별 앱 문구·구분 문구·청구 기준·마감일은 설정 화면에서 지정합니다. 자동 분류가 어려운 알림은 미분류 목록에서 직접 연결하거나 버릴 수 있습니다. 토큰이 없거나 맞지 않으면 수신이 거부됩니다.

## Cloudflare 배포

Cloudflare Workers, D1, Access를 사용합니다. 화면은 `next build`의 정적 export 결과인 `out/`에서 제공하고, `/api/*`는 `worker.ts`가 공용 `handleApi`로 처리합니다. Worker에는 API와 그 의존성만 번들링됩니다.

```bash
cp -n wrangler.example.jsonc wrangler.jsonc
```

로컬 `wrangler.jsonc`를 자신의 환경에 맞게 설정합니다.

1. Worker 이름을 지정합니다. `main`은 `worker.ts`, `assets.directory`는 `out`으로 유지합니다.
2. D1을 생성하고 `DB` 바인딩의 데이터베이스 이름과 ID를 지정합니다. 예시 ID는 실제 데이터베이스가 아닙니다.
3. Cloudflare Access 앱에서 접근 허용 대상을 설정합니다.
4. `ACCESS_TEAM_DOMAIN`과 `ACCESS_AUD`를 지정합니다. 일반 API는 설정 또는 유효한 Access 토큰이 없으면 접근을 거부합니다. `/api/ingest`는 전송 토큰을 확인합니다.
5. 필요한 기능의 비밀값을 서버에 등록하고 배포합니다.

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put INGEST_TOKEN
npm run deploy
```

`npm run deploy`는 원격 `DB`에 마이그레이션을 적용하고 `next build` 후 `wrangler deploy`로 정적 파일과 API Worker를 배포합니다. 정적 파일은 Cloudflare 자산이 Worker보다 먼저 응답합니다. 자산에서 찾지 못한 `/api/*`는 API로 처리하고, 그 밖의 경로는 Worker가 404를 반환합니다. 화면 접근 제한은 Cloudflare Access 앱에서 설정하며, API의 Access 검증은 Worker가 수행합니다.

빌드 phase에만 `output: 'export'`를 적용합니다. `next start`는 사용하지 않으며, 배포 구조의 로컬 미리보기는 다음과 같습니다.

```bash
npx wrangler d1 migrations apply DB --local
npm run preview
```

`npm run preview`는 정적 빌드 후 `wrangler dev`를 실행합니다. 이때는 `data/ledger.db` 대신 Wrangler의 로컬 D1을 사용합니다. 비밀값은 `.dev.vars`에 설정하고, 일반 API 요청에는 유효한 Access 토큰이 필요합니다. 화면과 API를 함께 개발할 때는 `npm run dev`를 사용합니다.

개인 운영 설정은 Git에서 제외되므로, 별도 CI를 연결한다면 해당 환경에도 설정과 비밀값을 직접 제공해야 합니다.

## 공유용 가상 데모

```bash
node scripts/build-demo-html.mjs
```

`_scratch/demo-html/우리가계부-데모.html`에 서버 없이 열 수 있는 데모를 만듭니다. 브라우저 메모리의 SQLite에서 동작하고, 운영 DB와 연결되지 않으며 새로고침하면 초기화됩니다. 명세서 읽기·알림·백업처럼 서버가 필요한 기능은 데모에서 사용할 수 없습니다.

## 검증

```bash
npm test
npm run build
```

계산·월 승계·입력·잔액·특별 지출·알림·접근 제어·JSON 복원·공개용 초기 데이터 검증을 포함합니다.

## 구조

```text
worker.ts         배포용 API 전용 Worker
src/app/          정적 화면 진입점과 로컬 개발 전용 API
src/server/       공용 API 핸들러와 Next 연결 어댑터
src/components/   월별 표·예산·저축·잔액·설정 화면
src/db/           저장·월 승계·초기 데이터·저장소 어댑터
src/demo/         운영 DB와 분리된 가상 데모
src/lib/          계산·입력 검증·명세서·알림·백업
migrations/       SQL 마이그레이션
scripts/          공유용 데모 생성
tests/           단위 테스트
```

화면 규칙은 `DESIGN.md`, 제품 방향은 `PRODUCT.md`를 참고합니다.
