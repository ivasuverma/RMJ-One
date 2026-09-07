"""Print Master — per-template field visibility, body text size, and
shop-name toggle for every thermal receipt/challan the app prints (Repairs,
Stock In/Out samples, Gold Loans). Config lives on a single db.settings
document ({'id': 'print_templates'}), edited from Settings > Masters >
Print Master (owner only) via routers/print_settings.py.

Deliberately import-free of server.py: repairs.py, samples.py, and
gold_loans.py each import this at module top, and those modules are
themselves imported by server.py while it's still initializing — pulling
in server.py from here would race that (same hazard noted in
routers/settings.py for the gold_rate import).
"""

# Each print line a template can show is (key, label) — `key` is what gets
# stored in `disabled_fields`; `label` is what the owner sees in the Print
# Master UI and, for most fields, what's printed on the receipt too (the
# printed label can differ, e.g. repair_bill's "extra_charges" prints
# whatever custom note the item has, falling back to this label).
PRINT_TEMPLATES = {
    'repair_intake': {
        'label': 'Repairs — Intake Receipt',
        'fields': [
            {'key': 'order_no', 'label': 'Order No'}, {'key': 'customer', 'label': 'Customer'},
            {'key': 'mobile', 'label': 'Mobile'}, {'key': 'received', 'label': 'Received'},
            {'key': 'tag', 'label': 'Tag'}, {'key': 'description', 'label': 'Description'},
            {'key': 'repair_type', 'label': 'Repair Type'}, {'key': 'weight', 'label': 'Weight'},
            {'key': 'pcs', 'label': 'Pcs'}, {'key': 'due_date', 'label': 'Due Date'},
        ],
    },
    'repair_tag': {
        'label': 'Repairs — Item Tag',
        'fields': [
            {'key': 'tag', 'label': 'Tag'}, {'key': 'customer', 'label': 'Customer'},
            {'key': 'item', 'label': 'Item'}, {'key': 'repair_type', 'label': 'Repair Type'},
            {'key': 'weight', 'label': 'Weight'}, {'key': 'pcs', 'label': 'Pcs'},
            {'key': 'due_date', 'label': 'Due Date'},
        ],
    },
    'repair_bill': {
        'label': 'Repairs — Bill / Quotation',
        # Field toggles + font size apply to the PDF only — the WiFi-printer
        # version renders a bordered table (_escpos_bill_table) with fixed
        # columns, not the label/value lines these toggles filter, so only
        # show_shop_name + font_size (row height) carry over to it.
        'fields': [
            {'key': 'item', 'label': 'Item'}, {'key': 'tag', 'label': 'Tag'},
            {'key': 'repair_type', 'label': 'Repair Type'}, {'key': 'weight', 'label': 'Weight'},
            {'key': 'labour_charge', 'label': 'Labour Charge'},
            {'key': 'material_adjustment', 'label': 'Material Adjustment'},
            {'key': 'extra_charges', 'label': 'Extra Charges'},
            {'key': 'total_billed', 'label': 'Total Billed'}, {'key': 'payment_mode', 'label': 'Payment Mode'},
        ],
    },
    'repair_issue': {
        'label': 'Repairs — Karigar Issue Challan',
        'fields': [
            {'key': 'challan_no', 'label': 'Challan No'}, {'key': 'date', 'label': 'Date'},
            {'key': 'karigar', 'label': 'Karigar'}, {'key': 'tag', 'label': 'Tag'},
            {'key': 'item', 'label': 'Item'}, {'key': 'weight_issued', 'label': 'Weight Issued'},
            {'key': 'purity', 'label': 'Purity'}, {'key': 'fine_weight', 'label': 'Fine Weight'},
            {'key': 'issued_by', 'label': 'Issued By'}, {'key': 'note', 'label': 'Note'},
        ],
    },
    'sample_issue': {
        'label': 'Stock In/Out — Sample Issue Challan',
        'fields': [
            {'key': 'sample_no', 'label': 'Sample No'}, {'key': 'date', 'label': 'Date'},
            {'key': 'karigar', 'label': 'Karigar'}, {'key': 'tag', 'label': 'Tag'},
            {'key': 'item', 'label': 'Item'}, {'key': 'pieces', 'label': 'Pieces'},
            {'key': 'weight_issued', 'label': 'Weight Issued'}, {'key': 'issue_type', 'label': 'Issue Type'},
            {'key': 'due_back', 'label': 'Due Back'}, {'key': 'issued_by', 'label': 'Issued By'},
            {'key': 'note', 'label': 'Note'},
        ],
    },
    'gold_loan_voucher': {
        'label': 'Gold Loan — Voucher',
        # Shop name defaulted off from the start for this one (2026-09-07
        # request) — everything else defaults on.
        'default_show_shop_name': False,
        'fields': [
            {'key': 'loan_no', 'label': 'Loan No'}, {'key': 'date', 'label': 'Date'},
            {'key': 'customer', 'label': 'Customer'}, {'key': 'mobile', 'label': 'Mobile'},
            {'key': 'item', 'label': 'Item'}, {'key': 'weight', 'label': 'Weight'},
            {'key': 'pieces', 'label': 'Pieces'}, {'key': 'principal', 'label': 'Principal'},
            {'key': 'interest_rate', 'label': 'Interest Rate'}, {'key': 'est_return', 'label': 'Est. Return'},
            {'key': 'issued_by', 'label': 'Issued By'}, {'key': 'note', 'label': 'Note'},
        ],
    },
}


def template_config(doc: dict | None, key: str) -> dict:
    """Merge a template's stored config (from the print_templates settings
    doc) with its defaults. Returns {'disabled_fields': set, 'font_size':
    str, 'show_shop_name': bool}."""
    meta = PRINT_TEMPLATES[key]
    stored = (doc or {}).get('templates', {}).get(key, {})
    cfg = {
        'disabled_fields': stored.get('disabled_fields', []),
        'font_size': stored.get('font_size', 'normal'),
        'show_shop_name': stored.get('show_shop_name', meta.get('default_show_shop_name', True)),
    }
    cfg['disabled_fields'] = set(cfg['disabled_fields'])
    return cfg


def filter_lines(lines: list, disabled_fields: set) -> list:
    """Drops (key, label, value) lines whose key is in disabled_fields.
    Plain strings (section headers, dividers, signature lines) always pass
    through untouched — only real fields are toggle-able."""
    if not disabled_fields:
        return lines
    return [item for item in lines if not (isinstance(item, tuple) and item[0] in disabled_fields)]
