#!/usr/bin/env python3
"""Saves the latest U.S. average price of regular gasoline to public/data/gas-price.json.

Source: U.S. Energy Information Administration (public domain), weekly series
EMM_EPMR_PTE_NUS_DPG (U.S. regular gasoline retail price, all formulations,
dollars per gallon), published Mondays. Run weekly by .github/workflows/gas-price.yml.
Needs: pip install xlrd
"""
import json
import sys
import urllib.request

import xlrd

URL = 'https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_NUS_DPGw.xls'
OUT = 'public/data/gas-price.json'


def main() -> int:
    req = urllib.request.Request(URL, headers={'User-Agent': 'RoadTripMadness gas price update (github.com/mbwamkali/RoadTripMadness)'})
    data = urllib.request.urlopen(req, timeout=60).read()
    sheet = xlrd.open_workbook(file_contents=data).sheet_by_name('Data 1')
    for r in range(sheet.nrows - 1, 0, -1):
        date, usd = sheet.cell_value(r, 0), sheet.cell_value(r, 1)
        if isinstance(date, float) and isinstance(usd, float) and usd > 0:
            week = xlrd.xldate_as_datetime(date, 0).date().isoformat()
            break
    else:
        print('No price found', file=sys.stderr)
        return 1
    # Something has gone wrong if the price is silly; keep the old file.
    if not 1.0 <= usd <= 12.0:
        print(f'Price {usd} looks wrong; not saving', file=sys.stderr)
        return 1
    out = {
        'usd': round(usd, 3),
        'week': week,
        'source': 'U.S. Energy Information Administration, weekly U.S. regular gasoline retail price, all formulations (EMM_EPMR_PTE_NUS_DPG)',
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, indent=2)
        f.write('\n')
    print(f'{week}: ${usd:.3f}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
