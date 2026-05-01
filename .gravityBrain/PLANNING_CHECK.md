# 📋 기획 체크리스트 (PLANNING_CHECK.md)

## 📌 프로젝트: 코믹 딜 캐처 (Comic Deal Catcher) - 가칭
**목표**: 주요 3대 플랫폼(리디, 알라딘, 교보문고) 만화책 단행본 세트 할인 정보 일 2회 자동 수집 및 통합 뷰어 제공. (네이버 시리즈는 PC버전 한계로 우선 보류, 카카오페이지 제외)

### 1. 기획/설계 완료 검증
- [x] 타겟 플랫폼 분석 완료 (리디, 알라딘, 교보문고) 및 타겟 URL 확정
- [x] 스크래핑 차단 우회 전략 수립
- [x] 시스템 아키텍처 및 비용 제로화 방안 확정 (GitHub Actions + Vercel)
- [x] 통합 데이터 스키마 정의

### 2. MVP 개발 범위 체크리스트
#### Phase 1: 스크래퍼 (Backend/Data)
- [ ] 플랫폼별 API 엔드포인트 또는 DOM 파서 개발
  - [ ] 리디 파서 (Target: https://ridibooks.com/selection/748?section_id=748)
  - [ ] 알라딘 파서 (Target: https://www.aladin.co.kr/events/wevent.aspx?EventId=270007)
  - [ ] 교보문고 파서 (Target: https://event.kyobobook.co.kr/detail/239264)
  - [ ] 네이버 시리즈 파서 (보류 - PC버전 접근성 저하)
- [ ] 스크래핑 통합 엔진 (Playwright + Axios 혼합) 구축
- [ ] 정규화된 JSON 데이터 포맷 변환 로직
- [ ] GitHub Actions 1일 2회 스케줄러(Cron) 연동

#### Phase 2: 통합 뷰어 (Frontend)
- [ ] 프로젝트 세팅 (Next.js 또는 Vite + React)
- [ ] 다크/라이트 모드 지원 최신 UI/UX 디자인 적용
- [ ] 아이템 카드 컴포넌트 개발 (썸네일, 기존가/할인가, 할인율 배지)
- [ ] 플랫폼별 필터 및 정렬 기능 (할인율순, 최신순)
- [ ] 배포 (Vercel 연동)

### 3. 유지보수 및 예외 처리
- [ ] 스크래핑 실패 시 에러 로깅 (Discord Webhook 연동 고려)
- [ ] DOM/API 구조 변경 대비 유지보수 매뉴얼 정리
