#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
悟空邀请码监控 - 简化版本
说明：这个脚本由定时任务调用，通过 use_browser 工具在后台获取图片 URL
"""

import os
import sys
import json
import requests
from datetime import datetime
from pathlib import Path

# 配置
CONFIG = {
    "history_file": "/Users/staryang/.real/workspace/wukong_invite_history.json",
    "screenshot_dir": "/Users/staryang/.real/workspace/wukong_screenshots",
    "current_url_file": "/Users/staryang/.real/workspace/wukong_current_image_url.txt",
    "notification_file": "/Users/staryang/.real/workspace/wukong_notification.txt"
}

def ensure_dirs():
    """确保所需目录存在"""
    Path(CONFIG["screenshot_dir"]).mkdir(parents=True, exist_ok=True)

def load_last_url():
    """加载上次记录的 URL"""
    if os.path.exists(CONFIG["current_url_file"]):
        try:
            with open(CONFIG["current_url_file"], 'r', encoding='utf-8') as f:
                return f.read().strip()
        except:
            pass
    return ""

def save_current_url(url):
    """保存当前 URL"""
    with open(CONFIG["current_url_file"], 'w', encoding='utf-8') as f:
        f.write(url)

def load_history():
    """加载历史记录"""
    if os.path.exists(CONFIG["history_file"]):
        try:
            with open(CONFIG["history_file"], 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {
        "changes": [],
        "last_check_time": "",
        "check_count": 0
    }

def save_history(history):
    """保存历史记录"""
    with open(CONFIG["history_file"], 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

def download_image(image_url, filename):
    """下载图片并保存"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        response = requests.get(image_url, headers=headers, timeout=10)
        response.raise_for_status()
        
        filepath = os.path.join(CONFIG["screenshot_dir"], filename)
        with open(filepath, 'wb') as f:
            f.write(response.content)
        
        return filepath
    except Exception as e:
        print(f"下载图片失败：{e}")
        return None

def write_notification(message, level="info"):
    """写入通知文件"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    full_message = f"[{timestamp}] [{level}] {message}"
    
    with open(CONFIG["notification_file"], 'w', encoding='utf-8') as f:
        f.write(full_message)
    
    print(full_message)
    return full_message

def check_and_notify(new_url, invite_name=""):
    """对比 URL 并发送通知"""
    ensure_dirs()
    
    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 开始检查...")
    print(f"新 URL: {new_url}")
    
    # 加载上次的 URL
    last_url = load_last_url()
    print(f"旧 URL: {last_url if last_url else '(首次检测)'}")
    
    # 加载历史记录
    history = load_history()
    history["check_count"] = history.get("check_count", 0) + 1
    
    # 对比完整 URL（包括所有参数）
    if new_url != last_url:
        print("✨ 检测到变化！")
        
        # 下载新图片
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"invite_{timestamp}.png"
        filepath = download_image(new_url, filename)
        
        if filepath:
            print(f"图片已保存：{filepath}")
        
        # 记录历史变化
        change_record = {
            "time": datetime.now().isoformat(),
            "old_url": last_url,
            "new_url": new_url,
            "screenshot": filename,
            "change_detected": True
        }
        history["changes"].append(change_record)
        
        # 只保留最近 100 条记录
        if len(history["changes"]) > 100:
            history["changes"] = history["changes"][-100:]
        
        # 更新状态
        history["last_check_time"] = datetime.now().isoformat()
        save_history(history)
        save_current_url(new_url)
        
        # 生成通知消息
        if last_url:  # 不是首次检测
            message = f"🎉 悟空邀请码已刷新！\n\n当前邀请码：{invite_name if invite_name else '未知'}\n新图片 URL: {new_url}\n查看图片：{filepath if filepath else '下载失败'}"
            write_notification(message, "success")
        else:
            message = f"✅ 首次检测完成\n\n当前邀请码：{invite_name if invite_name else '未知'}\n图片 URL: {new_url}\n图片已保存：{filepath if filepath else '下载失败'}"
            write_notification(message, "info")
        
        return True, message
    else:
        print("✅ 邀请码未变化")
        history["last_check_time"] = datetime.now().isoformat()
        save_history(history)
        
        message = f"✅ 检查完成，邀请码未变化\n\n当前邀请码：{invite_name if invite_name else '未知'}\n图片 URL: {new_url}"
        write_notification(message, "info")
        
        return False, message

def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("用法：python wukong_monitor_simple.py <图片 URL> [邀请码名称]")
        print("\n示例:")
        print("  python wukong_monitor_simple.py 'https://gw.alicdn.com/imgextra/i2/O1CN014rrA4G26jk2jP53VN_!!6000000007698-2-tps-1974-540.png?v=8' '黑河沉马路'")
        sys.exit(1)
    
    new_url = sys.argv[1]
    invite_name = sys.argv[2] if len(sys.argv) > 2 else ""
    
    changed, message = check_and_notify(new_url, invite_name)
    
    # 输出结果供定时任务读取
    print(f"\n===RESULT==={changed}==={message}===")

if __name__ == "__main__":
    main()
