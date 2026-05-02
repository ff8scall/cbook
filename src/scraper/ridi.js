import { chromium } from 'playwright';
import { normalize } from '../utils/normalization.js';
import { sendTelegramAlert } from '../utils/notifier.js';
import { getAladinBookInfo } from '../utils/aladinApi.js';

export async function scrapeRidi() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  const allBooks = [];
  
  try {
    // 0. 메인 페이지에서 타겟 URL 탐색
    console.log('[RIDI] Discovering target URLs from comics/ebook page...');
    await page.goto('https://ridibooks.com/comics/ebook', { waitUntil: 'networkidle' });
    
    const targets = await page.evaluate(() => {
      const getHref = (label) => {
        const el = document.querySelector(`a[aria-label="${label}"]`);
        return el ? el.href : null;
      };
      return {
        discount50: getHref('50%할인'),
        lowestSet: getHref('최저가 세트')
      };
    });

    console.log('[RIDI] Discovered:', targets);

    // 1. 최저가 세트 (필수)
    if (targets.lowestSet) {
      console.log(`[RIDI] Scraping Selection page: ${targets.lowestSet}`);
      // 기존 로직은 URL에서 ID를 추출하거나 직접 URL을 사용하여 페이징 처리
      const baseUrl = targets.lowestSet.split('?')[0];
      const sectionIdMatch = targets.lowestSet.match(/section_id=(\d+)/);
      const sectionId = sectionIdMatch ? sectionIdMatch[1] : '';

      for (let p = 1; p <= 17; p++) {
        const url = `${baseUrl}?section_id=${sectionId}&page=${p}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        
        // 페이지당 60개 항목이 로드될 때까지 스크롤 반복
        let prevCount = 0;
        for (let i = 0; i < 15; i++) {
          await page.evaluate(() => window.scrollBy(0, 1500));
          await page.waitForTimeout(600);
          const currentCount = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('li')).filter(el => el.innerText.includes('원')).length;
          });
          if (currentCount >= 60) break;
          if (currentCount > 0 && currentCount === prevCount && i > 5) break; 
          prevCount = currentCount;
        }
        
        const pageBooks = await scrapeRidiListPage(page);
        if (pageBooks.length === 0) break;
        
        for (const b of pageBooks) {
          if (!allBooks.find(existing => existing.id === b.id)) {
            // 정가 및 이미지 보정: 알라딘 API 우선 시도
            if (b.isSet || b.title.includes('세트') || b.title.includes('합본')) {
              const apiInfo = await getAladinBookInfo(b.apiTitle || b.title, b.author);
              const apiPrice = apiInfo.price;
              
              if (apiPrice > 0) {
                const apiRate = 1 - b.discountPrice / apiPrice;
                if (apiRate > 0.41 && b.discountRate > 0) {
                  const reversePrice = Math.round(b.discountPrice / (1 - b.discountRate / 100) / 100) * 100;
                  b.originalPrice = reversePrice;
                } else {
                  b.originalPrice = apiPrice;
                }
                
                // 이미지가 누락된 경우 알라딘 이미지 사용
                if (!b.thumbnailUrl || b.thumbnailUrl.includes('placeholder')) {
                  b.thumbnailUrl = apiInfo.cover;
                }
              } else if (b.discountRate > 0) {
                b.originalPrice = Math.round(b.discountPrice / (1 - b.discountRate / 100) / 100) * 100;
              }
            }
            allBooks.push(b);
          }
        }
        console.log(`[RIDI] Selection page ${p}: Found ${pageBooks.length} items. Total: ${allBooks.length}`);
      }
    } else {
      console.error('[RIDI] "최저가 세트" link not found!');
      await sendTelegramAlert('리디북스 "최저가 세트" 링크를 찾을 수 없습니다. 페이지 구조를 확인해주세요.');
    }

    // 2. 50% 할인 이벤트 (선택)
    if (targets.discount50) {
      console.log(`[RIDI] Scraping Event page: ${targets.discount50}...`);
      const eventBooks = await scrapeRidiEventPage(page, targets.discount50);
      console.log(`[RIDI] Event page found ${eventBooks.length} items.`);
      
      for (const b of eventBooks) {
        // 정가 보정: 할인율이 40% 이상이거나 정가가 불확실한 경우 알라딘 API 사용
        const calculatedRate = b.originalPrice > 0 ? (1 - b.discountPrice / b.originalPrice) : 0;
        if (calculatedRate >= 0.4 || b.originalPrice === b.discountPrice || b.isSet) {
          const apiInfo = await getAladinBookInfo(b.apiTitle || b.title, b.author);
          const apiPrice = apiInfo.price;
          
          if (apiPrice > 0) {
            const apiRate = 1 - b.discountPrice / apiPrice;
            if (apiRate > 0.41 && b.discountRate > 0) {
              const reversePrice = Math.round(b.discountPrice / (1 - b.discountRate / 100) / 100) * 100;
              b.originalPrice = reversePrice;
              console.log(`[RIDI] Suspicious API rate (${(apiRate*100).toFixed(1)}%). Reverting to Ridi rate (${b.discountRate}%): ${reversePrice}원`);
            } else {
              b.originalPrice = apiPrice;
            }
            
            // 이미지 보정
            if (!b.thumbnailUrl || b.thumbnailUrl.includes('placeholder')) {
              b.thumbnailUrl = apiInfo.cover;
            }
          } else if (b.discountRate > 0) {
            b.originalPrice = Math.round(b.discountPrice / (1 - b.discountRate / 100) / 100) * 100;
          }
        }

        const existing = allBooks.find(e => e.id === b.id);
        if (!existing) {
          allBooks.push(b);
        } else if (b.discountPrice < existing.discountPrice || (existing.originalPrice === existing.discountPrice && b.originalPrice > b.discountPrice)) {
          // 할인가가 더 낮거나, 기존 데이터에 정가 보정이 안 된 경우 업데이트
          Object.assign(existing, b);
        }
      }
    } else {
      console.log('[RIDI] "50% 할인" event is not active currently.');
    }
    
    return allBooks.map(normalize);
  } catch (error) {
    console.error('[RIDI] Scraping failed:', error);
    await sendTelegramAlert(`리디북스 스크래핑 중 오류 발생: ${error.message}`);
    return [];
  } finally {
    await browser.close();
  }
}

async function scrapeRidiListPage(page) {
  return await page.evaluate(() => {
    const items = [];
    // li 요소 중 상품 정보(가격)가 있는 것만 추출
    const elements = document.querySelectorAll('li');
    elements.forEach(el => {
      // 제목 링크 확인 (N권 세트 링크가 아닌 실제 제목 링크를 찾음)
      const titleLinks = Array.from(el.querySelectorAll('a[class*="e7z8ge71"], a[class*="fig-w1hthz"]'));
      const titleLink = titleLinks.find(a => {
        const t = a.innerText.trim();
        return t && t.length > 2 && !t.match(/^\d+권 세트$/);
      });
      
      if (!titleLink || !el.innerText.includes('원')) return;

      const title = titleLink.innerText.trim();
      const itemUrl = titleLink.href;
      const img = el.querySelector('img');
      const thumbnailUrl = img ? (img.getAttribute('data-src') || img.src || img.srcset?.split(' ')[0] || '') : '';
      
      // 가격 정보 추출
      const delPrice = el.querySelector('del');
      const originalPriceText = delPrice ? delPrice.innerText.replace(/[^0-9]/g, '') : '';
      
      const priceText = el.innerText.replace(/,/g, '');
      const priceMatch = priceText.match(/\d+(?=원)/g);
      const rateMatch = priceText.match(/(\d+)%/);
      
      let discountPrice = 0;
      let originalPrice = originalPriceText ? parseInt(originalPriceText) : 0;
      
      if (priceMatch && priceMatch.length >= 1) {
        // 마지막 숫자가 보통 할인가 (가장 강조된 가격)
        discountPrice = parseInt(priceMatch[priceMatch.length - 1]);
        
        if (originalPrice === 0) {
          if (priceMatch.length >= 2) {
             originalPrice = parseInt(priceMatch[0]);
          } else {
            const rate = rateMatch ? parseInt(rateMatch[1]) : 0;
            if (rate > 0 && rate < 100) {
              originalPrice = Math.round(discountPrice / (1 - rate / 100) / 100) * 100;
            } else {
              originalPrice = discountPrice;
            }
          }
        }
      }
      
      // 권수 정보 추출 (예: "총 17권" 정보를 제목에 포함시켜 API 정확도 향상)
      const volMatch = el.innerText.match(/총\s*(\d+)권/);
      const volInfo = volMatch ? ` (${volMatch[0]})` : '';
      const apiTitle = title + volInfo;
      
      if (discountPrice > 0) {
        const isAdult = el.innerHTML.includes('19금') || 
                        el.querySelector('.adult-badge, [class*="adult"]') !== null ||
                        ['성인', '19금', '용주골', '대물'].some(k => title.includes(k));
        
        // 중복 방지 (id 기반)
        const id = itemUrl.split('/').pop().split('?')[0];
        if (id && !items.find(it => it.id === id)) {
          // 작가 정보 추출 시도
          const authorEl = el.querySelector('p[class*="author"], .author, [class*="e7z8ge70"]');
          const author = authorEl ? authorEl.innerText.trim() : '작가 정보 없음';

          items.push({
            id: id,
            platform: 'RIDI',
            title,
            apiTitle, // API 조회용 제목 (권수 포함)
            author,
            isSet: el.innerText.includes('세트'),
            originalPrice, 
            discountPrice,
            discountRate: rateMatch ? parseInt(rateMatch[1]) : 0,
            thumbnailUrl,
            itemUrl,
            isAdult
          });
        }
      }
    });
    return items;
  });
}

async function scrapeRidiEventPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // '참여작' 탭이 있다면 클릭
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button, a')).filter(el => el.innerText.includes('참여작'));
    if (tabs.length > 0) tabs[0].click();
  });
  await page.waitForTimeout(2000);

  // 무한 스크롤 처리 (가상 리스트 대응: 스크롤하면서 아이템 수집)
  const allEventItems = new Map();
  let lastCount = 0;
  
  for (let i = 0; i < 60; i++) {
    // 현재 화면의 아이템 수집
    const currentItems = await page.evaluate(() => {
      const items = [];
      const containers = Array.from(document.querySelectorAll('div[class*="fig-"]')).filter(el => {
        const link = el.querySelector('a[href*="/books/"]');
        return link && el.innerText.includes('원');
      });
      
      containers.forEach(el => {
        const link = el.querySelector('a[href*="/books/"]');
        const href = link.getAttribute('href');
        const bookId = href.split('/').pop().split('?')[0];
        if (!bookId || isNaN(bookId)) return;

        // 제목 찾기
        const allLinks = Array.from(el.querySelectorAll('a'));
        const potentialTitles = allLinks
          .map(l => l.innerText.trim())
          .filter(t => t.length > 0 && !t.includes('원') && !t.includes('소장') && !t.includes('구매'));
        
        let title = potentialTitles.sort((a, b) => b.length - a.length)[0] || "";
        const fzrhd9 = el.querySelector('[class*="fzrhd9"]');
        if (fzrhd9 && fzrhd9.innerText.trim().length > 1) title = fzrhd9.innerText.trim();
        const img = el.querySelector('img');
        if ((!title || title.length < 2) && img && img.alt) {
          title = img.alt.replace(/ 커버 이미지$/, '').replace(/\[완결 세트\]|\[특별 세트\]|\[세트\]/g, '').trim();
        }
        
        const text = el.innerText.replace(/,/g, '');
        const priceMatch = text.match(/(?:소장|구매)\s*(\d+)원/);
        const rateMatch = text.match(/(\d+)%/);

        if (priceMatch) {
          const discountPrice = parseInt(priceMatch[1]);
          const discountRate = rateMatch ? parseInt(rateMatch[1]) : 0;
          const originalPrice = (discountRate > 0 && discountRate < 100) ? Math.round(discountPrice / (1 - discountRate / 100) / 100) * 100 : discountPrice;

          // 작가 정보 찾기
          const authorEl = el.querySelector('[class*="fzrhd9"], [class*="e7z8ge70"]');
          const author = authorEl ? authorEl.innerText.trim() : '작가 정보 없음';

          // 권수 정보 추출
          const volMatch = el.innerText.match(/총\s*(\d+)권/);
          const volInfo = volMatch ? ` (${volMatch[0]})` : '';
          
          // 세트 판별 강화
          const isSetItem = title.includes('세트') || el.innerText.includes('세트') || title.includes('합본');

          items.push({
            id: bookId,
            platform: 'RIDI',
            title: title || "제목 없음",
            apiTitle: (title || "제목 없음") + volInfo,
            author,
            isSet: isSetItem,
            originalPrice,
            discountPrice,
            discountRate: discountRate,
            thumbnailUrl: img ? (img.getAttribute('data-src') || img.src || img.srcset?.split(' ')[0] || '') : "",
            itemUrl: `https://ridibooks.com/books/${bookId}`,
            isAdult: el.innerHTML.includes('19금') || el.querySelector('.adult-badge') !== null
          });
        }
      });
      return items;
    });

    currentItems.forEach(item => allEventItems.set(item.id, item));

    // 스크롤
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(600);
    
    if (allEventItems.size > 0 && allEventItems.size === lastCount && i > 20) break;
    lastCount = allEventItems.size;
    if (i % 10 === 0) console.log(`[RIDI] Event Page Scrolling... Collected: ${allEventItems.size}`);
  }

  return Array.from(allEventItems.values());
}
