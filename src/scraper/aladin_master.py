import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
import json
import re
import time
import hashlib

# .env 파일 로드
load_dotenv()
TTB_KEY = os.getenv('ALADIN_TTB_KEY')
DB_PATH = 'public/data/master_comics_db.json'

def normalize_title(title):
    """
    제목에서 불필요한 수식어를 제거하여 정규화합니다.
    예: [고화질세트] 주술회전 (총30권/완결) -> 주술회전
    """
    # 1. [] 대괄호 내용 제거
    title = re.sub(r'\[.*?\]', '', title)
    # 2. () 소괄호 내용 제거 (권수 정보 등)
    title = re.sub(r'\(.*?\)', '', title)
    # 3. 주요 키워드 제거
    title = title.replace('세트', '').replace('전권', '').replace('완결', '')
    return title.strip()

def get_aggregated_price(title):
    """
    세트 상품이 없을 경우 개별 권차의 정가를 합산하여 반환
    """
    search_url = "http://www.aladin.co.kr/ttb/api/ItemSearch.aspx"
    params = {
        'ttbkey': TTB_KEY,
        'Query': title,
        'QueryType': 'Title',
        'MaxResults': 50,
        'SearchTarget': 'eBook',
        'output': 'js',
        'Version': '20131101',
        'CategoryId': 40411
    }
    try:
        res = requests.get(search_url, params=params, timeout=5)
        data = res.json()
        items = data.get('item', [])
        
        base_title = normalize_title(title)
        volumes = []
        for item in items:
            item_title = item.get('title', '')
            # 시리즈 제목이 포함되어 있고, '세트'가 아닌 단권인 경우 (숫자 포함 여부로 판별 보조)
            if base_title in item_title and '세트' not in item_title:
                volumes.append(item)
        
        if volumes:
            total_price = sum(v.get('priceStandard', 0) for v in volumes)
            return {
                'base_price': total_price,
                'volumes_count': len(volumes),
                'representative_item': volumes[0]
            }
    except: pass
    return None

def extract_volume_count(title):
    """
    제목에서 총 권수를 추출합니다.
    예: (총30권/완결) -> 30
    """
    # 다양한 패턴 지원 (총 N권, 전 N권, N권/완결, N권 세트 등)
    match = re.search(r'총\s?(\d+)권', title)
    if not match:
        match = re.search(r'전\s?(\d+)권', title)
    if not match:
        match = re.search(r'(\d+)권\s?세트', title)
    if not match:
        match = re.search(r'\(.*?(\d+)권.*?\)', title)
        
    if match:
        return int(match.group(1))
    return 0

def get_detailed_info(item_id):
    """
    상세 페이지에서 정가, 할인가, 할인율을 추출합니다.
    """
    url = f"https://www.aladin.co.kr/shop/wproduct.aspx?ItemId={item_id}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code != 200:
            return None
            
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 정가 (Original Price) - 'del' 태그에서 추출
        orig_tag = soup.find('del')
        original_price = 0
        if orig_tag:
            price_text = re.sub(r'[^\d]', '', orig_tag.text)
            if price_text:
                original_price = int(price_text)
        
        # 판매가 (Purchase Price) - 대여가 아닌 '구매' 행의 가격을 찾아야 함
        sales_price = 0
        discount_rate = 0
        
        # Ere_rent_box 내의 테이블 행들을 탐색
        rent_box = soup.find('div', class_='Ere_rent_box')
        if rent_box:
            rows = rent_box.find_all('tr')
            for row in rows:
                cols = row.find_all('td')
                if not cols: continue
                label = cols[0].text.strip()
                if '구매' in label:
                    price_tag = row.find('span', class_='samnung_pink')
                    if price_tag:
                        price_text = re.sub(r'[^\d]', '', price_tag.text)
                        if price_text:
                            sales_price = int(price_text)
                    # 해당 행의 할인율 추출
                    rate_match = re.search(r'(\d+)%', row.text)
                    if rate_match:
                        discount_rate = int(rate_match.group(1))
                    break
        
        # 만약 rent_box 방식이 실패하면 (구형 페이지 등), 기존 방식 폴백
        if sales_price == 0:
            sale_tag = soup.find('span', class_='samnung_pink')
            if sale_tag:
                price_text = re.sub(r'[^\d]', '', sale_tag.text)
                if price_text:
                    sales_price = int(price_text)
        
        return {
            'base_price': original_price,
            'current_price': sales_price,
            'discount_rate': discount_rate
        }
    except Exception as e:
        print(f"Error scraping detail for {item_id}: {e}")
        return None

