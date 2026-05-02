import axios from 'axios';

const TTB_KEY = process.env.ALADIN_TTB_KEY || 'ttbff8scall1706001';

/**
 * 알라딘 API를 사용하여 도서의 정가 및 이미지 정보를 검색합니다.
 * @param {string} title 도서 제목
 * @param {string} author 작가 이름 (선택 사항)
 * @returns {Promise<{price: number, cover: string}>} 정가 및 커버 URL
 */
export async function getAladinBookInfo(title, author = '') {
  console.log(`[ALADIN-API] Fetching info for: "${title}"...`);
  try {
    const volMatch = title.match(/총\s*(\d+)권/);
    const targetVolCount = volMatch ? parseInt(volMatch[1]) : 0;

    let cleanTitle = title
      .replace(/\[완결 세트\]|\[특별 세트\]|\[세트\]/g, '')
      .replace(/\(총 \d+권.*\)/g, '')
      .trim();
    
    const queries = [
      cleanTitle.includes('세트') ? cleanTitle : `${cleanTitle} 세트`,
      cleanTitle
    ];
    
    const url = `http://www.aladin.co.kr/ttb/api/ItemSearch.aspx`;
    let items = [];

    for (const q of queries) {
      const response = await axios.get(url, {
        params: {
          ttbkey: TTB_KEY,
          Query: q,
          QueryType: 'Keyword',
          MaxResults: 10,
          SearchTarget: 'eBook',
          output: 'js',
          Version: '20131101'
        }
      });
      items = response.data?.item || [];
      if (items.length > 0) break;
    }

    if (items.length === 0) {
      for (const q of queries) {
        const response = await axios.get(url, {
          params: {
            ttbkey: TTB_KEY,
            Query: q,
            QueryType: 'Keyword',
            MaxResults: 10,
            SearchTarget: 'Book',
            output: 'js',
            Version: '20131101'
          }
        });
        items = response.data?.item || [];
        if (items.length > 0) break;
      }
    }

    if (items.length > 0) {
      let filteredItems = items.filter(item => item.categoryName && item.categoryName.includes('만화'));
      
      if (targetVolCount > 0) {
        filteredItems = filteredItems.filter(item => {
          const itemVolMatch = item.title.match(/(?:전|총|합본)\s*(\d+)권/);
          const itemVolCount = itemVolMatch ? parseInt(itemVolMatch[1]) : 0;
          if (itemVolCount > 0) {
            return Math.abs(targetVolCount - itemVolCount) <= 2;
          }
          return true; 
        });
      }

      filteredItems.sort((a, b) => {
        const aHasSet = a.title.includes('세트');
        const bHasSet = b.title.includes('세트');
        if (aHasSet && !bHasSet) return -1;
        if (!aHasSet && bHasSet) return 1;
        return 0;
      });
      
      if (author && author !== '작가 정보 없음') {
        const authorMatch = filteredItems.filter(item => item.author && item.author.includes(author));
        if (authorMatch.length > 0) filteredItems = authorMatch;
      }

      if (filteredItems.length > 0) {
        const item = filteredItems[0];
        console.log(`[ALADIN-API] Matched: "${item.title}" - ${item.priceStandard}원`);
        return {
          price: item.priceStandard || 0,
          cover: item.cover || ''
        };
      }
    }
  } catch (error) {
    console.error(`[ALADIN-API] Error fetching info for "${title}":`, error.message);
  }
  return { price: 0, cover: '' };
}

/**
 * 하위 호환성을 위한 정가 전용 조회 함수
 */
export async function getOriginalPriceFromAladin(title, author = '') {
  const info = await getAladinBookInfo(title, author);
  return info.price;
}
