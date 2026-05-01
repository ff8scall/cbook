import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
import json
import re
import time

# .env 파일 로드
load_dotenv()
TTB_KEY = os.getenv('ALADIN_TTB_KEY')

def get_event_items(event_id):
    """
    알라딘 이벤트 페이지에서 상품 정보(ID, 정가, 할인가)를 추출합니다.
    """
    url = f"https://www.aladin.co.kr/events/wevent.aspx?EventId={event_id}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"Failed to fetch event page: {response.status_code}")
        return []

    soup = BeautifulSoup(response.text, 'html.parser')
    items = []
    
    # 각 상품 정보를 담고 있는 컨테이너 찾기
    # 알라딘 이벤트 페이지는 보통 'td' 또는 'div' 내에 상품 정보가 나열됨
    # 'ItemId=' 링크가 포함된 영역을 기준으로 탐색
    containers = soup.find_all(re.compile(r'(div|td|li)'))
    
    seen_ids = set()
    for container in containers:
        link = container.find('a', href=re.compile(r'ItemId=\d+'))
        if not link: continue
        
        href = link.get('href')
        match = re.search(r'ItemId=(\d+)', href)
        if not match: continue
        
        item_id = match.group(1)
        if item_id in seen_ids: continue
        
        # 가격 정보 추출 (예: 30,800원 / 1,540원)
        text = container.get_text(separator=' ')
        # 숫자와 콤마, '원' 그리고 슬래시가 포함된 패턴 찾기
        price_match = re.findall(r'([\d,]+)원', text)
        
        if len(price_match) >= 2:
            # 보통 정가 / 할인가 순서로 나옴
            original_price = int(price_match[0].replace(',', ''))
            discounted_price = int(price_match[1].replace(',', ''))
            
            seen_ids.add(item_id)
            items.append({
                'itemId': item_id,
                'eventOriginalPrice': original_price,
                'eventDiscountedPrice': discounted_price,
                'calculatedDiscountRate': round((1 - discounted_price / original_price) * 100) if original_price > 0 else 0
            })
            
    return items

def get_item_details(item_id):
    """
    알라딘 API를 사용하여 상품 상세 정보를 가져옵니다.
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

def is_comic_set(item):
    """
    상품이 만화책 세트인지 확인합니다.
    """
    title = item.get('title', '')
    category = item.get('categoryName', '')
    
    # 만화 카테고리 확인
    if '만화' not in category:
        return False
    
    # 세트 키워드 확인
    set_keywords = ['세트', '전권', '총권', '완결', '박스']
    if any(kw in title for kw in set_keywords):
        return True
        
    return False

def main():
    event_id = 270007
    print(f"--- 알라딘 이벤트 {event_id} 만화 세트 데이터 수집 시작 ---")
    
    event_items = get_event_items(event_id)
    print(f"이벤트 페이지에서 {len(event_items)}개의 상품 정보를 찾았습니다.")
    
    results = []
    
    for i, e_item in enumerate(event_items):
        item_id = e_item['itemId']
        print(f"[{i+1}/{len(event_items)}] API 고도화 중: {item_id}...", end='\r')
        
        details = get_item_details(item_id)
        if details and is_comic_set(details):
            item_info = {
                'title': details['title'],
                'author': details['author'],
                'originalPrice': e_item['eventOriginalPrice'],
                'discountPrice': e_item['eventDiscountedPrice'],
                'discountRate': e_item['calculatedDiscountRate'],
                'category': details['categoryName'],
                'cover': details['cover'],
                'link': details['link'],
                'itemId': item_id,
                'isbn': details.get('isbn13', details.get('isbn', ''))
            }
            results.append(item_info)
            time.sleep(0.1) # API 부하 방지
            
    print(f"\n수집 완료! 최종 {len(results)}개의 만화 세트를 추출했습니다.")
    
    # 할인율 높은 순으로 정렬
    results.sort(key=lambda x: x['discountRate'], reverse=True)
    
    # JSON 저장
    output_path = 'aladin_sets.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    # 상위 10개 출력
    print("\n--- 주요 할인 상품 (Top 10) ---")
    for s in results[:10]:
        print(f"[{s['discountRate']}% 할인] {s['title']} ({s['originalPrice']}원 -> {s['discountPrice']}원)")

if __name__ == "__main__":
    main()