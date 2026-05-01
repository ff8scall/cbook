import requests
import json
import re
import os
import time
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()
TTB_KEY = os.getenv('ALADIN_TTB_KEY')

# 기존 마스터 DB 로드 (매칭용)
try:
    with open('public/data/master_comics_db.json', 'r', encoding='utf-8') as f:
        master_db = json.load(f)
except FileNotFoundError:
    master_db = {}

def normalize_title(title):
    # [N%▼], [세트], (전N권) 등 제거
    title = re.sub(r'\[.*?▼\]', '', title)
    title = re.sub(r'\[.*?\]', '', title)
    title = re.sub(r'\(.*?\)', '', title)
    title = title.replace('세트', '').replace('전권', '').replace('완결', '')
    return title.strip()

def extract_volume_count(title):
    match = re.search(r'총\s?(\d+)권', title)
    if not match:
        match = re.search(r'전\s?(\d+)권', title)
    if match:
        return int(match.group(1))
    return 0

def get_aladin_price_by_search(title):
    """
    알라딘 API 검색을 통해 정가 정보 확보 (리디 스크래퍼와 동일 로직)
    """
    search_url = "http://www.aladin.co.kr/ttb/api/ItemSearch.aspx"
    params = {
        'ttbkey': TTB_KEY,
        'Query': title,
        'QueryType': 'Title',
        'MaxResults': 5,
        'SearchTarget': 'eBook',
        'output': 'js',
        'Version': '20131101',
        'CategoryId': 40411
    }
    try:
        res = requests.get(search_url, params=params, timeout=5)
        data = res.json()
        items = data.get('item', [])
        # 원본 제목에서 권차 수 추출
        target_vols = extract_volume_count(title)
        
        for item in items:
            item_title = item.get('title', '')
            if '세트' in item_title:
                # 검색된 상품의 권차 수 확인
                item_vols = extract_volume_count(item_title)
                
                # 권수 정보가 둘 다 있다면 일치할 때만 매칭 (정밀 매칭)
                if target_vols > 0 and item_vols > 0:
                    if target_vols != item_vols:
                        continue

                item_id = item.get('itemId')
                # 상세 페이지 가격 추출 함수 (aladin_master 모듈에서 가져옴)
                from aladin_master import get_detailed_info
                price_info = get_detailed_info(item_id)
                if price_info and price_info['base_price'] > 0:
                    return {
                        'isbn13': item.get('isbn13'),
                        'base_price': price_info['base_price'],
                        'title_original': item.get('title'),
                        'item_id': item_id,
                        'cover': item.get('cover'),
                        'adult': item.get('adult', False)
                    }
        
        # [Fallback] 세트 상품이 없으면 개별 권차 합산 시도
        from aladin_master import get_aggregated_price
        agg_res = get_aggregated_price(title)
        if agg_res and agg_res['base_price'] > 0:
            rep = agg_res['representative_item']
            return {
                'isbn13': rep.get('isbn13'),
                'base_price': agg_res['base_price'],
                'title_original': f"[가상세트] {title} (총{agg_res['volumes_count']}권)",
                'item_id': rep.get('itemId'),
                'cover': rep.get('cover'),
                'adult': rep.get('adult', False),
                'is_virtual': True
            }
    except Exception: pass
    return None

