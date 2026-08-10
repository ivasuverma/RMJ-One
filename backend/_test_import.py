"""
One-time bulk import: creates the 15 employees from the Ram Murti Jewellers
"Employee Master Information" PDF directly in RMJ One, via the same API the
app itself uses. Run this ON the machine where the backend is running
(so BASE_URL=http://localhost:8000 works), after the backend is up.

Usage:
    python import_employees.py

It will ask for your owner username/password, then create the shift
"11:30 - 19:30" (if it doesn't already exist) and all 15 employees, printing
each employee's login code + default PIN at the end so you can hand them out.

Safe to re-run: employee_code is left blank so the app auto-assigns the next
free code — running this twice will just create 15 duplicate employees, so
only run it once. If you need to undo, delete the duplicates from Team.
"""
import getpass
import json
import urllib.error
import urllib.request

BASE_URL = 'http://127.0.0.1:8123/api'

SHIFT = {'name': '11:30 - 19:30', 'start': '11:30', 'end': '19:30', 'grace_min': 15, 'is_active': True}

# Extracted from emp.pdf. bank_account/IFSC were placeholder "123"/blank in the
# source doc, not real numbers, so they're intentionally left out here — fill
# those in per employee later if you want salary transfer details on file.
EMPLOYEES = [
    dict(name='Amarpal', designation='Kariger', department='Field Ganj', mobile='7652826840',
         joining_date='2026-02-01', salary=18000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Sh. Amika Parsad. DOB: 01-Jan-1989. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Ashu Verma', designation='Accountant', department='Field Ganj', mobile='9888811493',
         joining_date='2026-02-01', salary=22000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Sh. Hori Lal. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Rahul Pasricha', designation='Salesman', department='Field Ganj', mobile='8847431139',
         joining_date='2025-02-01', salary=29000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Sh. Vijay Kumar. DOB: 15-Jul-1986. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Virender Raju Tiwari', designation='Salesman', department='Field Ganj', mobile='6283544211',
         joining_date='2026-02-01', salary=20000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Sh. Kamlapati Tiwari. DOB: 01-Jan-1994. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='SK Abu Taher', designation='Kariger', department='Field Ganj', mobile='9872354081',
         joining_date='2026-02-01', salary=15000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Sh. SK Mojammel Haque. DOB: 05-Jun-1974. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Anshu Kumar', designation='Helper', department='Field Ganj', mobile='8427798640',
         joining_date='2026-02-01', salary=11000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Sh. Raj Kumar. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Rajan Dhanda', designation='Driver', department='Field Ganj', mobile='8968261974',
         joining_date='2026-02-01', salary=18000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Sh. Raj Kumar Dhanda. DOB: 14-Feb-1974. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Manu Verma', designation='Salesgirl', department='Field Ganj', mobile='8847548966',
         joining_date='2026-02-01', salary=18000, bank_name='AU Small Finance Bank',
         notes='Guardian: D/O Sh. Jawahar. DOB: 01-Aug-2004. Gender: Female. Marital status: Married. Religion: Hindu.'),
    dict(name='Sajan Verma', designation='Social Media', department='Field Ganj', mobile='9914615188',
         joining_date='2026-02-01', salary=35000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Sh. Balbir Chand. DOB: 13-Feb-2002. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Gurjinder Singh', designation='Accountant', department='Field Ganj', mobile='7973958229',
         joining_date='2026-02-01', salary=12000, bank_name='AU Small Finance Bank',
         notes='Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Karanbeer Singh', designation='Driver', department='Field Ganj', mobile='9878122639',
         joining_date='2026-02-18', salary=20000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Gurman Singh. DOB: 27-Jun-1999. Gender: Male. Marital status: Unmarried. Religion: Hindu.'),
    dict(name='Ramkishan', designation='Driver', department='Field Ganj', mobile='7814819349',
         joining_date='2026-03-18', salary=20000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Chotte Lal. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Ranveer Singh', designation='Driver', department='Field Ganj', mobile='6280405395',
         joining_date='2026-04-21', salary=18000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Gurdeep Singh. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Sumit Singh', designation='Driver', department='Field Ganj', mobile='7417217477',
         joining_date='2026-06-05', salary=18000, bank_name='AU Small Finance Bank',
         address='Sil Goan, Rudraprayag, Uttarakhand',
         notes='Guardian: S/O Darshan Singh. DOB: 06-Mar-2004. Gender: Male. Marital status: Married. Religion: Hindu.'),
    dict(name='Amit Singh', designation='Accountant', department='Field Ganj', mobile='',
         joining_date='2026-08-07', salary=15000, bank_name='AU Small Finance Bank',
         notes='Guardian: S/O Darshan Singh. Gender: Male. Marital status: Unmarried. Religion: Hindu.'),
]


def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE_URL + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        raise SystemExit(f'{method} {path} failed ({e.code}): {detail}')


def main():
    print('RMJ One — bulk employee import\n')
    username = input('Owner username [owner]: ').strip() or 'owner'
    password = getpass.getpass('Owner password: ')

    login = call('POST', '/auth/login', body={'username': username, 'password': password})
    token = login['access_token']
    print(f"Logged in as {login['user']['name']} ({login['user']['role']})\n")

    shifts = call('GET', '/shifts', token=token)
    if not any(s['name'] == SHIFT['name'] for s in shifts):
        call('POST', '/shifts', token=token, body=SHIFT)
        print(f"Created shift: {SHIFT['name']}")
    else:
        print(f"Shift already exists: {SHIFT['name']}")

    print(f'\nCreating {len(EMPLOYEES)} employees...\n')
    created = []
    for emp in EMPLOYEES:
        payload = {'shift': SHIFT['name'], 'status': 'active', **emp}
        result = call('POST', '/employees', token=token, body=payload)
        created.append(result)
        print(f"  {result['employee_code']}  {result['name']:<22} PIN: {result['default_pin']}")

    print(f'\nDone — {len(created)} employees created.')
    print('Share each person their Employee Code + PIN above so they can log in')
    print('(Employee Login tab on the sign-in screen, not username/password).')


if __name__ == '__main__':
    main()
