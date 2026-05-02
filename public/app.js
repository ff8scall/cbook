let allDeals = [];
let currentFilter = 'ALL';
let searchQuery = '';
let currentSort = 'discount'; // 기본 정렬을 할인율순으로 변경

const dealsGrid = document.getElementById('deals-grid');
const updateInfo = document.getElementById('update-info');
const filterBtns = document.querySelectorAll('.filter-btn');
const adultToggle = document.getElementById('adult-toggle');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');

let showAdult = false;

// 초기 UI 상태 설정
sortSelect.value = 'discount';
adultToggle.classList.toggle('active', showAdult);

async function loadDeals() {
  console.log('Loading Data from Aladin, Ridi & Kyobo...');
  try {
    const timestamp = new Date().getTime();
    const [aladinRes, ridiRes, kyoboRes, yes24Res, masterRes] = await Promise.all([
      fetch(`data/aladin_sets.json?v=${timestamp}`),
      fetch(`data/ridi_sets.json?v=${timestamp}`),
      fetch(`data/kyobo_sets.json?v=${timestamp}`),
      fetch(`data/yes24_sets.json?v=${timestamp}`),
      fetch(`data/master_comics_db.json?v=${timestamp}`)
    ]);

    if (!aladinRes.ok || !ridiRes.ok || !kyoboRes.ok || !yes24Res.ok || !masterRes.ok) throw new Error('Failed to load data files');
    
    const aladinDealsRaw = await aladinRes.json();
    const ridiData = await ridiRes.json();
    const kyoboData = await kyoboRes.json();
    const yes24Data = await yes24Res.json();
    const masterData = await masterRes.json(); 
    
    // 마스터 DB 아이템 배열 (순회 검색용)
    const masterItemsList = Object.values(masterData);

    const checkIsAdult = (title, category) => {
      const adultKeywords = ['성인', '19금', '19세', '청불', '성인전용', '🔞', '용주골', '대물', '빨간책', '성인만화'];
      return adultKeywords.some(k => title?.includes(k) || category?.includes(k));
    };

    const normalizeTitle = (t) => {
      if (!t) return '';
      // 로마자 변환 (Ⅰ -> 1, Ⅱ -> 2 등)
      let norm = t.replace(/Ⅰ/g, '1').replace(/Ⅱ/g, '2').replace(/Ⅲ/g, '3').replace(/Ⅳ/g, '4').replace(/Ⅴ/g, '5');
      norm = norm.replace(/act\s*2/gi, 'act2').replace(/act\s*1/gi, 'act1');
      
      let clean = norm.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').split(':')[0].trim();
      return clean.replace(/[^a-zA-Z0-9가-힣\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    };

    const extractVolumeCount = (t) => {
      const match = t?.match(/(\d+)권/);
      return match ? parseInt(match[1]) : 0;
    };

    const processItem = (item, platform) => {
      const title = item.title || '';
      const normalizedTitle = normalizeTitle(title);
      const volCount = extractVolumeCount(title);
      
      // 알라딘은 ID 우선 매칭
      let masterItem = platform === 'ALADIN' ? masterData[item.id.replace('ALADIN_', '')] : null;
      
      if (!masterItem) {
        // 제목 + 권수 기반 정밀 검색
        masterItem = masterItemsList.find(m => {
          const mTitleNorm = normalizeTitle(m?.title_normalized);
          const mTitleOrig = normalizeTitle(m?.title_original);
          const mVol = m?.total_volumes || extractVolumeCount(m?.title_original);
          
          // 1. 제목이 정확히 일치하고, 권수가 있다면 권수까지 일치해야 함
          const titleMatch = (mTitleNorm === normalizedTitle || mTitleOrig === normalizedTitle);
          if (titleMatch) {
            if (volCount > 0 && mVol > 0) return volCount === mVol;
            return true;
          }
          return false;
        });
        
        // 정 안되면 포함 관계로 찾되, 권수 검증 필수
        if (!masterItem && volCount > 0) {
           masterItem = masterItemsList.find(m => {
             const mTitle = normalizeTitle(m?.title_normalized);
             const mVol = m?.total_volumes || extractVolumeCount(m?.title_original);
             return mTitle && mTitle.includes(normalizedTitle) && mVol === volCount;
           });
        }
      }

      let originalPrice = item.originalPrice;
      // 마스터 DB에 정가가 있고 0보다 크면 사용 (신뢰도 높음)
      if (masterItem && masterItem.base_price > 0) {
        originalPrice = masterItem.base_price;
      }

      return {
        title: title,
        author: item.author || masterItem?.author || '',
        originalPrice: originalPrice,
        discountPrice: item.discountPrice,
        discountRate: originalPrice > 0 ? Math.round((1 - item.discountPrice / originalPrice) * 100) : 0,
        thumbnailUrl: item.thumbnailUrl,
        itemUrl: item.itemUrl,
        platform: platform,
        isbn: masterItem?.isbn13 || '',
        itemId: item.id || `${platform}_${normalizedTitle}`,
        updatedAt: new Date().toISOString().split('T')[0],
        isAdult: item.isAdult || masterItem?.is_adult || checkIsAdult(title, ''),
        isVirtual: false
      };
    };

    const aladinDeals = aladinDealsRaw.map(item => processItem(item, 'ALADIN'));
    const ridiDeals = ridiData.map(item => processItem(item, 'RIDI'));
    const kyoboDeals = kyoboData.map(item => processItem(item, 'KYOBO'));
    const yes24Deals = yes24Data.map(item => processItem(item, 'YES24'));
    
    const rawDeals = [...aladinDeals, ...ridiDeals, ...kyoboDeals, ...yes24Deals].filter(d => 
      d.originalPrice > 0 && d.discountPrice > 0
    );
    
    const groups = {};
    rawDeals.forEach(deal => {
      // ISBN + 정규화된 제목 + 권수 조합으로 그룹 키 생성
      const titleKey = normalizeTitle(deal.title);
      const volKey = extractVolumeCount(deal.title);
      const key = (deal.isbn && deal.isbn !== '0') ? `${deal.isbn}_${volKey}` : `${titleKey}_${volKey}`;
      
      const masterItem = (deal.isbn && deal.isbn !== '0') ? masterData[deal.isbn] : null;

      if (!groups[key]) {
        groups[key] = {
          title: masterItem ? masterItem.title_original : deal.title,
          author: masterItem ? masterItem.author : (deal.author || '작가 정보 없음'),
          originalPrice: (masterItem && masterItem.total_price) ? masterItem.total_price : deal.originalPrice,
          thumbnailUrl: deal.thumbnailUrl,
          isAdult: deal.isAdult || checkIsAdult(deal.title, ''),
          isVirtual: !masterItem,
          offers: []
        };
      } else {
        if (deal.isAdult || checkIsAdult(deal.title, '')) {
          groups[key].isAdult = true;
        }
      }
      
      if (deal.platform === 'ALADIN') groups[key].title = deal.title;
      if (deal.isAdult) groups[key].isAdult = true;
      
      const existingOfferIdx = groups[key].offers.findIndex(o => o.platform === deal.platform);
      if (existingOfferIdx === -1) {
        groups[key].offers.push(deal);
      } else {
        if (deal.discountPrice < groups[key].offers[existingOfferIdx].discountPrice) {
          groups[key].offers[existingOfferIdx] = deal;
        }
      }
      
      if (!groups[key].isAdult && (deal.platform === 'ALADIN' || !groups[key].thumbnailUrl)) {
        groups[key].thumbnailUrl = deal.thumbnailUrl || groups[key].thumbnailUrl;
      }
    });

    allDeals = Object.values(groups).map(group => {
      group.offers.sort((a, b) => a.discountPrice !== b.discountPrice ? a.discountPrice - b.discountPrice : b.discountRate - a.discountRate);
      const bestOffer = group.offers[0];
      return { ...group, bestPrice: bestOffer.discountPrice, bestRate: bestOffer.discountRate, 
               bestPlatform: bestOffer.platform, bestUrl: bestOffer.itemUrl, displayOffer: bestOffer };
    });
    
    updateInfo.innerText = `총 ${allDeals.length}개의 작품 (알라딘 ${aladinDeals.length}, 리디 ${ridiDeals.length}, 교보 ${kyoboDeals.length}, 예스 ${yes24Deals.length} 딜 분석 완료)`;
    renderDeals();
  } catch (error) {
    console.error(error);
    dealsGrid.innerHTML = `<p style="text-align: center; color: #ef4444;">데이터를 불러오지 못했습니다. (${error.message})</p>`;
  }
}

function renderDeals() {
  let filtered = [...allDeals];
  
  if (currentFilter !== 'ALL') {
    // 특정 플랫폼 선택 시, 해당 플랫폼의 오퍼가 있는 그룹만 필터링하고 해당 플랫폼 정보를 우선 노출
    filtered = filtered.filter(g => g.offers.some(o => o.platform === currentFilter))
                       .map(g => {
                           const platformOffer = g.offers.find(o => o.platform === currentFilter);
                           return { ...g, displayOffer: platformOffer };
                       });
  } else {
    filtered = filtered.map(g => ({ ...g, displayOffer: g.offers[0] })); // 최저가 오퍼를 기본 노출
  }

  if (!showAdult) {
    filtered = filtered.filter(d => !d.isAdult);
  }
  
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(d => 
      d.title.toLowerCase().includes(q) || 
      (d.author && d.author.toLowerCase().includes(q))
    );
  }
  
  // Apply sorting
  if (currentSort === 'discount') {
    filtered.sort((a, b) => (b.displayOffer.discountRate || 0) - (a.displayOffer.discountRate || 0));
  } else if (currentSort === 'price-low') {
    filtered.sort((a, b) => a.displayOffer.discountPrice - b.displayOffer.discountPrice);
  } else if (currentSort === 'price-high') {
    filtered.sort((a, b) => b.displayOffer.discountPrice - a.displayOffer.discountPrice);
  }
    
  dealsGrid.innerHTML = filtered.map(group => {
    const main = group.displayOffer || {};
    return `
    <div class="deal-card ${group.isAdult ? 'adult-content' : ''}">
      <a href="${main.itemUrl}" target="_blank" class="thumb-link">
        <div class="thumb-container">
          <span class="platform-tag ${main.platform}">${main.platform} 최저가</span>
          ${group.isAdult ? 
            `<img src="assets/adult_placeholder.png" alt="성인용 콘텐츠" class="adult-placeholder">` : 
            (group.thumbnailUrl ? `<img src="${group.thumbnailUrl}" alt="" loading="lazy">` : '')
          }
          <div class="deal-tags">
              ${group.isAdult ? '<span class="tag adult-tag">🔞 19금</span>' : ''}
              ${group.isVirtual ? '<span class="tag virtual-tag">🛠 가상세트</span>' : ''}
          </div>
        </div>
      </a>
      <div class="deal-info">
        <div class="deal-title" title="${group.title}">${group.title}</div>
        <div class="deal-author">${group.author}</div>
        
        <div class="price-row best-price">
          ${main.discountRate > 0 ? `<span class="discount-rate">${main.discountRate}%</span>` : ''}
          <span class="price-final">${(main.discountPrice || 0).toLocaleString()}원</span>
          <span class="original-price">${(group.originalPrice || 0).toLocaleString()}원</span>
        </div>

        <div class="platform-comparison">
          ${group.offers.map(offer => `
            <a href="${offer.itemUrl}" target="_blank" class="platform-link ${offer.platform} ${offer.platform === main.platform ? 'best' : ''}">
              <span class="p-name">${offer.platform}</span>
              <span class="p-price">${(offer.discountPrice || 0).toLocaleString()}</span>
            </a>
          `).join('')}
        </div>
      </div>
    </div>
  `}).join('');
  
  if (filtered.length === 0) {
    dealsGrid.innerHTML = `<p style="text-align: center; padding: 50px; grid-column: 1/-1;">해당하는 할인 정보가 없습니다.</p>`;
  }
}

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.platform;
    renderDeals();
  });
});

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderDeals();
});

sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  renderDeals();
});

adultToggle.addEventListener('click', () => {
  showAdult = !showAdult;
  adultToggle.classList.toggle('active', showAdult);
  renderDeals();
});

loadDeals();
