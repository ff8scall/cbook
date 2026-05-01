import { chromium } from 'playwright';
import { normalize } from '../utils/normalization.js';

export async function scrapeKyobo() {
  const url = 'https://event.kyobobook.co.kr/detail/239264';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
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
            discountPrice = parseInt(priceEl.innerText.replace(/,/g, ''));
          }
          
          // Try to find original price (crossed out)
          const originPriceEl = el.querySelector('.price_origin .val, .d_list_text_price .val_origin');
          let originalPrice = discountPrice;
          if (originPriceEl) {
            originalPrice = parseInt(originPriceEl.innerText.replace(/,/g, ''));
          } else {
            // Check for multiple prices in text as fallback
            const prices = el.innerText.replace(/,/g, '').match(/\d+(?=원)/g);
            if (prices && prices.length >= 2) {
              originalPrice = parseInt(prices[0]);
              discountPrice = parseInt(prices[1]);
            }
          }
          
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
    
    return allKyoboBooks.map(normalize);
  } finally {
    await browser.close();
  }
}
