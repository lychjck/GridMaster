import requests

symbol = "512890"
url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
params = {
    "secid": f"1.{symbol}",
    "fields1": "f1,f2,f3,f4,f5,f6",
    "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64",
    "klt": "1", # 1 minute for quick check
    "fqt": "0", # Unadjusted
    "beg": "20240101",
    "end": "20240201",
    # "lmt": "24000000" 
}

print("Requesting...")
try:
    r = requests.get(url, params=params, timeout=10)
    data = r.json()
    print(data)
    if data["data"] and data["data"]["klines"]:
        klines = data["data"]["klines"]
        print(f"Received {len(klines)} klines")
        print("First 5:", klines[:5])
        print("Last 5:", klines[-5:])
    else:
        print("No data or error:", data)
except Exception as e:
    print(e)
