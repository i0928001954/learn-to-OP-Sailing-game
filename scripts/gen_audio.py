"""
Generate bear coach voice lines using Microsoft edge-tts neural voices.

Usage (run on your local machine):
  pip install edge-tts
  python scripts/gen_audio.py

Output: public/audio/<category>_<index>.mp3  (25 files total, ~2MB)

Voice: zh-TW-YunJheNeural  (male, natural Taiwanese Mandarin)
"""
import asyncio, os, sys

try:
    import edge_tts
except ImportError:
    sys.exit("Please install edge-tts first:  pip install edge-tts")

VOICE = "zh-TW-YunJheNeural"

LINES = {
    "noGoZone":  ["這方向頂風，船在罷工啦！快轉！","嗯哼，進死角了！換個角度！","頂風衝？勇氣可嘉但船不動喔！"],
    "sailTooIn": ["帆繃那麼緊幹嘛，讓風進來啊！","帆角太小，風都憋死了！放開！","帆縮那麼緊，船飛不起來啦！"],
    "sailTooOut":["帆放那麼開，是在晾衣服嗎？","帆都快飛走了！快收一點！","帆角太大，風都跑光了！收！"],
    "goodSpeed": ["就這樣！年輕人有希望！","速度到位！老師我感動了！"],
    "slowSpeed": ["這速度，龜都比你快啦！","動起來！老師我看了很著急！"],
    "nearMark":  ["那個浮標！繞過去！","快到了！眼睛放亮！","目標在眼前，漂亮繞過去！"],
    "tacking":   ["換舷！帆跟著換邊！","Z字形走法，這才是帆船精髓！","漂亮轉彎！帆調好！"],
    "finish":    ["開得好！教練請你吃鬆餅！"],
    "start":     ["出發！讓風看看你多厲害！","預備——衝！帥氣的！","年輕人，展示你的本事！走！"],
}

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "audio")

async def gen_one(cat, idx, text):
    path = os.path.join(OUT_DIR, f"{cat}_{idx}.mp3")
    if os.path.exists(path):
        print(f"  skip  {cat}_{idx} (already exists)")
        return
    tts = edge_tts.Communicate(text, VOICE, rate="+5%", pitch="-8Hz")
    await tts.save(path)
    size = os.path.getsize(path) // 1024
    print(f"  saved {cat}_{idx}.mp3  ({size}KB)  {text[:24]}")

async def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total = sum(len(v) for v in LINES.values())
    print(f"Generating {total} audio files → {OUT_DIR}\n")
    for cat, texts in LINES.items():
        for i, text in enumerate(texts):
            await gen_one(cat, i, text)
            await asyncio.sleep(0.3)   # polite rate limit
    print("\nDone! Commit public/audio/ to your repo.")

asyncio.run(main())
