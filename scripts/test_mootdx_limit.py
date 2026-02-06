from mootdx.quotes import Quotes
import pandas as pd

def test_data_limit():
    print("正在连接通达信服务器并测试 1 分钟数据极限...")
    client = Quotes.factory(market='std')
    
    try:
        symbol = '512890'
        # 通达信单次最大通常是 800 条，我们可以尝试多次或设置较大的 count
        # 注意：这里的 offset 在 bars 接口中由于 mootdx 的封装，通常代表 count (条数)
        # 如果要获取更多，可能需要分段 offset 获取，或者看服务器支持情况
        
        print(f"尝试获取 {symbol} 的 30000 条 (约120个交易日) 1分钟数据...")
        # 尝试通过循环获取更多数据
        all_data = []
        for i in range(40): # 40 * 800 = 32000 条
            start_num = i * 800
            print(f"当前获取第 {i+1} 组 (start={start_num})...")
            df = client.bars(symbol=symbol, frequency=8, start=start_num, offset=800)
            if df is not None and not df.empty:
                all_data.append(df)
                first_date = df.index[0]
                last_date = df.index[-1]
                print(f"  获取成功: {first_date} 至 {last_date} ({len(df)}条)")
            else:
                print(f"  第 {i+1} 组返回为空，到达极限。")
                break
        
        if all_data:
            final_df = pd.concat(all_data)
            print("\n=== 全部测试结果 ===")
            print(f"总条数: {len(final_df)}")
            print(f"最早时间: {final_df.index.min()}")
            print(f"最晚时间: {final_df.index.max()}")
            
            # 计算天数
            days = len(final_df.index.normalize().unique())
            print(f"涵盖交易日数量: {days} 天")
            
    except Exception as e:
        print(f"测试失败: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    test_data_limit()
