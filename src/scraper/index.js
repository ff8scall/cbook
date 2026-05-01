import fs from 'fs-extra';
import path from 'path';
import { scrapeAladin } from './aladin.js';
import { scrapeRidi } from './ridi.js';
import { scrapeKyobo } from './kyobo.js';
import { scrapeYes24 } from './yes24.js';

async function run() {
  const target = process.argv[2]?.toLowerCase(); // aladin, ridi, kyobo, yes24
  
  console.log(`🚀 스크래핑 시작... [대상: ${target || '전체'}]`);
  
  try {
    const dataDir = path.resolve(process.cwd(), 'public/data');
    await fs.ensureDir(dataDir);

    let aladin = [];
    let ridi = [];
    let kyobo = [];
    let yes24 = [];

    // 1. 알라딘
    if (!target || target === 'aladin') {
      aladin = await scrapeAladin().catch(e => { console.error('Aladin Error:', e); return []; });
      console.log(`[ALADIN] Found ${aladin.length} items`);
      await fs.writeJson(path.join(dataDir, 'aladin_sets.json'), aladin, { spaces: 2 });
    } else {
      aladin = await fs.readJson(path.join(dataDir, 'aladin_sets.json')).catch(() => []);
    }

    // 2. 리디북스
    if (!target || target === 'ridi') {
      ridi = await scrapeRidi().catch(e => { console.error('Ridi Error:', e); return []; });
      console.log(`[RIDI] Found ${ridi.length} items`);
      await fs.writeJson(path.join(dataDir, 'ridi_sets.json'), ridi, { spaces: 2 });
    } else {
      ridi = await fs.readJson(path.join(dataDir, 'ridi_sets.json')).catch(() => []);
    }

    // 3. 교보문고
    if (!target || target === 'kyobo') {
      kyobo = await scrapeKyobo().catch(e => { console.error('Kyobo Error:', e); return []; });
      console.log(`[KYOBO] Found ${kyobo.length} items`);
      await fs.writeJson(path.join(dataDir, 'kyobo_sets.json'), kyobo, { spaces: 2 });
    } else {
      kyobo = await fs.readJson(path.join(dataDir, 'kyobo_sets.json')).catch(() => []);
    }

    // 4. 예스24
    if (!target || target === 'yes24') {
      yes24 = await scrapeYes24().catch(e => { console.error('Yes24 Error:', e); return []; });
      console.log(`[YES24] Found ${yes24.length} items`);
      await fs.writeJson(path.join(dataDir, 'yes24_sets.json'), yes24, { spaces: 2 });
    } else {
      yes24 = await fs.readJson(path.join(dataDir, 'yes24_sets.json')).catch(() => []);
    }
    
    // 통합 파일 생성
    const allDeals = [...aladin, ...ridi, ...kyobo, ...yes24];
    const shuffledDeals = [...allDeals];
    for (let i = shuffledDeals.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledDeals[i], shuffledDeals[j]] = [shuffledDeals[j], shuffledDeals[i]];
    }
    
    await fs.writeJson(path.join(dataDir, 'deals.json'), shuffledDeals, { spaces: 2 });
    
    console.log(`✅ 스크래핑 완료! 총 ${allDeals.length}개의 딜을 통합 저장했습니다.`);
    
  } catch (error) {
    console.error('❌ 스크래핑 중 치명적 오류 발생:', error);
  }
}

run();
