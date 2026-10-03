"""Cash Ledger (khata): people, cash you gave / got in any currency, balances
per currency, settle up - and it never touches the Cash Book or Home."""
import os

import requests

API = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') + '/api'


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _shop_cash(h):
    """What the Cash Book counters and Home say about cash, to compare before/after."""
    counters = requests.get(f"{API}/cashbook/counters", headers=h, timeout=30).json()
    home = requests.get(f"{API}/home/summary?fresh=true", headers=h, timeout=60).json()
    return counters, home.get('cash')


def test_cash_ledger_flow_and_isolation():
    h = _login('owner', 'Owner@123')
    before = _shop_cash(h)
    name = f'Khata test {os.urandom(3).hex()}'
    a = requests.post(f"{API}/khata", headers=h, json={'name': name, 'phone': '9800000000'}, timeout=30).json()
    aid = a['id']
    try:
        assert a['currency'] == 'INR'
        assert requests.post(f"{API}/khata", headers=h, json={'name': name.upper()}, timeout=30).status_code == 400
        for d, amt, cur in (('gave', 5000, 'INR'), ('got', 2000, 'INR'), ('gave', 500, 'INR'), ('gave', 100, 'USD'), ('got', 30, 'usd')):
            r = requests.post(f"{API}/khata/{aid}/entries", headers=h,
                              json={'direction': d, 'amount': amt, 'currency': cur, 'date': '2026-09-20'}, timeout=30)
            assert r.status_code == 200, r.text
        assert requests.post(f"{API}/khata/{aid}/entries", headers=h, json={'direction': 'gave', 'amount': 1, 'currency': 'RUPEES'}, timeout=30).status_code == 400
        acc = requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()
        # each currency keeps its own balance - never converted
        assert acc['account']['balances'] == {'INR': 3500, 'USD': 70}
        assert acc['account']['currency'] == 'USD'          # next entry starts in the one used last
        newest = acc['entries'][0]
        assert newest['currency'] == 'USD' and newest['balance_after'] == 70
        row = next(x for x in requests.get(f"{API}/khata", headers=h, timeout=30).json()['accounts'] if x['id'] == aid)
        assert row['balances'] == {'INR': 3500, 'USD': 70}
        # can't remove with money pending; settle brings every currency to zero
        assert requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30).status_code == 400
        s = requests.post(f"{API}/khata/{aid}/settle", headers=h, timeout=30).json()
        assert sorted((e['currency'], e['direction'], e['amount']) for e in s['entries']) == [('INR', 'got', 3500), ('USD', 'got', 70)]
        assert requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account']['balances'] == {}
        # the store manager doesn't get the owner's khata unless given it
        assert requests.get(f"{API}/khata", headers=_login('admin', 'Admin@123'), timeout=30).status_code == 403
        # no effect on any other module: the Cash Book and Home's cash are exactly as before
        assert _shop_cash(h) == before
    finally:
        for e in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{e['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)


def test_cash_ledger_groups_and_statement():
    """A group keeps its own entries and total; the person's balance includes it.
    The statement is a PDF (and pages for the app's preview) for a date range."""
    h = _login('owner', 'Owner@123')
    a = requests.post(f"{API}/khata", headers=h, json={'name': f'Khata group {os.urandom(3).hex()}'}, timeout=30).json()
    aid = a['id']
    try:
        g = requests.post(f"{API}/khata/{aid}/groups", headers=h, json={'name': 'Trip'}, timeout=30).json()
        assert requests.post(f"{API}/khata/{aid}/groups", headers=h, json={'name': 'trip'}, timeout=30).status_code == 400
        for d, amt, gid, date in (('gave', 1000, None, '2026-09-01'), ('gave', 500, g['id'], '2026-09-02'),
                                  ('got', 200, g['id'], '2026-09-10'), ('gave', 300, None, '2026-09-11')):
            r = requests.post(f"{API}/khata/{aid}/entries", headers=h, timeout=30,
                              json={'direction': d, 'amount': amt, 'date': date, 'group_id': gid, 'remark': 'r'})
            assert r.status_code == 200, r.text
        assert requests.post(f"{API}/khata/{aid}/entries", headers=h, json={'direction': 'gave', 'amount': 1, 'group_id': 'nope'}, timeout=30).status_code == 400
        acc = requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()
        assert acc['account']['balances'] == {'INR': 1600}
        assert acc['account']['general_balances'] == {'INR': 1300}
        assert acc['account']['groups'][0]['balances'] == {'INR': 300} and acc['account']['groups'][0]['entries'] == 2
        # each part's running balance is its own
        trip = [e for e in acc['entries'] if e['group_id'] == g['id']]
        assert [e['balance_after'] for e in trip] == [300, 500]
        assert requests.delete(f"{API}/khata/{aid}/groups/{g['id']}", headers=h, timeout=30).status_code == 400
        r = requests.get(f"{API}/khata/{aid}/statement?from=2026-09-02&to=2026-09-30", headers=h, timeout=60)
        assert r.status_code == 200 and r.content[:4] == b'%PDF'
        assert requests.get(f"{API}/khata/{aid}/statement?group={g['id']}", headers=h, timeout=60).content[:4] == b'%PDF'
        assert requests.get(f"{API}/khata/{aid}/statement?from=2026-10-01&to=2026-09-01", headers=h, timeout=30).status_code == 400
        # settling the group clears only the group
        requests.post(f"{API}/khata/{aid}/settle?group={g['id']}", headers=h, timeout=30)
        acc = requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account']
        assert acc['groups'][0]['balances'] == {} and acc['balances'] == {'INR': 1300}
    finally:
        for e in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{e['id']}", headers=h, timeout=30)
        for grp in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account'].get('groups', []):
            requests.delete(f"{API}/khata/{aid}/groups/{grp['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)


def test_cash_ledger_gold_and_silver_in_grams():
    """Gold (XAU) and silver (XAG) are kept in grams to 3 decimals, apart from money, and print in the statement."""
    h = _login('owner', 'Owner@123')
    a = requests.post(f"{API}/khata", headers=h, json={'name': f'Khata metal {os.urandom(3).hex()}'}, timeout=30).json()
    aid = a['id']
    try:
        for d, amt, cur in (('gave', 10.5, 'XAU'), ('got', 2.125, 'XAU'), ('gave', 500, 'XAG'), ('gave', 1000, 'INR')):
            r = requests.post(f"{API}/khata/{aid}/entries", headers=h, json={'direction': d, 'amount': amt, 'currency': cur}, timeout=30)
            assert r.status_code == 200, r.text
        acc = requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account']
        assert acc['balances'] == {'XAU': 8.375, 'XAG': 500, 'INR': 1000}
        r = requests.get(f"{API}/khata/{aid}/statement", headers=h, timeout=60)
        assert r.status_code == 200 and r.content[:4] == b'%PDF'
    finally:
        for e in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{e['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)


def test_cash_ledger_convert_currency():
    """Converting moves a balance into another currency at the given rate, as a linked pair of entries."""
    h = _login('owner', 'Owner@123')
    a = requests.post(f"{API}/khata", headers=h, json={'name': f'Khata convert {os.urandom(3).hex()}'}, timeout=30).json()
    aid = a['id']
    try:
        requests.post(f"{API}/khata/{aid}/entries", headers=h, json={'direction': 'gave', 'amount': 200, 'currency': 'USD'}, timeout=30)
        conv = lambda **k: requests.post(f"{API}/khata/{aid}/convert", headers=h, json=k, timeout=30)  # noqa: E731
        assert conv(from_currency='USD', to_currency='INR', amount=300, rate=83).status_code == 400      # more than the balance
        assert conv(from_currency='USD', to_currency='USD', amount=10, rate=1).status_code == 400
        r = conv(from_currency='USD', to_currency='INR', amount=200, rate=83.25)
        assert r.status_code == 200 and r.json()['to_amount'] == 16650
        # the other way round, as rupee rates are quoted: 1 CAD = 62.5 INR -> 1,250 INR is 20 CAD
        requests.post(f"{API}/khata/{aid}/entries", headers=h, json={'direction': 'gave', 'amount': 1250, 'currency': 'INR'}, timeout=30)
        r2 = conv(from_currency='INR', to_currency='CAD', amount=1250, rate=62.5, rate_per_to=True)
        assert r2.status_code == 200 and r2.json()['to_amount'] == 20
        acc = requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()
        assert acc['account']['balances'] == {'INR': 16650, 'CAD': 20}
        leg = next(e for e in acc['entries'] if e.get('conversion_id') and e['currency'] == 'USD')
        assert requests.put(f"{API}/khata/{aid}/entries/{leg['id']}", headers=h, json={'direction': 'got', 'amount': 1}, timeout=30).status_code == 400
        requests.delete(f"{API}/khata/{aid}/entries/{leg['id']}", headers=h, timeout=30)     # undoes both sides
        assert requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account']['balances'] == {'USD': 200, 'CAD': 20}
    finally:
        for e in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{e['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)


SPLITWISE_CSV = """Note: does not include group expenses

Date,Description,Category,Cost,Currency,Test Owner,Friend Xyz

2025-10-24,AU,General,220.70,AUD,-220.70,220.70
2025-10-25,Self,General,940000.00,INR,940000.00,-940000.00
2026-02-18,Owner paid Friend,Payment,5000.00,INR,5000.00,-5000.00
2026-04-21,Friend paid Owner,Payment,500000.00,INR,-500000.00,500000.00

2026-10-03,Total balance, , ,AUD,-220.70,220.70
2026-10-03,Total balance, , ,INR,445000.00,-445000.00
"""


def test_cash_ledger_splitwise_import_and_dashboard():
    """A Splitwise friend export imports as gave/got from 'me', matches its Total balance lines, and re-importing adds nothing."""
    h = _login('owner', 'Owner@123')
    name = f'Friend Xyz {os.urandom(3).hex()}'
    p = requests.post(f"{API}/khata-import/splitwise/preview", headers=h, json={'csv': SPLITWISE_CSV, 'me': 'Test Owner'}, timeout=30).json()
    assert p['lines'] == 4 and p['people'] == ['Test Owner', 'Friend Xyz']
    assert p['balances'] == {'AUD': -220.7, 'INR': 445000} and p['matches_file'] is True
    assert requests.post(f"{API}/khata-import/splitwise/preview", headers=h, json={'csv': 'name,amount\nhello,12\n'}, timeout=30).status_code == 400
    r = requests.post(f"{API}/khata-import/splitwise", headers=h, json={'csv': SPLITWISE_CSV, 'me': 'Test Owner', 'new_name': name}, timeout=30).json()
    aid = r['account_id']
    try:
        assert r['added'] == 4 and r['balances'] == {'AUD': -220.7, 'INR': 445000}
        again = requests.post(f"{API}/khata-import/splitwise", headers=h, json={'csv': SPLITWISE_CSV, 'me': 'Test Owner', 'account_id': aid}, timeout=30).json()
        assert again['added'] == 0 and again['skipped'] == 4
        d = requests.get(f"{API}/khata-dashboard", headers=h, timeout=30).json()
        assert d['people'] >= 1 and 'INR' in d['totals'] and isinstance(d['recent'], list)
    finally:
        for e in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{e['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)


def test_cash_ledger_split_bill():
    """A shared bill: equal = half goes into the balance, custom = the share given, full = all of it; the bill is kept."""
    h = _login('owner', 'Owner@123')
    a = requests.post(f"{API}/khata", headers=h, json={'name': f'Khata split {os.urandom(3).hex()}'}, timeout=30).json()
    aid = a['id']
    try:
        post = lambda **k: requests.post(f"{API}/khata/{aid}/entries", headers=h, json=k, timeout=30)  # noqa: E731
        e = post(direction='gave', amount=2000, note='Food', split={'mode': 'equal', 'total': 2000}).json()
        assert e['amount'] == 1000 and e['split'] == {'mode': 'equal', 'total': 2000}
        assert post(direction='got', amount=300, split={'mode': 'custom', 'total': 900}).json()['amount'] == 300
        assert post(direction='got', amount=1000, split={'mode': 'custom', 'total': 900}).status_code == 400
        assert post(direction='gave', amount=1, split={'mode': 'full', 'total': 500}).json()['amount'] == 500
        assert requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account']['balances'] == {'INR': 1200}
    finally:
        for x in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{x['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)


def test_cash_ledger_only_for_people_given_it():
    """Nobody but the owner gets the Cash Ledger unless the owner gives it to them - not admin, not accountant -
    on every route (list, person, statement, dashboard, rates, import, adding)."""
    owner = _login('owner', 'Owner@123')
    aid = requests.post(f"{API}/khata", headers=owner, json={'name': f'Khata access {os.urandom(3).hex()}'}, timeout=30).json()['id']
    try:
        gets = ['/khata', '/khata-dashboard', '/khata-metal-rates', f'/khata/{aid}', f'/khata/{aid}/statement?format=info']
        for u, p in (('admin', 'Admin@123'), ('accountant', 'Accountant@123')):
            h = _login(u, p)
            assert [requests.get(f"{API}{g}", headers=h, timeout=30).status_code for g in gets] == [403] * len(gets), u
            assert requests.post(f"{API}/khata/{aid}/entries", headers=h, json={'direction': 'gave', 'amount': 1}, timeout=30).status_code == 403
            assert requests.post(f"{API}/khata", headers=h, json={'name': 'x'}, timeout=30).status_code == 403
        mods = requests.get(f"{API}/access/modules", headers=owner, timeout=30).json()
        cl = next(m for m in mods if m['key'] == 'cash_ledger')
        assert cl['default_roles'] == ['owner'] and cl.get('employee_assignable') is True   # the owner can give it to anyone
    finally:
        requests.delete(f"{API}/khata/{aid}", headers=owner, timeout=30)


def test_cash_ledger_convert_whole_balance_across_groups():
    """all_parts converts the person's whole balance in a currency - general and every group, each in its own group -
    at one rate, and deleting one side undoes all of it."""
    h = _login('owner', 'Owner@123')
    aid = requests.post(f"{API}/khata", headers=h, json={'name': f'Khata convert all {os.urandom(3).hex()}'}, timeout=30).json()['id']
    try:
        g1 = requests.post(f"{API}/khata/{aid}/groups", headers=h, json={'name': 'A'}, timeout=30).json()['id']
        g2 = requests.post(f"{API}/khata/{aid}/groups", headers=h, json={'name': 'B'}, timeout=30).json()['id']
        post = lambda **k: requests.post(f"{API}/khata/{aid}/entries", headers=h, json=k, timeout=30)  # noqa: E731
        post(direction='gave', amount=1250, currency='INR')
        post(direction='gave', amount=6250, currency='INR', group_id=g1)
        post(direction='got', amount=625, currency='INR', group_id=g2)
        r = requests.post(f"{API}/khata/{aid}/convert", headers=h, timeout=30,
                          json={'from_currency': 'INR', 'to_currency': 'CAD', 'amount': 6875, 'rate': 62.5, 'rate_per_to': True, 'all_parts': True}).json()
        assert r['parts'] == 3 and r['to_amount'] == 110
        acc = requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()
        a = acc['account']
        assert a['balances'] == {'CAD': 110} and a['general_balances'] == {'CAD': 20}
        assert {g['name']: g['balances'] for g in a['groups']} == {'A': {'CAD': 100}, 'B': {'CAD': -10}}
        leg = next(e for e in acc['entries'] if e.get('conversion_id'))
        requests.delete(f"{API}/khata/{aid}/entries/{leg['id']}", headers=h, timeout=30)
        assert requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account']['balances'] == {'INR': 6875}
    finally:
        for e in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json().get('entries', []):
            requests.delete(f"{API}/khata/{aid}/entries/{e['id']}", headers=h, timeout=30)
        for g in requests.get(f"{API}/khata/{aid}", headers=h, timeout=30).json()['account'].get('groups', []):
            requests.delete(f"{API}/khata/{aid}/groups/{g['id']}", headers=h, timeout=30)
        requests.delete(f"{API}/khata/{aid}", headers=h, timeout=30)
