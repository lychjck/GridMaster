from binance.spot import Spot
import pandas as pd
from datetime import datetime
import os

def test_binance_connection():
    # 配置代理 (修改为 7897)
    proxies = {
        'http': 'http://127.0.0.1:7897',
        'https': 'http://127.0.0.1:7897'
    }

    env_proxy = os.getenv("BINANCE_BASE_URL")
    proxies = {
        'http': env_proxy,
        'https': env_proxy
    } if env_proxy else None
    
    # 使用币安公开接口（传入代理配置）
    client = Spot(base_url='https://lychjck.qzz.io')
    
    symbol = "BTCUSDT"
    interval = "1m"
    limit = 5
    
    print(f"--- 正在尝试连接币安获取 {symbol} 实时数据 ---")
    
    try:
        # 获取最近 5 条 K 线
        klines = client.klines(symbol=symbol, interval=interval, limit=limit)
        
        # 币安返回的数据格式：
        # [
        #   [ 开盘时间(ms), 开, 高, 低, 收, 成交量, 收盘时间(ms), 成交额, 成交笔数, ... ]
        # ]
        
        print(f"成功获取 {len(klines)} 条数据！\n")
        print(f"{'时间':<20} | {'开盘价':<10} | {'最高价':<10} | {'最低价':<10} | {'收盘价':<10} | {'成交额(USDT)':<12}")
        print("-" * 85)
        
        for k in klines:
            ts = datetime.fromtimestamp(k[0] / 1000).strftime('%Y-%m-%d %H:%M:%S')
            open_p = k[1]
            high_p = k[2]
            low_p = k[3]
            close_p = k[4]
            amount = float(k[7]) # 成交额
            
            print(f"{ts:<20} | {open_p:<10} | {high_p:<10} | {low_p:<10} | {close_p:<10} | {amount:<12.2f}")
            
        print("\n--- 测试成功！---")
        print("提示：如果你能看到上面的表格，说明你的网络可以直接访问币安。")
        
    except Exception as e:
        print(f"\n--- 测试失败 ---")
        print(f"错误原因: {e}")
        print("\n提示：如果报错是 'Connection reset' 或 'Timeout'，通常需要配置代理。")

if __name__ == "__main__":
    test_binance_connection()
