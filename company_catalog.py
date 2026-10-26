"""Deterministic local company lookup; no network or model fallback."""
import hashlib
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from functools import lru_cache

DEFAULT_PATH = Path(__file__).resolve().parent / 'data/company_catalog.json'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def normalize(name):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', name)).casefold()

@lru_cache(maxsize=4)
def load_index(path, stamp):
    data = json.loads(Path(path).read_text())
    index = {}
    for company in data['companies']:
        for name in [company['name'], *company['aliases']]:
            index.setdefault(normalize(name), []).append(company)
    return data, index

def classify(name, path=DEFAULT_PATH):
    unknown = {'companyNature': '无法判断', 'companyCategories': [], 'companyMatch': 'unmatched'}
    if not isinstance(name, str) or not name.strip() or not path.exists():
        return unknown
    data, index = load_index(str(path), path.stat().st_mtime_ns)
    matches = index.get(normalize(name), [])
    # A full name takes precedence over another company's alias.
    exact = [c for c in matches if normalize(c['name']) == normalize(name)]
    matches = exact or matches
    if len(matches) != 1:
        return {**unknown, 'companyMatch': 'ambiguous' if matches else 'unmatched'}
    company = matches[0]
    return {'companyNature': '、'.join(company['categories']),
            'companyCategories': company['categories'], 'companyMatch': 'exact' if exact else 'explicit_alias',
            'companyMatchedName': company['name'], 'companyCatalogVersion': data['version']}

def enrich(record):
    # Ignore caller-supplied classification; only the local catalog is authoritative.
    result = {k: v for k, v in record.items() if k not in {
        'companyNature', 'companyCategories', 'companyMatch', 'companyMatchedName', 'companyCatalogVersion'}}
    result.update(classify(record.get('company')))
    return result

def import_docx(source, output=DEFAULT_PATH):
    source = Path(source)
    with zipfile.ZipFile(source) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    tables = root.findall('w:body/w:tbl', NS)
    if len(tables) != 4:
        raise ValueError('预期四张分类表，文档结构已变化，需检查后再导入')
    labels = ['小巨人拟推荐（第八批）', '专精特新中小企业（上海2026第一批）',
              '软件和信息技术服务业百强（上海2025公示名单）', '互联网综合实力50强前10名（上海2025）']
    companies = {}
    counts = []
    for number, (table, label) in enumerate(zip(tables, labels)):
        count = 0
        for row in table.findall('w:tr', NS)[1:]:
            cells = [''.join(c.itertext()).strip() for c in row.findall('w:tc', NS)]
            pairs = [(cells[i], cells[i+1], '') for i in (0, 2) if i+1 < len(cells)] if number == 1 else [(cells[0], cells[1], cells[2] if number == 3 and len(cells)>2 else '')] if len(cells)>1 else []
            for seq, name, brands in pairs:
                if not seq.isdigit() or not name:
                    continue
                aliases = [v.strip() for v in re.split('[、，,]', brands) if v.strip()]
                # Only strip explicitly appended brand notes after a complete legal name.
                match = re.fullmatch(r'(.+(?:有限公司|股份公司))（([^（）]+)）', name)
                if match:
                    name = match[1]
                    aliases.extend(v.strip() for v in re.split('[、，,]', match[2]) if v.strip())
                key = normalize(name)
                item = companies.setdefault(key, {'name': name, 'aliases': [], 'categories': []})
                item['aliases'] = sorted(set(item['aliases'] + aliases))
                if label not in item['categories']:
                    item['categories'].append(label)
                count += 1
        counts.append(count)
    if counts != [527, 1904, 100, 10]:
        raise ValueError(f'名单行数不符：{counts}')
    data = {'version': hashlib.sha256(source.read_bytes()).hexdigest()[:16],
            'source': source.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'classificationPolicy': '仅按用户名单分类；未命中或别名歧义为无法判断；不推断所有制、不继承集团标签、不调用模型',
            'counts': dict(zip(labels, counts)), 'companies': list(companies.values())}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    return {'rows': sum(counts), 'companies': len(companies), 'counts': data['counts']}

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('docx')
    args = parser.parse_args()
    print(json.dumps(import_docx(args.docx), ensure_ascii=False))
