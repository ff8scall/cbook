import { chromium } from 'playwright';
import { normalize } from '../utils/normalization.js';
import { sendTelegramAlert } from '../utils/notifier.js';
import { getAladinBookInfo } from '../utils/aladinApi.js';

export async function scrapeAladin() {
  const entryUrl = 'https://www.aladin.co.kr/shop/wbrowse.aspx?CID=38416&start=we';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    // 0. 타겟 URL 동적 탐색
    console.log('[ALADIN] Discovering target URL from manga page...');
    await page.goto(entryUrl, { waitUntil: 'networkidle' });
    
    const targetUrl = await page.evaluate(() => {
      // '세트만화' 이미지를 포함한 링크 찾기 (Playwright CSS :has 지원)
      const setLink = document.querySelector('a:has(img[src*="comicset"])');
      return setLink ? setLink.href : null;
    });

    if (!targetUrl) {
      console.error('[ALADIN] "세트만화/세트관" link not found!');
      await sendTelegramAlert('알라딘 "세트만화" 링크를 찾을 수 없습니다. 사이드바 배너 구조를 확인해주세요.');
      return [];
    }

    console.log(`[ALADIN] Target URL discovered: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    
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
          // 제목 링크(.bo)를 제외한 나머지 텍스트에서 가격 추출 (제목 내 숫자 간섭 방지)
          let cleanPriceText = priceText;
          const boLinks = parentCell ? parentCell.querySelectorAll('a.bo') : [];
          boLinks.forEach(bo => {
            cleanPriceText = cleanPriceText.replace(bo.innerText, '');
          });
          
          cleanPriceText = cleanPriceText.split('/')[0].replace(/,/g, '');
          const priceMatch = cleanPriceText.match(/\d+/); // 첫 번째 숫자만 찾음
          const rateMatch = cleanPriceText.match(/(\d+)(?=%)/); // 할인율(%) 찾음
          
          let discountPrice = 0;
          let originalPrice = 0;
          
          if (priceMatch) {
            discountPrice = parseInt(priceMatch[0]);
            if (rateMatch) {
              const rate = parseInt(rateMatch[1]);
              originalPrice = Math.round(discountPrice / (1 - rate / 100));
            } else {
              originalPrice = discountPrice;
            }
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
    
    // 알라딘 API를 이용한 이미지 및 정가 최종 보정
    for (const b of books) {
      if (!b.thumbnailUrl || b.thumbnailUrl.includes('placeholder')) {
        const apiInfo = await getAladinBookInfo(b.title);
        if (apiInfo.cover) b.thumbnailUrl = apiInfo.cover;
        if (apiInfo.price > 0 && b.originalPrice === b.discountPrice) b.originalPrice = apiInfo.price;
      }
    }
    
    return books.map(normalize);
  } finally {
    await browser.close();
  }
}
