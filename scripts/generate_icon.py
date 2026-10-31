"""Build an original Windows ICO using Pillow (no downloaded icon or fonts).

The icon is generated at packaging time and embedded by PyInstaller during
EXE creation, avoiding post-build modifications of signed/compiled binaries.
"""
from pathlib import Path
from PIL import Image, ImageDraw


def build(out: Path) -> None:
    size = 256
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((12, 12, 244, 244), radius=48, fill="#202630")
    d.ellipse((45, 56, 135, 146), outline="#dc8479", width=22)
    d.line((119, 128, 206, 214), fill="#e3aa85", width=28, joint="curve")
    d.line((165, 172, 186, 149), fill="#e3aa85", width=20)
    d.line((184, 192, 205, 171), fill="#e3aa85", width=20)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    build(Path("build/assets/Keymaster.ico"))
    print("Built embedded Keymaster icon")
