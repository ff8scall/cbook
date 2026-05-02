import { chromium } from 'playwright';
import { normalize } from '../utils/normalization.js';
import { sendTelegramAlert } from '../utils/notifier.js';
import { getAladinBookInfo } from '../utils/aladinApi.js';

export async function scrapeKyobo() {
  const entryUrl = 'https://ebook.kyobobook.co.kr/dig/pnd/showcase?pageNo=8';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    // 0. 타겟 URL 동적 탐색
    console.log('[KYOBO] Discovering target URL from showcase page...');
    await page.goto(entryUrl, { waitUntil: 'networkidle' });
    
    const targetUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.quickLink a'));
      const setLink = links.find(a => a.innerText.includes('세트'));
      return setLink ? setLink.href : null;
    });

    if (!targetUrl) {
      console.error('[KYOBO] "세트" link not found!');
      await sendTelegramAlert('교보문고 "세트" 링크를 찾을 수 없습니다. 진입 페이지(pageNo=8) 구조를 확인해주세요.');
      return [];
    }

    console.log(`[KYOBO] Target URL discovered: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Find all tab buttons
    const tabSelectors = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tab_item a, .tab_link, [role="tab"]'));
      return tabs.map((t, i) => ({ index: i, text: t.innerText.trim() }));
    });
    
    const allKyoboBooks = [];
    
    for (let i = 0; i < (tabSelectors.length || 1); i++) {
      if (tabSelectors.length > 0) {
        console.log(`[KYOBO] Processing Tab ${i + 1}/${tabSelectors.length}: ${tabSelectors[i].text}`);
        await page.evaluate((idx) => {
          const tabs = document.querySelectorAll('.tab_item a, .tab_link, [role="tab"]');
          if (tabs[idx]) tabs[idx].click();
        }, i);
        await page.waitForTimeout(1500);
      }
      
      // More aggressive clicking with state check
      let moreExists = true;
      let lastCount = 0;
      
      for (let j = 0; j < 15; j++) {
        const currentCount = await page.evaluate(() => document.querySelectorAll('li.prod_item, li.d_list_item').length);
        
        // Scroll to the bottom of the section to reveal the "More" button
        await page.evaluate(async () => {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(r => setTimeout(r, 500));
        });
        
        const moreBtn = await page.$('.btn_more_cont:not([style*="display: none"])');
        if (moreBtn && await moreBtn.isVisible()) {
          console.log(`[KYOBO] Tab ${i + 1}: Clicking "More" (Current items: ${currentCount})`);
          await moreBtn.click();
          // Wait for the count to increase
          try {
            await page.waitForFunction(
              (old) => document.querySelectorAll('li.prod_item, li.d_list_item').length > old,
              { timeout: 3000 },
              currentCount
            );
          } catch (e) {
            // If it didn't load more in 3s, maybe it's the end or slow
            console.log(`[KYOBO] Tab ${i + 1}: No new items after click.`);
          }
        } else {
          break; // No more button
        }
      }
      
      // Final scrape for this tab
      const tabBooks = await page.evaluate(() => {
        const items = [];
        const elements = document.querySelectorAll('li.prod_item, li.d_list_item');
        
        elements.forEach(el => {
          // Visibility check to ensure we only get items from the active tab
          if (el.offsetParent === null) return;
          
          const titleEl = el.querySelector('.prod_name, .d_list_text_title, .d_book_name_link');
          const linkEl = el.querySelector('a');
          const imgEl = el.querySelector('img');
          
          if (!titleEl || !linkEl) return;
          
          const title = titleEl.innerText.trim();
          const itemUrl = linkEl.href;
          if (!title || !itemUrl.includes('kyobobook.co.kr')) return;
          
          // 판매 상태 체크: 판매금지, 품절, 판매중단 등 제외
          const statusText = el.innerText;
          if (statusText.includes('판매금지') || statusText.includes('일시품절') || statusText.includes('판매중단') || statusText.includes('판매종료')) {
            return;
          }
          
          const thumbnailUrl = imgEl ? imgEl.src : '';
          const priceEl = el.querySelector('.prod_price .val, .val');
          let discountPrice = 0;
          if (priceEl) {
            const rawPrice = parseInt(priceEl.innerText.replace(/,/g, ''));
            
            // 교보문고 쿠폰 적용가 일괄 노멀라이징: 
            // 교보는 기본 할인가에 10% 쿠폰을 더해 노출하므로, 타 플랫폼과 기준을 맞추기 위해 10%를 역산하여 제거
            // (예: 22,680원 -> 25,200원)
            if (rawPrice > 0) {
              discountPrice = Math.round(rawPrice / 0.9 / 10) * 10;
            }
          }
          
          // 정가(originalPrice) 추출 보강
          const originPriceEl = el.querySelector('.price_origin .val, .val_origin, .origin_price');
          let originalPrice = 0;
          if (originPriceEl) {
            originalPrice = parseInt(originPriceEl.innerText.replace(/,/g, ''));
          }
          
          // 텍스트 내에서 모든 가격 후보군을 찾아 가장 큰 값을 정가로 사용
          const priceMatches = el.innerText.replace(/,/g, '').match(/\d{4,}(?=원)/g);
          if (priceMatches && priceMatches.length >= 2) {
            const sortedPrices = priceMatches.map(Number).sort((a, b) => b - a);
            if (!originalPrice) originalPrice = sortedPrices[0];
          }
          
          // 정가가 할인가보다 작을 수 없으므로 보정
          if (!originalPrice || originalPrice < discountPrice) originalPrice = discountPrice;
          
          // 성인물 체크
          const isAdult = el.innerText.includes('19세') || el.innerText.includes('19금') || el.querySelector('.adult, .tag_19, .badge_19') !== null;

          items.push({
            id: itemUrl.split('/').pop() || `kyobo_${Math.random()}`,
            platform: 'KYOBO',
            title,
            originalPrice: originalPrice || discountPrice, 
            discountPrice: discountPrice || 0,
            thumbnailUrl,
            itemUrl,
            isAdult
          });
        });
        return items;
      });
      
      console.log(`[KYOBO] Tab ${i + 1} Final: Found ${tabBooks.length} items`);
      tabBooks.forEach(b => {
        if (!allKyoboBooks.find(existing => existing.id === b.id)) {
          allKyoboBooks.push(b);
        }
      });
    }

    // 알라딘 API를 이용한 2차 보정 (정가 및 이미지)
    for (const b of allKyoboBooks) {
      if (b.originalPrice === b.discountPrice || !b.thumbnailUrl || b.thumbnailUrl.includes('placeholder')) {
        const apiInfo = await getAladinBookInfo(b.title);
        if (apiInfo.price > 0 && b.originalPrice === b.discountPrice) {
          b.originalPrice = apiInfo.price;
        }
        if (apiInfo.cover && (!b.thumbnailUrl || b.thumbnailUrl.includes('placeholder'))) {
          b.thumbnailUrl = apiInfo.cover;
        }
      }
    }
    
    return allKyoboBooks.map(normalize);
  } finally {
    await browser.close();
  }
}
