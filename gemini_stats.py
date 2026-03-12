import os
import time
import sys
import json
from datetime import datetime

# 설정
LOG_FILE = os.path.expanduser("~/.gemini/telemetry.log")
TOKEN_LIMIT = 1000000  # 기본 한도 설정 (1M 토큰)

def parse_multi_model_stats():
    """로그에서 모델별 최신 사용량을 추출하여 최신순으로 정렬해 반환합니다."""
    if not os.path.exists(LOG_FILE):
        return []
    
    model_stats = {}
    try:
        with open(LOG_FILE, 'r') as f:
            for line in f:
                try:
                    data = json.loads(line)
                    payload = data.get('payload', {})
                    model = payload.get('model', 'Unknown')
                    usage = payload.get('usage', {}) or data.get('usage', {})
                    
                    # 토큰 합산
                    input_t = usage.get('prompt_token_count', 0) or usage.get('input_tokens', 0)
                    output_t = usage.get('candidates_token_count', 0) or usage.get('output_tokens', 0)
                    total = input_t + output_t
                    
                    # 시간 파싱 (로그에 timestamp가 없는 경우 파일 수정 시간 활용)
                    ts = data.get('timestamp', time.time())
                    if isinstance(ts, str):
                        try:
                            # ISO 포맷 등 대응
                            ts = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
                        except:
                            ts = time.time()
                    
                    # 모델별 최신 데이터 갱신
                    model_stats[model] = {
                        "total": total,
                        "time": ts
                    }
                except:
                    continue
    except Exception:
        pass

    # 최신 사용 시간 순으로 정렬하여 상위 3개 반환
    sorted_models = sorted(model_stats.items(), key=lambda x: x[1]['time'], reverse=True)
    return sorted_models[:3]

def get_compact_status():
    stats = parse_multi_model_stats()
    if not stats:
        return "\033[93m[Gemini: No Data]\033[0m"
    
    results = []
    for model_name, data in stats:
        # 남은 % 계산
        used = data['total']
        remaining_pct = max(0, (TOKEN_LIMIT - used) / TOKEN_LIMIT * 100)
        
        # 갱신 시간 포맷 (HH:mm)
        update_time = datetime.fromtimestamp(data['time']).strftime('%H:%M')
        
        # 모델명 단축 (예: gemini-1.5-pro -> 1.5-Pro)
        short_name = model_name.replace('gemini-', '').title()
        
        # 색상 설정
        color = "\033[92m" # Green
        if remaining_pct < 20: color = "\033[91m" # Red
        elif remaining_pct < 50: color = "\033[93m" # Yellow
        
        results.append(f"{short_name}({color}{remaining_pct:.1f}%\033[0m:{update_time})")
    
    return " | ".join(results)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true', help='Print once and exit')
    args = parser.parse_args()

    try:
        if args.once:
            status_line = get_compact_status()
            print(f"{status_line}")
        else:
            # 실시간 갱신 모드
            while True:
                status_line = get_compact_status()
                sys.stdout.write(f"\r\033[K{status_line}")
                sys.stdout.flush()
                time.sleep(5)
    except KeyboardInterrupt:
        if not args.once:
            print("\nExit.")
