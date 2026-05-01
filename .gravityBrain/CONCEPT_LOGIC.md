# 🧠 개념 로직 정립 (CONCEPT_LOGIC.md)

## 1. 코어 파이프라인 (Data Flow)
1. **Trigger**: GitHub Actions Scheduler (03:00, 15:00 KST) 작동
2. **Execute Scraper**: `npm run scrape`
3. **Fetch/Crawl Phase**:
   - `fetchRidi()` -> URL 파싱 또는 API
   - `fetchAladin()` -> HTML Cheerio Parse
   - `fetchKyobo()` -> HTML Cheerio Parse
   - `fetchNaverSeries()` -> (우선 보류)
4. **Normalize Phase**: 수집된 Raw Data를 `ComicDeal` 인터페이스로 변환
5. **Merge & Save**: 배열 취합 후 `data/deals.json` 으로 저장
6. **Deploy Trigger**: 데이터 변경 시 Vercel 연동으로 프론트엔드 자동 업데이트

## 2. 공통 데이터 스키마 (ComicDeal Model)
```typescript
interface ComicDeal {
  id: string;              // 고유 ID (플랫폼 식별자 + 자체 ID)
  platform: 'RIDI' | 'ALADIN' | 'KYOBO' | 'NAVER';
  title: string;           // 작품명
  originalPrice: number;   // 기존 정가
  discountPrice: number;   // 할인가
  discountRate: number;    // 할인율 (0~100)
  thumbnailUrl: string;    // 표지 이미지 링크
  itemUrl: string;         // 상세/구매 페이지 링크
  updatedAt: string;       // 정보 갱신 시간 (ISO 8601)
}
```

## 3. 모듈별 책임(Responsibility)
- **Scraper Factory**: 각 플랫폼별 파싱 로직 캡슐화. 공통 인터페이스를 구현하여 코드 파편화 방지.
- **Frontend Filter Hook**: 플랫폼별 필터링, 할인율 순 정렬 등 뷰어 로직.
