"""IOCapture アプリアイコン生成: ダークな角丸スクエア＋四隅ブラケット（キャプチャ枠）。"""
from PIL import Image, ImageDraw

N = 1024
img = Image.new("RGBA", (N, N), (0, 0, 0, 0))

# 背景: 縦グラデーション（上が少し明るいダーク）
grad = Image.new("RGB", (1, N))
top = (26, 26, 30)
bot = (10, 10, 12)
for y in range(N):
    t = y / (N - 1)
    grad.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
grad = grad.resize((N, N))

# 角丸マスク（macOS風スクエア）
m = 92
R = 224
mask = Image.new("L", (N, N), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([m, m, N - m, N - m], radius=R, fill=255)
img.paste(grad, (0, 0), mask)

draw = ImageDraw.Draw(img)

# 四隅ブラケット（キャプチャ枠）
fi = 300          # frame inset from canvas edge
L = 168           # arm length
t = 40            # thickness
r = t // 2        # cap radius
x0, y0 = fi, fi
x1, y1 = N - fi, N - fi
col = (250, 250, 250, 255)

def bar(a, b, c, d):
    draw.rounded_rectangle([a, b, c, d], radius=r, fill=col)

# top-left
bar(x0, y0, x0 + L, y0 + t)
bar(x0, y0, x0 + t, y0 + L)
# top-right
bar(x1 - L, y0, x1, y0 + t)
bar(x1 - t, y0, x1, y0 + L)
# bottom-left
bar(x0, y1 - t, x0 + L, y1)
bar(x0, y1 - L, x0 + t, y1)
# bottom-right
bar(x1 - L, y1 - t, x1, y1)
bar(x1 - t, y1 - L, x1, y1)

# 中央の小さなアクセント（青ドット）
cd = 30
cx, cy = N // 2, N // 2
draw.ellipse([cx - cd, cy - cd, cx + cd, cy + cd], fill=(59, 130, 246, 255))

img.save("scripts/icon_1024.png")
print("wrote scripts/icon_1024.png")
