// 온라인 순위표 서버 (Supabase) 주소와 공개 열쇠
//   공개 열쇠(publishable / anon key)는 원래 게임 코드에 넣어 두는 열쇠라 공개돼도 괜찮음
//   (서버 쪽 규칙 .debug/supabase_setup.sql 이 "읽기 + 내 비밀 열쇠로 내 기록만 올리기"만 허락함)
//   비어 있으면 온라인 기능은 숨겨지고 게임은 예전처럼 브라우저 기록만 씀
export const ONLINE_URL = '';
export const ONLINE_KEY = '';
