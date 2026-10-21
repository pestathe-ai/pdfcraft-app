#!/bin/bash
# uso: sweep.sh OUTDIR  -> 4 processi in parallelo
cd "$(dirname "$0")"
OUT=$1; mkdir -p $OUT; rm -f $OUT/*.json $OUT/part.*
ls ${SITE:-/home/claude/pdfcrafttool/pdfcraft/out}/it/tools | grep -v '\.' | grep -v '^category$' > $OUT/list.txt
split -n r/4 $OUT/list.txt $OUT/part.
for f in $OUT/part.??; do python3 shoot.py $OUT $(cat $f) > $f.log 2>&1 & done
wait
python3 - "$OUT" <<'PY'
import json,glob,sys
r={}
for f in glob.glob(sys.argv[1]+'/report-*.json'): r.update(json.load(open(f)))
json.dump(r,open(sys.argv[1]+'/report.json','w'),indent=1,ensure_ascii=False)
for t,d in sorted(r.items()):
    f=[]
    for ph in ('before','after'):
        x=d.get(ph) or {}
        if x.get('scrollW',390)>392: f.append(f"{ph} HSCROLL {x['scrollW']}")
        if x.get('wideN'): f.append(f"{ph} wide{x['wideN']}: {x['wide'][:2]}")
        if x.get('cjk'): f.append(f"{ph} CJK {x['cjk'][:3]}")
        if x.get('keys'): f.append(f"{ph} KEYS {x['keys'][:3]}")
    if 'error' in d: f.append('ERR '+d['error'][:60])
    if f: print(t,' | '.join(f))
print(len(r),'strumenti')
PY
