// 데모를 서버 없이 HTML 한 장으로 띄우는 진입점(scripts/build-demo-html.mjs가 묶는다).
import { createRoot } from 'react-dom/client';
import { DemoApp } from '../components/demo-app';
createRoot(document.getElementById('root')!).render(<DemoApp />);
