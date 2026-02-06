from mootdx.quotes import Quotes

def test_mootdx():
    print("正在尝试连接通达信行情服务器...")
    client = Quotes.factory(market='std') # 标准市场
    
    try:
        # 获取 512890 (证券ETF) 的行情
        # 0: 深市, 1: 沪市. 512890 是沪市
        print("正在获取 512890 的实时快照...")
        quote = client.quotes(symbol='512890')
        print("获取成功:")
        print(quote)
        
        # 尝试不同的周期
        # 9: 日线, 8: 1分钟, 7: 1分钟, 0: 5分钟
        for freq in [9, 8, 0]:
            print(f"\n正在获取 frequency={freq} 的 K 线...")
            # symbol 为 512890
            # frequency 为周期
            # start 为起始位置(0为最新)
            # offset 为获取条数
            klines = client.bars(symbol='512890', frequency=freq, start=0, offset=10)
            if klines is not None and not klines.empty:
                print(f"Frequency {freq} 获取成功:")
                print(klines.tail(2))
            else:
                print(f"Frequency {freq} 返回为空")
        
    except Exception as e:
        print(f"Mootdx 连接或获取失败: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    test_mootdx()
