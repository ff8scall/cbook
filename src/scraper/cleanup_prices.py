import json
import requests
import re
import time
from bs4 import BeautifulSoup

def get_detailed_info(item_id):
    url = f"https://www.aladin.co.kr/shop/wproduct.aspx?ItemId={item_id}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        res = requests.get(url, headers=headers, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        orig_tag = soup.find('del')
        original_price = 0
        if orig_tag:
            original_price = int(re.sub(r'[^\d]', '', orig_tag.text))
            
        sales_price = 0
        discount_rate = 0
        rent_box = soup.find('div', class_='Ere_rent_box')
        if rent_box:
            rows = rent_box.find_all('tr')
            for row in rows:
                tds = row.find_all('td')
                if not tds: continue
                label_text = tds[0].text.strip()
                # '대여'가 포함되지 않고 '구매' 또는 '소장'이 포함된 행만 선택
                if '구매' in label_text and '대여' not in label_text:
                    p_tag = row.find('span', class_='samnung_pink')
                    if p_tag: 
                        sales_price = int(re.sub(r'[^\d]', '', p_tag.text))
                        rm = re.search(r'(\d+)%', row.text)
                        if rm: discount_rate = int(rm.group(1))
                        break
        
        # 만약 여전히 30%가 넘는다면, 이는 대여 가격일 확률이 높으므로 
        # 페이지 내 다른 구매 가격 요소를 찾거나 정가로 폴백
        if discount_rate > 30:
            # 재정가 도서의 경우 최대 30% 정도가 일반적
            pass 
        
        if sales_price == 0:
            p_tag = soup.find('span', class_='samnung_pink')
            if p_tag: sales_price = int(re.sub(r'[^\d]', '', p_tag.text))
            
        return original_price, sales_price, discount_rate
    except: return 0, 0, 0

def cleanup():
    db_path = 'public/data/master_comics_db.json'
    with open(db_path, 'r', encoding='utf-8') as f:
        db = json.load(f)
        
    count = 0
    total = len(db)
    
    print(f"--- 가격 정제 시작 (총 {total}개 항목) ---")
    
    for i, (k, v) in enumerate(db.items()):
        # 할인이 30%를 넘거나, 정가가 0원이거나, 판매가가 너무 낮은 경우 재검색
        current_rate = v['aladin_info'].get('last_discount', 0)
        if current_rate > 30 or v['base_price'] == 0 or v['aladin_info'].get('last_price', 0) < 3000:
            print(f"[{i+1}/{total}] 수정 중: {v['title_normalized']}")
            orig, sale, rate = get_detailed_info(v['aladin_info']['item_id'])
            if orig > 0:
                v['base_price'] = orig
                v['aladin_info']['last_price'] = sale
                v['aladin_info']['last_discount'] = rate
                count += 1
            time.sleep(0.3)
            
    with open(db_path, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        
    print(f"정제 완료: {count}개 항목 업데이트됨")

if __name__ == "__main__":
    cleanup()
