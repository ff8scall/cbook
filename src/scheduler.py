import schedule
import time
import subprocess
import sys
import os

def job():
    print(f"\n[Scheduler] 시간 엄수! 작업을 시작합니다: {time.strftime('%H:%M:%S')}")
    # run_all.py를 별도 프로세스로 실행
    subprocess.run([sys.executable, "run_all.py"])

# 00:30 및 12:30에 실행 예약
schedule.every().day.at("00:30").do(job)
schedule.every().day.at("12:30").do(job)

print("="*50)
print("🚀 Antigravity 자동 스케줄러 가동 중...")
print("- 실행 예약 시간: 매일 00:30, 12:30")
print("- 이 창을 열어두시면 정해진 시간에 수집이 시작됩니다.")
print("="*50)

# 테스트용 (지금 바로 한 번 실행해보고 싶다면 아래 주석을 해제하세요)
# job()

while True:
    schedule.run_pending()
    time.sleep(60) # 1분마다 체크
