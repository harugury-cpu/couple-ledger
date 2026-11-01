// 화면에서 API를 부를 때 쓰는 공통 요청 함수.
// Cloudflare가 요청을 중간에 끊으면(CPU 한도 초과 등) JSON 대신 HTML 오류 페이지가 온다.
// 그 경우 브라우저 파싱 에러 대신 한국어 안내를 보여 주고, 안전한 요청은 한 번 더 보낸다.
const SERVER_BUSY = '서버가 잠깐 응답하지 못했습니다. 잠시 뒤 다시 시도하세요.';
const OFFLINE = '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.';

// retry: 같은 결과를 보장할 때만(조회, 작업 번호가 붙은 저장) 1 이상으로 준다.
export async function fetchJson<T = Record<string, unknown>>(input: string, init?: RequestInit, retry = 0): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retry;
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (e) {
      if (init?.signal?.aborted) throw e;
      if (!last) { await wait(attempt); continue; }
      throw new Error(OFFLINE);
    }
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      const body = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(body.error || SERVER_BUSY);
      return body;
    }
    if (!last) { await wait(attempt); continue; }
    throw new Error(SERVER_BUSY);
  }
}

const wait = (attempt: number) => new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
