let allDeals = [];
let currentFilter = 'ALL';
let searchQuery = '';
let currentSort = 'default';

const dealsGrid = document.getElementById('deals-grid');
const updateInfo = document.getElementById('update-info');
const filterBtns = document.querySelectorAll('.filter-btn');
const adultToggle = document.getElementById('adult-toggle');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');

let showAdult = false;

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
    const aladinData = await masterRes.json(); 
    
    // 성인 판별 함수
    const checkIsAdult = (title, category) => {
      const adultKeywords = ['성인', '19금', '19세', '청불', '성인전용', '🔞'];
      const hasKeyword = adultKeywords.some(k => title?.includes(k) || category?.includes(k));
      return hasKeyword;
    };

    // 알라딘 데이터 변환 (오늘의 딜 전용 파일 사용)
    const aladinDeals = aladinDealsRaw.map(item => ({
      title: item.title,
      author: item.author,
      originalPrice: item.base_price,
      discountPrice: item.discount_price,
      discountRate: item.discount_rate,
      thumbnailUrl: item.cover,
      itemUrl: item.link,
      platform: 'ALADIN',
      updatedAt: new Date().toISOString().split('T')[0],
      isAdult: item.is_adult || checkIsAdult(item.title, ''),
      isVirtual: false
    }));
    
    // 리디 데이터 변환
    const ridiDeals = ridiData.map(item => {
      const isbn = item.isbn?.replace(/-/g, '');
      const matchingAladin = aladinData[isbn];
      return {
        title: item.title,
        author: item.author,
        originalPrice: item.base_price,
        discountPrice: item.ridi_price_sale,
        discountRate: item.base_price > 0 ? Math.round((1 - item.ridi_price_sale / item.base_price) * 100) : 0,
        thumbnailUrl: item.cover,
        itemUrl: item.link,
        platform: 'RIDI',
        updatedAt: new Date().toISOString().split('T')[0],
        isAdult: item.is_adult || matchingAladin?.is_adult || checkIsAdult(item.title, matchingAladin?.category),
        isVirtual: item.is_virtual || matchingAladin?.is_virtual || false
      };
    });

    // 교보 데이터 변환
    const kyoboDeals = kyoboData.map(item => {
      const isbn = item.isbn?.replace(/-/g, '');
      const matchingAladin = aladinData[isbn];
      return {
        title: item.title,
        author: item.author,
        originalPrice: item.base_price,
        discountPrice: item.kyobo_price_sale,
        discountRate: item.base_price > 0 ? Math.round((1 - item.kyobo_price_sale / item.base_price) * 100) : 0,
        thumbnailUrl: item.cover,
        itemUrl: item.link,
        platform: 'KYOBO',
        updatedAt: new Date().toISOString().split('T')[0],
        isAdult: item.is_adult || matchingAladin?.is_adult || checkIsAdult(item.title, matchingAladin?.category),
        isVirtual: item.is_virtual || matchingAladin?.is_virtual || false
      };
    });
    
    // 예스24 데이터 변환
    const yes24Deals = yes24Data.map(item => {
      const isbn = item.isbn?.replace(/-/g, '');
      const matchingAladin = aladinData[isbn];
      return {
        title: item.title,
        author: item.author,
        originalPrice: item.originalPrice,
        discountPrice: item.discountPrice,
        discountRate: item.originalPrice > 0 ? Math.round((1 - item.discountPrice / item.originalPrice) * 100) : 0,
        thumbnailUrl: item.thumbnailUrl,
        itemUrl: item.itemUrl,
        platform: 'YES24',
        updatedAt: new Date().toISOString().split('T')[0],
        isAdult: item.isAdult || matchingAladin?.is_adult || checkIsAdult(item.title, matchingAladin?.category),
        isVirtual: false
      };
    });
    
    // 통합 및 정제
    const rawDeals = [...aladinDeals, ...ridiDeals, ...kyoboDeals, ...yes24Deals].filter(d => d.originalPrice > 0 && d.discountPrice > 0);
    
    // 그룹화 로직 (ISBN 기준, ISBN 없으면 제목 기준)
    const groups = {};
    rawDeals.forEach(deal => {
      const key = deal.isbn || deal.title.replace(/\s+/g, '');
      if (!groups[key]) {
        groups[key] = {
          title: deal.title,
          author: deal.author,
          originalPrice: deal.originalPrice,
          thumbnailUrl: deal.thumbnailUrl,
          isAdult: deal.isAdult,
          isVirtual: deal.isVirtual,
          offers: []
        };
      }
      
      // 하나라도 성인물이면 전체 그룹을 성인물로 표시
      if (deal.isAdult) groups[key].isAdult = true;
      
      groups[key].offers.push(deal);
      
      // 성인물이 아닌 경우에만 썸네일 업데이트 시도 (대표 이미지 확보)
      if (!groups[key].isAdult) {
        if (deal.platform === 'ALADIN' || !groups[key].thumbnailUrl) {
            groups[key].thumbnailUrl = deal.thumbnailUrl || groups[key].thumbnailUrl;
        }
      }
    });

    allDeals = Object.values(groups).map(group => {
      // 최저가 순으로 정렬
      group.offers.sort((a, b) => a.discountPrice - b.discountPrice);
      const bestOffer = group.offers[0];
      
      return {
        ...group,
        bestPrice: bestOffer.discountPrice,
        bestRate: bestOffer.discountRate,
        bestPlatform: bestOffer.platform,
        bestUrl: bestOffer.itemUrl
      };
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
    filtered = filtered.filter(d => d.title.toLowerCase().includes(searchQuery.toLowerCase()));
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
    const main = group.displayOffer;
    return `
    <div class="deal-card ${group.isAdult ? 'adult-content' : ''}">
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
      <div class="deal-info">
        <div class="deal-title" title="${group.title}">${group.title}</div>
        <div class="deal-author">${group.author}</div>
        
        <div class="price-row best-price">
          ${main.discountRate > 0 ? `<span class="discount-rate">${main.discountRate}%</span>` : ''}
          <span class="price-final">${main.discountPrice.toLocaleString()}원</span>
          <span class="original-price">${group.originalPrice.toLocaleString()}원</span>
        </div>

        <div class="platform-comparison">
          ${group.offers.map(offer => `
            <a href="${offer.itemUrl}" target="_blank" class="platform-link ${offer.platform} ${offer.platform === main.platform ? 'best' : ''}">
              <span class="p-name">${offer.platform}</span>
              <span class="p-price">${offer.discountPrice.toLocaleString()}</span>
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
