"""Generate offline phrasebook audio (Uzbek + Russian neural voices) from phrases.json.

Run from the project root:  python tools/make_audio.py
Skips files that already exist; delete audio/<id>-<lang>.mp3 to regenerate one.
"""
import asyncio
import json
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
VOICES = {"uz": "uz-UZ-MadinaNeural", "ru": "ru-RU-SvetlanaNeural"}


async def main():
    out_dir = ROOT / "audio"
    out_dir.mkdir(exist_ok=True)
    groups = json.loads((ROOT / "phrases.json").read_text(encoding="utf-8"))
    for group in groups:
        for item in group["items"]:
            for lang, voice in VOICES.items():
                target = out_dir / f"{item['id']}-{lang}.mp3"
                if target.exists():
                    continue
                await edge_tts.Communicate(item[lang], voice, rate="-10%").save(str(target))
                print("made", target.name)


asyncio.run(main())
