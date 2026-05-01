import subprocess
import time
import os
import sys

def run_script(script_path, cwd=None):
    print(f"\n[Running] {script_path}...")
    try:
        # PYTHONPATH를 src/scraper로 설정하여 모듈 임포트 지원
        env = os.environ.copy()
        env["PYTHONPATH"] = os.path.join(os.getcwd(), "src", "scraper")
        
        result = subprocess.run([sys.executable, script_path], cwd=cwd, env=env)
        if result.returncode == 0:
            print(f"[Success] {script_path} finished.")
        else:
            print(f"[Error] {script_path} failed with exit code {result.returncode}")
    except Exception as e:
        print(f"[Exception] {e}")

def run_all_tasks():
    print("="*50)
    print(f"Starting Scheduled Scraping: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*50)
    
    # 1. 알라딘 마스터 DB 및 딜 수집
    run_script("src/scraper/aladin_master.py")
    
    # 2. 리디북스 세트 수집
    run_script("src/scraper/ridi_scraper.py")
    
    # 3. 교보문고 세트 수집
    run_script("src/scraper/kyobo_scraper.py")
    
    # 4. 전체 동기화 (선택 사항, 필요 시 추가)
    # run_script("scratch/mega_sync.py")
    
    print("\n" + "="*50)
    print(f"All Tasks Completed: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*50)

if __name__ == "__main__":
    run_all_tasks()
