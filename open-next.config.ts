// OpenNext(Cloudflare) 설정. 모든 화면이 요청마다 그려지므로(force-dynamic) 페이지 캐시 저장소는 두지 않는다.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
