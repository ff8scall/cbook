import { chromium } from 'playwright';
import { normalize } from '../utils/normalization.js';

export async function scrapeYes24() {
  const url = 'https://event.yes24.com/detail?eventNo=249660';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Find all tabs (dates)
    const tabSelectors = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tab_list li a'));
      return tabs.map((t, i) => ({ index: i, text: t.innerText.trim() }));
    });
    
    const allYes24Books = [];
    
    for (let i = 0; i < (tabSelectors.length || 1); i++) {
      if (tabSelectors.length > 0) {
        console.log(`[YES24] Processing Tab ${i + 1}/${tabSelectors.length}: ${tabSelectors[i].text}`);
        await page.evaluate((idx) => {
          const tabs = document.querySelectorAll('.tab_list li a');
          if (tabs[idx]) tabs[idx].click();
        }, i);
        await page.waitForTimeout(1500);
      }
      
      // Auto scroll to load all items in the tab
      await page.evaluate(async () => {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        for (let j = 0; j < 5; j++) {
          window.scrollBy(0, 1000);
          await delay(300);
        }
      });
      
      const tabBooks = await page.evaluate(() => {
        const items = [];
        // 예스24 이벤트 페이지의 실제 아이템 단위: .itemUnit
        const elements = document.querySelectorAll('.itemUnit');
        
        elements.forEach(el => {
          const titleEl = el.querySelector('.gd_name');
          const imgEl = el.querySelector('.lnk_img img');
          
          if (!titleEl) return;
          
          const title = titleEl.innerText.trim();
          const itemUrl = titleEl.href;
          if (!title || !itemUrl || !itemUrl.includes('yes24.com')) return;
          
          // 이미지는 lazy loading 고려하여 data-original 우선 확인
          const thumbnailUrl = imgEl ? (imgEl.getAttribute('data-original') || imgEl.src) : '';
          
          // 성인물 판별
          const isAdult = el.innerHTML.includes('age19') || 
                          title.includes('(19)') || 
                          el.innerText.includes('19금');
          
          // 가격 추출: .info_price .yes_b (판매가)
          const priceEl = el.querySelector('.info_price .yes_b');
          let discountPrice = 0;
          if (priceEl) {
            discountPrice = parseInt(priceEl.innerText.replace(/[^\d]/g, ''));
          }
          
          // 정가 추출: .info_price .yes_m (정가)
          const originPriceEl = el.querySelector('.info_price .yes_m');
          let originalPrice = discountPrice;
          if (originPriceEl) {
            originalPrice = parseInt(originPriceEl.innerText.replace(/[^\d]/g, ''));
          }
          
          if (discountPrice > 0) {
            items.push({
              id: itemUrl.split('goods/').pop() || `yes24_${Math.random()}`,
              platform: 'YES24',
              title,
              originalPrice: originalPrice || discountPrice, 
              discountPrice,
              thumbnailUrl,
              itemUrl,
              isAdult
            });
          }
        });
        return items;
      });
      
      console.log(`[YES24] Tab ${i + 1} Final: Found ${tabBooks.length} items`);
      tabBooks.forEach(b => {
        if (!allYes24Books.find(existing => existing.id === b.id)) {
          allYes24Books.push(b);
        }
      });
    }
    
    return allYes24Books.map(normalize);
  } finally {
    await browser.close();
  }
}
