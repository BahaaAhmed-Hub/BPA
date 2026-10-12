# python3 scripts/make-barcode.py <isbn13> <out-dir>
# Draws a real EAN-13 (the symbology on a book's back cover) and writes it as a
# PNG and as a looping Y4M clip, which Chromium can be told to use as its fake
# camera (--use-file-for-fake-video-capture). Written out by hand from the EAN-13
# tables so the fixture is the actual standard, not a library's reading of it.
import sys
from PIL import Image, ImageDraw

L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100']
PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']

def ean13_modules(code):
    d = [int(c) for c in code]
    s = '101'
    for i, p in enumerate(PARITY[d[0]]):
        s += (L if p == 'L' else G)[d[i + 1]]
    s += '01010'
    for i in range(7, 13):
        s += R[d[i]]
    return s + '101'

def draw(code, w=640, h=480, module=4):
    m = ean13_modules(code)
    img = Image.new('RGB', (w, h), 'white')
    dr = ImageDraw.Draw(img)
    x0 = (w - len(m) * module) // 2
    for i, c in enumerate(m):
        if c == '1':
            dr.rectangle([x0 + i * module, h // 2 - 70, x0 + (i + 1) * module - 1, h // 2 + 70], fill='black')
    return img

def y4m(img, path, frames=40):
    w, h = img.size
    ycc = img.convert('YCbCr')
    y = bytes(ycc.getchannel(0).tobytes())
    cb = ycc.getchannel(1).resize((w // 2, h // 2)).tobytes()
    cr = ycc.getchannel(2).resize((w // 2, h // 2)).tobytes()
    with open(path, 'wb') as f:
        f.write(f'YUV4MPEG2 W{w} H{h} F10:1 Ip A1:1 C420jpeg\n'.encode())
        for _ in range(frames):
            f.write(b'FRAME\n'); f.write(y); f.write(cb); f.write(cr)

if __name__ == '__main__':
    code, out = sys.argv[1], sys.argv[2]
    img = draw(code)
    img.save(f'{out}/{code}.png')
    y4m(img, f'{out}/{code}.y4m')
