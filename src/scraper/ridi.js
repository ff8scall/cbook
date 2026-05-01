import { chromium } from 'playwright';
import { normalize } from '../utils/normalization.js';

export async function scrapeRidi() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  const allBooks = [];
  
  try {
    for (let p = 1; p <= 15; p++) {
      const url = `https://ridibooks.com/selection/748?section_id=748&page=${p}`;
      console.log(`[RIDI] Scraping page ${p}...`);
      
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      
      // Aggressive scrolling to trigger lazy-loaded items on the page
      await page.evaluate(async () => {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        for (let i = 0; i < 8; i++) {
          window.scrollBy(0, 1000);
          await delay(200);
        }
        window.scrollTo(0, document.body.scrollHeight);
        await delay(500);
      });
      
      const pageBooks = await page.evaluate(() => {
        const items = [];
        // Catch all li items that could be books
        const elements = document.querySelectorAll('li');
        
        elements.forEach(el => {
          const titleLink = el.querySelector('a[class*="fig-w1hthz"], a[class*="e7z8ge71"]');
          if (!titleLink) return;
          
          const title = titleLink.innerText.trim();
          if (!title || title.length < 2) return;
          
          const itemUrl = titleLink.href;
          const img = el.querySelector('img');
          const thumbnailUrl = img ? img.src : '';
          
          const priceText = el.innerText;
          const priceMatch = priceText.replace(/,/g, '').match(/\d+(?=원)/g);
          let discountPrice = 0;
          let originalPrice = 0;
          
          if (priceMatch && priceMatch.length >= 2) {
            // Usually [original, sale] or [sale, points]
            // Ridi often shows Original then Sale
            originalPrice = parseInt(priceMatch[0]);
            discountPrice = parseInt(priceMatch[1]);
          } else if (priceMatch && priceMatch.length === 1) {
            discountPrice = parseInt(priceMatch[0]);
            originalPrice = discountPrice;
          }
          
          if (discountPrice > 0) {
            // 성인물 체크 (배지나 클래스명 기반)
            const isAdult = el.innerHTML.includes('19금') || el.innerHTML.includes('🔞') || el.querySelector('.adult-badge, [class*="adult"]') !== null;
            
            items.push({
              id: itemUrl.split('/').pop() || `ridi_${Math.random()}`,
              platform: 'RIDI',
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
      
      console.log(`[RIDI] Page ${p}: Found ${pageBooks.length} items`);
      if (pageBooks.length === 0) break;
      
      let newCount = 0;
      pageBooks.forEach(b => {
        if (!allBooks.find(existing => existing.id === b.id)) {
          allBooks.push(b);
          newCount++;
        }
      });
      
      if (newCount === 0 && p > 1) break; 
      
      const hasNext = await page.evaluate(() => {
        // Broad search for next page link
        const navLinks = Array.from(document.querySelectorAll('a, button'));
        return navLinks.some(l => 
          (l.innerText && l.innerText.includes('다음')) || 
          (l.getAttribute('aria-label') && l.getAttribute('aria-label').includes('다음'))
        );
      });
      if (!hasNext) break;
    }
    
    return allBooks.map(normalize);
  } finally {
    await browser.close();
  }
}
