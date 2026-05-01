import { chromium } from 'playwright';
import { normalize } from '../utils/normalization.js';

export async function scrapeAladin() {
  const url = 'https://www.aladin.co.kr/events/wevent.aspx?EventId=270007';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    
    const books = await page.evaluate(() => {
      const items = [];
      const links = document.querySelectorAll('a.bo');
      
      let lastThumbnail = '';
      
      links.forEach((link) => {
        const img = link.querySelector('img');
        const text = link.innerText.trim();
        
        if (img) {
          lastThumbnail = img.src;
        } else if (text && text.length > 1) {
          const title = text;
          const itemUrl = link.href;
          
          // Try to find price in the parent or sibling
          const parentCell = link.closest('td');
          const priceText = parentCell ? parentCell.innerText : '';
          const priceMatch = priceText.replace(/,/g, '').match(/\d+(?=원)/g);
          
          let discountPrice = 0;
          let originalPrice = 0;
          
          if (priceMatch && priceMatch.length >= 1) {
            // First price match is the actual sale price
            discountPrice = parseInt(priceMatch[0]);
            originalPrice = discountPrice; // Assume no original price for now as Aladin sets are often flat
          }
          
          if (discountPrice > 0) {
            items.push({
              id: itemUrl.split('ItemId=')[1] || `aladin_${Math.random()}`,
              platform: 'ALADIN',
              title,
              originalPrice, 
              discountPrice,
              thumbnailUrl: lastThumbnail,
              itemUrl,
            });
            // Reset thumbnail after pairing to avoid reuse if one is missing
            lastThumbnail = '';
          }
        }
      });
      
      return items;
    });
    
    return books.map(normalize);
  } finally {
    await browser.close();
  }
}
