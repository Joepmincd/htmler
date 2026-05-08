import os, subprocess as sp
from PIL import Image

# Source icon — use custom icon if provided
custom = "/Users/joe/Downloads/新图标.png"
iconset = "build/AppIcon.iconset"
os.makedirs(iconset, exist_ok=True)

if os.path.exists(custom):
    print(f"Using custom icon: {custom}")
    img = Image.open(custom).convert("RGBA")
    # Pad to square
    size = max(img.width, img.height)
    square = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    square.paste(img, ((size - img.width) // 2, (size - img.height) // 2))

    sizes = [
        ("icon_16x16.png", 16),      ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),      ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),   ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),   ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),   ("icon_512x512@2x.png", 1024),
    ]
    for name, sz in sizes:
        square.resize((sz, sz), Image.LANCZOS).save(os.path.join(iconset, name))
else:
    print(f"Custom icon not found at {custom}, generating fallback...")
    import struct, zlib
    def make_png(w, h):
        def chunk(t, d):
            return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        raw = b''
        for y in range(h):
            raw += b'\x00'
            for x in range(w):
                d = ((x - w/2) / (w*0.42))**2 + ((y - h/2) / (h*0.42))**2
                b = 1.0 - min(d, 1.0) * 0.3
                raw += bytes(min(255, int(cv * b)) for cv in (233, 69, 102))
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    base = os.path.join(iconset, "b.png")
    with open(base, 'wb') as f:
        f.write(make_png(1024, 1024))
    sizes = [('icon_16x16.png',16),('icon_16x16@2x.png',32),('icon_32x32.png',32),('icon_32x32@2x.png',64),('icon_128x128.png',128),('icon_128x128@2x.png',256),('icon_256x256.png',256),('icon_256x256@2x.png',512),('icon_512x512.png',512),('icon_512x512@2x.png',1024)]
    for name, sz in sizes:
        sp.run(['sips','-z',str(sz),str(sz),base,'--out',os.path.join(iconset,name)],capture_output=True)

out = "build/HTML Editor.app/Contents/Resources/AppIcon.icns"
sp.run(['iconutil', '-c', 'icns', iconset, '-o', out])
print(f"OK: {out}")
