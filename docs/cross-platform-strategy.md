# tap Cross-Platform Strategy

> 2026-03-22, Session 39 논의 결과

## 현황

| 레이어 | 크로스플랫폼 | 상태 |
|--------|------------|------|
| 파일 프로토콜 | ✅ | OS 무관 |
| tap-comms.ts | ✅ | Bun/Node |
| 폴링 (baseline) | ✅ | 크로스플랫폼 |
| fs.watch push | ⚠️ | macOS FSEvents/Linux inotify 검증 필요 |
| launcher/bridge/dashboard | ❌ | Windows-first (.ps1) |
| Codex/Gemini CLI | ✅ | 크로스플랫폼 |

## 전략

1. **Core = 크로스플랫폼 공식 지원**: tap-comms.ts + 폴링
2. **Launcher/ops = Windows reference**: Unix contributions welcome
3. **Split 후 확장**: launcher 분리 → thin wrapper → Unix wrapper 추가

## 순서 (하루 제안)

1. spec/runtime/exec 분리
2. Windows .ps1은 thin wrapper로 축소
3. 그 위에 Unix .sh 또는 .ts wrapper 추가

## 검증 필요

- macOS FSEvents: 이벤트 중복, 타이밍 차이
- Linux inotify: 동일
- 폴링은 push 실패해도 fallback으로 동작 (최소 기능 보장)

## 실행 체크리스트

- cross-platform smoke spec: [tap-runtime-validation-checklist.md](./tap-runtime-validation-checklist.md)
- launcher split phase 1: common + mission 해상 분리
- launcher split phase 2: runtime + exec 분리 후 thin wrapper 준비

## 공개 문구

> Windows launcher officially supported today. macOS/Linux — core protocol is cross-platform, launcher scripts need shell equivalents. Contributions welcome.

## 참고

- 데빈 M1 맥북 보유 → macOS 검증 가능
- dot도 같은 경로: Web → RN → Flutter → Swift/Compose
- Codex CLI: macOS 2026-02-02, Windows 2026-03-04 공개
- Gemini CLI: macOS/Linux/Windows 공식 지원