def get_api_data(item_id):
    """
    알라딘 API를 통해 기본 메타데이터를 가져옵니다.
    """
    api_url = "http://www.aladin.co.kr/ttb/api/ItemLookUp.aspx"
    params = {
        'ttbkey': TTB_KEY,
        'itemId': item_id,
        'itemIdType': 'ItemId',
        'output': 'js',
        'Version': '20131101'
    }
    
    try:
        response = requests.get(api_url, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if 'item' in data and len(data['item']) > 0:
                return data['item'][0]
    except Exception:
        return None
    return None

def build_master_db(event_id=270007):
    """
    이벤트 페이지에서 완결 세트를 찾아 마스터 DB를 구축합니다.
    """
    print(f"--- 마스터 DB 구축 시작 (대상 이벤트: {event_id}) ---")
    
    # 1. 이벤트 페이지에서 상품 ID 목록 가져오기 (이전 로직 활용)
    event_url = f"https://www.aladin.co.kr/events/wevent.aspx?EventId={event_id}"
    res = requests.get(event_url)
    soup = BeautifulSoup(res.text, 'html.parser')
    links = soup.find_all('a', href=re.compile(r'ItemId=\d+'))
    
    item_ids = list(set([re.search(r'ItemId=(\d+)', a.get('href')).group(1) for a in links if re.search(r'ItemId=(\d+)', a.get('href'))]))
    print(f"총 {len(item_ids)}개의 후보 상품 발견.")
    
    # 기존 DB 로드 (데이터 보존)
    if os.path.exists(DB_PATH):
        with open(DB_PATH, 'r', encoding='utf-8') as f:
            master_db = json.load(f)
        print(f"기존 마스터 DB 로드 완료 ({len(master_db)}개 항목)")
    else:
        master_db = {}
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    for i, item_id in enumerate(item_ids):
        print(f"[{i+1}/{len(item_ids)}] 처리 중: {item_id}...", end='\r')
        
        # API 데이터 확보
        api_item = get_api_data(item_id)
        if not api_item: continue
        
        # 완결 세트 여부 확인
        title = api_item.get('title', '')
        if '완결' not in title and '세트' not in title: continue
        
        # 상세 가격 정보 확보
        price_info = get_detailed_info(item_id)
        if not price_info: continue
        
        # 데이터 정규화
        isbn13 = api_item.get('isbn13', '')
        # ISBN이 없는 경우 Fallback Key 생성 (Aladin ID 기반)
        pk = isbn13 if isbn13 and isbn13 != '0' else f"ALADIN_{item_id}"
        
        normalized_title = normalize_title(title)
        volumes = extract_volume_count(title)
        
        master_entry = {
            'isbn13': isbn13,
            'title_normalized': normalized_title,
            'title_original': title,
            'author': api_item.get('author', ''),
            'publisher': api_item.get('publisher', ''),
            'total_volumes': volumes,
            'base_price': price_info['base_price'],
            'cover_url': api_item.get('cover', '').replace('/cover/', '/cover500/').replace('/coversum/', '/cover500/'),
            'category': api_item.get('categoryName', ''),
            'is_adult': api_item.get('adult', False),
            'description': api_item.get('description', ''),
            'pub_date': api_item.get('pubDate', ''),
            'mall_type': api_item.get('mallType', 'Book'),
            'stock_status': api_item.get('stockStatus', ''),
            'mileage': api_item.get('mileage', 0),
            'customer_review_rank': api_item.get('customerReviewRank', 0),
            'aladin_info': {
                'item_id': item_id,
                'link': api_item.get('link', ''),
                'last_price': price_info['current_price'],
                'last_discount': price_info['discount_rate']
            },
            'last_updated': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        
        master_db[pk] = master_entry
        time.sleep(0.3) # 서버 부하 방지 및 차단 예방
        
    print(f"\n마스터 DB 업데이트 완료! 총 {len(master_db)}개의 완결 세트 저장됨.")
    
    with open(DB_PATH, 'w', encoding='utf-8') as f:
        json.dump(master_db, f, ensure_ascii=False, indent=2)

    # 현재 판매 중인 딜만 별도로 저장 (프론트엔드 노출용)
    current_deals = []
    for pk, m in master_db.items():
        # 최근에 업데이트된 항목 중 알라딘 정보가 있는 것들 추출
        if 'aladin_info' in m:
            current_deals.append({
                'isbn': m['isbn13'],
                'title': m['title_original'],
                'author': m['author'],
                'base_price': m['base_price'],
                'discount_price': m['aladin_info']['last_price'],
                'discount_rate': m['aladin_info']['last_discount'],
                'cover': m['cover_url'],
                'link': m['aladin_info']['link'],
                'is_adult': m['is_adult']
            })
    
    sets_path = os.path.join(os.path.dirname(DB_PATH), 'aladin_sets.json')
    with open(sets_path, 'w', encoding='utf-8') as f:
        json.dump(current_deals, f, ensure_ascii=False, indent=2)
    
    print(f"현재 판매 중인 딜 {len(current_deals)}건 저장 완료: {sets_path}")
    return master_db

if __name__ == "__main__":
    build_master_db()
