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

def get_ridi_build_id():
    url = "https://ridibooks.com/selection/748?section_id=748"
    headers = {'User-Agent': 'Mozilla/5.0'}
    res = requests.get(url, headers=headers)
    match = re.search(r'"buildId":"(.*?)"', res.text)
    return match.group(1) if match else None

def get_aladin_price_by_search(title):
    """
    마스터 DB에 없는 제목을 알라딘 API에서 검색하여 정가 정보를 가져옵니다.
    """
    search_url = "http://www.aladin.co.kr/ttb/api/ItemSearch.aspx"
    params = {
        'ttbkey': TTB_KEY,
        'Query': title,
        'QueryType': 'Title',
        'MaxResults': 5,
        'start': 1,
        'SearchTarget': 'eBook', # 만화 세트는 주로 eBook에 많음
        'output': 'js',
        'Version': '20131101',
        'CategoryId': 40411 # 만화 카테고리
    }
    
    try:
        res = requests.get(search_url, params=params, timeout=5)
        data = res.json()
        items = data.get('item', [])
        
        # 원본 제목에서 권차 수 추출
        target_vols = extract_volume_count(title)
        
        for item in items:
            item_title = item.get('title', '')
            # 제목에 '세트'가 포함된 상품 찾기
            if '세트' in item_title:
                # 검색된 상품의 권차 수 확인
                item_vols = extract_volume_count(item_title)
                
                # 권수 정보가 둘 다 있다면 일치할 때만 매칭 (정밀 매칭)
                if target_vols > 0 and item_vols > 0:
                    if target_vols != item_vols:
                        continue

                item_id = item.get('itemId')
                # 상세 페이지에서 진짜 정가 추출 (aladin_master의 함수 활용 가능)
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
    except Exception as e:
        print(f"Aladin Search Error for {title}: {e}")
    return None

def scrape_ridi_sets():
    build_id = get_ridi_build_id()
    if not build_id:
        print("Build ID를 찾을 수 없습니다.")
        return []
    
    print(f"Ridi Build ID: {build_id}")
    all_ridi_items = []
    page = 1
    
    # 마스터 DB 업데이트를 위한 리스트
    new_master_entries = {}
    
    while True:
        api_url = f"https://ridibooks.com/_next/data/{build_id}/selection/748.json"
        params = {"section_id": "748", "resourcePath": "748", "page": page}
        
        print(f"Ridi Page {page} 수집 중...")
        res = requests.get(api_url, params=params, headers={'User-Agent': 'Mozilla/5.0'})
        if res.status_code != 200: break
            
        data = res.json()
        items = data.get('pageProps', {}).get('items', [])
        if not items: break
            
        for item in items:
            book = item.get('book', {})
            if not book: continue
            
            ridi_item = {
                'ridi_id': book.get('bookId'),
                'title': book.get('title'),
                'author': book.get('authors', [{}])[0].get('name', 'Unknown'),
                'isbn': book.get('isbn', ''),
                'ridi_price_sale': book.get('purchase', {}).get('salePrice', 0),
                'ridi_price_full': book.get('purchase', {}).get('fullPrice', 0),
                'cover': book.get('cover', {}).get('large', ''),
                'link': f"https://ridibooks.com/books/{book.get('bookId')}"
            }
            
            # 매칭 로직
            match_found = False
            norm_title = normalize_title(ridi_item['title'])
            
            # 1. 기존 마스터 DB 매칭 (ISBN + 제목/권수 검증)
            if ridi_item['isbn'] and ridi_item['isbn'] in master_db:
                m = master_db[ridi_item['isbn']]
                # [Security Check] ISBN이 같아도 제목이나 권수가 너무 다르면 무시 (ISBN 재사용/오기입 방지)
                master_norm = normalize_title(m['title_normalized'])
                current_norm = normalize_title(ridi_item['title'])
                
                # 제목이 어느 정도 유사하거나 (포함 관계 등), 권수가 같으면 매칭 허용
                if (master_norm in current_norm or current_norm in master_norm) or \
                   (extract_volume_count(m['title_original']) == extract_volume_count(ridi_item['title'])):
                    ridi_item['base_price'] = m['base_price']
                    match_found = True
                else:
                    print(f"  [Match Rejected] ISBN Match but Title/Vol Mismatch: {m['title_original']} vs {ridi_item['title']}")
            
            if not match_found:
                # 2. 제목 매칭 시 권수 확인 로직 추가
                ridi_vols = extract_volume_count(ridi_item['title'])
                for isbn, m in master_db.items():
                    if m['title_normalized'] == norm_title:
                        # 제목이 같을 때 권수가 명시되어 있다면 권수도 비교
                        if ridi_vols > 0 and m.get('total_volumes', 0) > 0:
                            if abs(ridi_vols - m['total_volumes']) <= 1: # 1권 정도 차이는 허용 (외전 등)
                                ridi_item['base_price'] = m['base_price']
                                match_found = True
                                break
                        else:
                            # 권수 정보가 없으면 제목만으로 매칭 (기존 폴백)
                            ridi_item['base_price'] = m['base_price']
                            match_found = True
                            break
            
            # 2. 마스터 DB에 없으면 알라딘 검색 (동적 확보)
            if not match_found:
                try:
                    print(f"  > 마스터 DB 매칭 실패. 알라딘 검색 시도: {norm_title}")
                except UnicodeEncodeError:
                    print(f"  > 마스터 DB 매칭 실패. 알라딘 검색 시도: (인코딩할 수 없는 제목)")
                    
                search_res = get_aladin_price_by_search(norm_title)
                if search_res:
                    print(f"    [성공] 알라딘에서 정가 발견: {search_res['base_price']}원")
                    ridi_item['base_price'] = search_res['base_price']
                    # 마스터 DB에 추가 예약
                    pk = search_res['isbn13'] if search_res['isbn13'] else f"ALADIN_{search_res['item_id']}"
                    new_master_entries[pk] = {
                        'isbn13': search_res['isbn13'],
                        'title_normalized': norm_title,
                        'title_original': search_res['title_original'],
                        'author': ridi_item['author'],
                        'base_price': search_res['base_price'],
                        'cover_url': search_res['cover'].replace('/cover/', '/cover500/').replace('/coversum/', '/cover500/'),
                        'is_adult': search_res['adult'],
                        'is_virtual': search_res.get('is_virtual', False),
                        'aladin_info': {'item_id': search_res['item_id']},
                        'last_updated': time.strftime('%Y-%m-%d %H:%M:%S')
                    }
                    match_found = True
                else:
                    ridi_item['base_price'] = ridi_item['ridi_price_full'] # 최종 폴백
            
            all_ridi_items.append(ridi_item)
            
        page += 1
        # 페이지 당 딜레이
        time.sleep(1)
        # if page > 2: break # 모든 페이지 수집을 위해 주석 처리
        
    # 새로운 마스터 데이터 저장
    if new_master_entries:
        print(f"마스터 DB에 {len(new_master_entries)}개 항목 새로 추가 중...")
        master_db.update(new_master_entries)
        with open('public/data/master_comics_db.json', 'w', encoding='utf-8') as f:
            json.dump(master_db, f, ensure_ascii=False, indent=2)
    
    # 수집 결과 저장
    with open('public/data/ridi_sets.json', 'w', encoding='utf-8') as f:
        json.dump(all_ridi_items, f, ensure_ascii=False, indent=2)
        
    print(f"수집 완료: 총 {len(all_ridi_items)}개 항목")
    return all_ridi_items

if __name__ == "__main__":
    scrape_ridi_sets()
