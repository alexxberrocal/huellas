"""Genera data/countries.js y data/cities.js a partir de Natural Earth y GeoNames.

Uso (desde la carpeta del proyecto, en PowerShell):
    python tools/build-data.py <carpeta con ne_50m_admin_0_countries.geojson y cities5000.txt>
"""
import json
import os
import sys

src = sys.argv[1] if len(sys.argv) > 1 else '.'
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

CONTINENTS = {
    'Africa': 'África', 'Asia': 'Asia', 'Europe': 'Europa', 'North America': 'América del Norte',
    'South America': 'América del Sur', 'Oceania': 'Oceanía', 'Antarctica': 'Antártida',
    'Seven seas (open ocean)': 'Océanos',
}


def enc_ring(ring):
    # Anillo como enteros (grados * 1000) codificados en delta para que pese poco.
    vals, plon, plat = [], 0, 0
    pts = [(round(x * 1000), round(y * 1000)) for x, y in ring]
    dedup = []
    for p in pts:
        if not dedup or dedup[-1] != p:
            dedup.append(p)
    if len(dedup) < 4:
        return None
    for lon, lat in dedup:
        vals.append(lon - plon)
        vals.append(lat - plat)
        plon, plat = lon, lat
    return ','.join(str(v) for v in vals)


ne = json.load(open(os.path.join(src, 'ne50.geojson'), encoding='utf-8'))
countries = []
for f in ne['features']:
    p = f['properties']
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    enc = []
    for poly in polys:
        rings = [r for r in (enc_ring(r) for r in poly) if r]
        if rings:
            enc.append(rings)
    iso = p['ISO_A2_EH'] if p['ISO_A2_EH'] not in ('-99', None) else ''
    countries.append({
        'iso': iso,
        'a3': p['ADM0_A3'],
        'name': p['NAME_ES'] or p['NAME'],
        'cont': CONTINENTS.get(p['CONTINENT'], p['CONTINENT']),
        'p': enc,
    })
countries.sort(key=lambda c: c['name'])
with open(os.path.join(out, 'countries.js'), 'w', encoding='utf-8') as fh:
    fh.write('/* Fronteras: Natural Earth 1:50m (dominio público). Generado por tools/build-data.py */\n')
    fh.write('window.HUELLAS_COUNTRIES=')
    json.dump(countries, fh, ensure_ascii=False, separators=(',', ':'))
    fh.write(';\n')

# Ciudades (GeoNames, CC-BY 4.0): solo núcleos de población, sin barrios ni lugares abandonados.
SKIP = {'PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH', 'PPLR'}
rows, tzs, tzi = [], [], {}
for line in open(os.path.join(src, 'cities5000.txt'), encoding='utf-8'):
    c = line.rstrip('\n').split('\t')
    if len(c) < 18 or c[6] != 'P' or c[7] in SKIP:
        continue
    tz = c[17]
    if tz not in tzi:
        tzi[tz] = len(tzs)
        tzs.append(tz)
    name = c[1].replace('|', ' ').replace(';', ' ')
    rows.append('%s|%s|%d|%d|%d|%d' % (name, c[8], round(float(c[4]) * 1000), round(float(c[5]) * 1000),
                                       int(c[14] or 0), tzi[tz]))
with open(os.path.join(out, 'cities.js'), 'w', encoding='utf-8') as fh:
    fh.write('/* Ciudades: GeoNames cities5000 (CC-BY 4.0, geonames.org). Generado por tools/build-data.py */\n')
    fh.write('window.HUELLAS_CITIES={tz:')
    json.dump(tzs, fh, separators=(',', ':'))
    fh.write(',rows:')
    json.dump(';'.join(rows), fh, ensure_ascii=False)
    fh.write('};\n')
print('países', len(countries), 'ciudades', len(rows), 'zonas horarias', len(tzs))