def scrape_kyobo_sets():
    event_id = "239264"
    # 분석된 메뉴 ID 목록 (탭 별)
    menu_ids = ["72941", "85131", "72942", "72943"] 
    
    all_kyobo_items = []
    new_master_entries = {}
    
    print(f"--- 교보문고 세트 할인 수집 시작 (이벤트: {event_id}) ---")
    
    for menu_id in menu_ids:
        page = 1
        while True:
            api_url = f"https://event.kyobobook.co.kr/api/gw/evt/event-book/{event_id}"
            params = {
                "page": page,
                "per": 50,
                "bksRandomYsno": "N",
                "evntId": event_id,
                "evntPageMenuNum": menu_id
            }
            
            print(f"  Menu {menu_id} - Page {page} 수집 중...")
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': f'https://event.kyobobook.co.kr/detail/{event_id}'
            }
            
            try:
                res = requests.get(api_url, params=params, headers=headers, timeout=10)
                if res.status_code != 200: break
                
                data = res.json()
                book_list = data.get('data', {}).get('bookList', [])
                if not book_list: break
                
                for book in book_list:
                    kyobo_item = {
                        'kyobo_id': book.get('saleCmdtid'),
                        'title': book.get('name'),
                        'author': book.get('author'),
                        'isbn': book.get('cmdtcode'),
                        'kyobo_price_sale': int(book.get('collectionDiscountPrice', 0)),
                        'kyobo_price_full': int(book.get('collectionPrice', 0)),
                        'cover': f"https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/{book.get('cmdtcode')}.jpg",
                        'link': f"https://ebook-product.kyobobook.co.kr/dig/epd/ebook/{book.get('saleCmdtid')}"
                    }
                    
                    # 매칭 로직
                    match_found = False
                    norm_title = normalize_title(kyobo_item['title'])
                    
                    # 1. 기존 마스터 DB 매칭 (ISBN + 제목/권수 검증)
                    if kyobo_item['isbn'] and kyobo_item['isbn'] in master_db:
                        m = master_db[kyobo_item['isbn']]
                        # [Security Check] ISBN이 같아도 제목이나 권수가 너무 다르면 무시 (ISBN 재사용/오기입 방지)
                        master_norm = normalize_title(m['title_normalized'])
                        current_norm = normalize_title(kyobo_item['title'])
                        
                        # 제목이 어느 정도 유사하거나 (포함 관계 등), 권수가 같으면 매칭 허용
                        if (master_norm in current_norm or current_norm in master_norm) or \
                           (extract_volume_count(m['title_original']) == extract_volume_count(kyobo_item['title'])):
                            kyobo_item['base_price'] = m['base_price']
                            match_found = True
                        else:
                            print(f"  [Match Rejected] ISBN Match but Title/Vol Mismatch: {m['title_original']} vs {kyobo_item['title']}")
                    
                    if not match_found:
                        # 2. 제목 매칭 시 권수 확인 로직 추가
                        kyobo_vols = extract_volume_count(kyobo_item['title'])
                        for isbn, m in master_db.items():
                            if m['title_normalized'] == norm_title:
                                # 제목이 같을 때 권수가 명시되어 있다면 권수도 비교
                                if kyobo_vols > 0 and m.get('total_volumes', 0) > 0:
                                    if abs(kyobo_vols - m['total_volumes']) <= 1:
                                        kyobo_item['base_price'] = m['base_price']
                                        match_found = True
                                        break
                                else:
                                    # 권수 정보가 없으면 제목만으로 매칭 (기존 폴백)
                                    kyobo_item['base_price'] = m['base_price']
                                    match_found = True
                                    break
                    
                    # 3. 알라딘 검색 확충
                    if not match_found:
                        search_res = get_aladin_price_by_search(norm_title)
                        if search_res:
                            kyobo_item['base_price'] = search_res['base_price']
                            pk = search_res['isbn13'] if search_res['isbn13'] else f"ALADIN_{search_res['item_id']}"
                            new_master_entries[pk] = {
                                'isbn13': search_res['isbn13'],
                                'title_normalized': norm_title,
                                'title_original': search_res['title_original'],
                                'author': kyobo_item['author'],
                                'base_price': search_res['base_price'],
                                'cover_url': search_res['cover'].replace('/cover/', '/cover500/').replace('/coversum/', '/cover500/'),
                                'is_adult': search_res['adult'],
                                'is_virtual': search_res.get('is_virtual', False),
                                'aladin_info': {'item_id': search_res['item_id']},
                                'last_updated': time.strftime('%Y-%m-%d %H:%M:%S')
                            }
                            match_found = True
                        else:
                            kyobo_item['base_price'] = kyobo_item['kyobo_price_full']
                            
                    all_kyobo_items.append(kyobo_item)
                
                page += 1
                time.sleep(0.5)
            except Exception as e:
                print(f"Error: {e}")
                break
                
    # 마스터 DB 업데이트
    if new_master_entries:
        print(f"마스터 DB에 {len(new_master_entries)}개 항목 새로 추가 중...")
        master_db.update(new_master_entries)
        with open('public/data/master_comics_db.json', 'w', encoding='utf-8') as f:
            json.dump(master_db, f, ensure_ascii=False, indent=2)
            
    # 교보 결과 저장
    with open('public/data/kyobo_sets.json', 'w', encoding='utf-8') as f:
        json.dump(all_kyobo_items, f, ensure_ascii=False, indent=2)
        
    print(f"수집 완료: 총 {len(all_kyobo_items)}개 항목")
    return all_kyobo_items

if __name__ == "__main__":
    scrape_kyobo_sets()
