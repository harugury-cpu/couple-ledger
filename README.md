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
cp .env.example .env
cp wrangler.example.jsonc wrangler.jsonc
npm run dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. 개발·운영 서버는 기본적으로 루프백 주소에만 바인딩합니다.

- 데이터는 `data/ledger.db`에 저장됩니다. 파일이 없으면 처음 실행할 때 초기 표가 만들어집니다.
- 저장 위치는 `LEDGER_DB_PATH` 환경변수로 바꿀 수 있습니다.
- `migrations/*.sql`이 저장 구조의 기준입니다. 로컬에서는 아직 적용하지 않은 마이그레이션만 순서대로 실행합니다.
- 설정 화면에서 JSON 전체 내보내기와 가져오기를 지원합니다. 가져오기는 현재 데이터를 교체하며, 교체 직전 백업을 `data/backups/`에 남깁니다.

이미 개인 설정 파일이 있는 환경에서는 예시 파일로 덮어쓰지 마세요.

## 주요 기능

- 월별 표: 예산과 금액 입력, 항목 편집, 행 추가·삭제·정렬, 수입·지출 집계.
- 월 승계: 아직 없는 달은 미리 보기로 보여 주고, 실제 수정 시 생성합니다. 미래 달에는 실사용 금액을 미리 채우지 않습니다.
- 예산·저축·잔액: 카테고리별 요약과 차트, 저축 누적, 계좌별 잔액과 이전 기록 비교.
- 특별 지출: 해당 월 항목 예산에서 차감하거나 저축 사용으로 기록합니다.
- 이체 묶음: 같은 이체 계좌의 항목을 묶어 이체 금액 대비 남은 돈을 표시합니다.
- 빠른 입력: 항목명과 원 단위 정수 금액을 입력하면 해당 월 항목에 더합니다.

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

Cloudflare Workers, D1, Access를 사용합니다. `wrangler.example.jsonc`를 로컬 `wrangler.jsonc`로 복사한 뒤 자신의 환경에 맞게 설정합니다.

1. Worker 이름과 `WORKER_SELF_REFERENCE` 서비스 이름을 일치시킵니다.
2. D1을 생성하고 `DB` 바인딩의 데이터베이스 이름과 ID를 지정합니다. 예시 ID는 실제 데이터베이스가 아닙니다.
3. Cloudflare Access 앱에서 접근 허용 대상을 설정합니다.
4. `ACCESS_TEAM_DOMAIN`과 `ACCESS_AUD`를 지정합니다. 설정 또는 Access 토큰이 없으면 앱은 접근을 거부합니다.
5. 필요한 기능의 비밀값을 서버에 등록하고 배포합니다.

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put INGEST_TOKEN
npm run deploy
```

`npm run deploy`는 `DB` 바인딩에 마이그레이션을 적용하고 OpenNext 빌드·배포를 수행합니다. 개인 운영 설정은 Git에서 제외되므로, 별도 CI를 연결한다면 해당 환경에도 설정과 비밀값을 직접 제공해야 합니다.

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
src/app/          화면 진입점과 API
src/components/   월별 표·예산·저축·잔액·설정 화면
src/db/           저장·월 승계·초기 데이터·저장소 어댑터
src/demo/         운영 DB와 분리된 가상 데모
src/lib/          계산·입력 검증·명세서·알림·백업
migrations/       SQL 마이그레이션
scripts/          공유용 데모 생성
tests/           단위 테스트
```

화면 규칙은 `DESIGN.md`, 제품 방향은 `PRODUCT.md`를 참고합니다.
