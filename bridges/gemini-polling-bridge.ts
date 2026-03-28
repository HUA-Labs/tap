
import { existsSync, readFileSync, readdirSync, watch } from 'fs';
import { join, resolve } from 'path';

/**
 * Gemini Polling Bridge (Hui Runtime)
 * 
 * 역할을 수행한다:
 * 1. tap-comms inbox를 감시 (fs.watch + fallback polling)
 * 2. '휘' 혹은 'all' 대상 메시지 감지
 * 3. Windows 호환성 (stripBom, path.resolve) 처리
 * 4. 터미널 알림 (Bell) 및 로그 출력
 */

const COMMS_DIR = resolve(process.env.TAP_COMMS_DIR || 'D:/HUA/hua-comms');
const AGENT_NAME = process.env.TAP_AGENT_NAME || '휘';
const INBOX_DIR = resolve(COMMS_DIR, 'inbox');

console.log(`[Hui-Bridge] Monitoring inbox: ${INBOX_DIR} as agent: ${AGENT_NAME}`);

/**
 * UTF-8 BOM(Byte Order Mark) 제거 유틸리티
 */
function stripBom(content: string): string {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}

function parseFilename(filename: string) {
  // tap-comms.ts의 정규식 로직과 동기화
  const match = filename.match(/^\d{8}-(.+?)-(.+?)-(.+)\.md$/);
  if (match) {
    return { from: match[1], to: match[2], subject: match[3] };
  }

  const parts = filename.replace(/\.md$/, "").split("-");
  if (parts.length >= 4) {
    return {
      from: parts[1] || "?",
      to: parts[2] || "?",
      subject: parts.slice(3).join("-") || "?",
    };
  }
  return null;
}

function isForMe(to: string): boolean {
  return to === AGENT_NAME || to === "전체" || to === "all";
}

function handleNewMessage(filename: string) {
  if (!filename.toLowerCase().endsWith('.md')) return;
  
  const parsed = parseFilename(filename);
  if (!parsed) return;

  if (isForMe(parsed.to)) {
    if (parsed.from === AGENT_NAME) return; // 자가 수신 제외

    const fullPath = join(INBOX_DIR, filename);
    try {
      const rawContent = readFileSync(fullPath, 'utf-8');
      const content = stripBom(rawContent);
      
      console.log(`\n\x07[!] MESSAGE ARRIVED: ${parsed.from} -> ${parsed.to}`);
      console.log(`[Subject] ${parsed.subject}`);
      console.log(`[File] ${fullPath}`);
      console.log(`----------------------------------------`);
      console.log(content.slice(0, 200) + (content.length > 200 ? '...' : ''));
      console.log(`----------------------------------------\n`);
    } catch (err) {
      // 파일이 생성 중일 때 읽기 실패할 수 있음 (race condition 대비)
    }
  }
}

// 초기 인박스 스캔 (이미 온 메시지 확인)
if (existsSync(INBOX_DIR)) {
  readdirSync(INBOX_DIR).forEach(handleNewMessage);
  
  // 실시간 감시 시작
  watch(INBOX_DIR, (event, filename) => {
    if (event === 'rename' && filename) {
      handleNewMessage(filename);
    }
  });
} else {
  console.error(`[Error] Inbox directory not found: ${INBOX_DIR}`);
}

process.on('SIGINT', () => {
  console.log('[Hui-Bridge] Shutting down...');
  process.exit(0);
});
