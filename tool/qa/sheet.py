import sys, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]; names = sys.argv[3:]
H = int(os.environ.get('H', 1700)); TOP=int(os.environ.get('TOP',0))
tiles=[]
for n in names:
    p=f'{d}/{n}.png'
    if not os.path.exists(p): continue
    im=Image.open(p).convert('RGB'); im=im.crop((0,TOP,min(im.width,600),min(im.height,TOP+H)))
    can=Image.new('RGB',(im.width,H+24),'white'); can.paste(im,(0,24)); ImageDraw.Draw(can).text((4,4),n,fill='red')
    tiles.append(can)
W=sum(t.width for t in tiles)+8*len(tiles); S=Image.new('RGB',(W,H+24),'#888'); x=0
for t in tiles: S.paste(t,(x,0)); x+=t.width+8
S.save(out); print(S.size)
