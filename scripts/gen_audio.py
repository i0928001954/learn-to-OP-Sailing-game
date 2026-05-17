"""
Generate bear coach voice lines using Microsoft edge-tts neural voices.

Usage (run on your local machine):
  pip install edge-tts
  python scripts/gen_audio.py

Output: public/audio/bear/<category>_<index>.mp3  (~20 files, ~2MB)

Voice: zh-TW-YunJheNeural  (male, natural Taiwanese Mandarin)
"""
import asyncio, os, sys, json

try:
    import edge_tts
except ImportError:
    sys.exit("Please install edge-tts first:  pip install edge-tts")

VOICE = "zh-TW-YunJheNeural"
COACH_ID = "bear"

# Load tips from JSON file
def load_tips():
    json_path = os.path.join(os.path.dirname(__file__), "..", "public", "coaches", f"{COACH_ID}.json")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {cat: tips["text"] for cat, tips in data.items()}
    except Exception as e:
        sys.exit(f"Error loading {json_path}: {e}")

LINES = load_tips()
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "audio", COACH_ID)

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
    print(f"Loading tips from public/coaches/{COACH_ID}.json")
    print(f"Generating {total} audio files → {OUT_DIR}\n")
    for cat, texts in LINES.items():
        for i, text in enumerate(texts):
            await gen_one(cat, i, text)
            await asyncio.sleep(0.3)   # polite rate limit
    print("\nDone! Commit public/audio/ to your repo.")

asyncio.run(main())
