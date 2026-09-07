"""Print Master — per-template field visibility, per-field font size (points,
with a template-wide default), field order, and shop-name toggle for every
thermal receipt/challan the app prints (Repairs, Stock In/Out samples, Gold
Loans). Config lives on a single db.settings document ({'id':
'print_templates'}), edited from Settings > Masters > Print Master (owner
only) via routers/print_settings.py.

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
# Groups templates onto their own page in the Print Master UI (Settings >
# Masters > Print Master > module > template) — display order + label here.
MODULE_LABELS = {'repairs': 'Repairs', 'samples': 'Stock In/Out', 'gold_loans': 'Gold Loan'}

PRINT_TEMPLATES = {
    'repair_intake': {
        'label': 'Intake Receipt',
        'module': 'repairs',
        'fields': [
            {'key': 'order_no', 'label': 'Order No'}, {'key': 'customer', 'label': 'Customer'},
            {'key': 'mobile', 'label': 'Mobile'}, {'key': 'received', 'label': 'Received'},
            {'key': 'tag', 'label': 'Tag'}, {'key': 'description', 'label': 'Description'},
            {'key': 'repair_type', 'label': 'Repair Type'}, {'key': 'weight', 'label': 'Weight'},
            {'key': 'pcs', 'label': 'Pcs'}, {'key': 'due_date', 'label': 'Due Date'},
        ],
    },
    'repair_tag': {
        'label': 'Item Tag',
        'module': 'repairs',
        'fields': [
            {'key': 'tag', 'label': 'Tag'}, {'key': 'customer', 'label': 'Customer'},
            {'key': 'item', 'label': 'Item'}, {'key': 'repair_type', 'label': 'Repair Type'},
            {'key': 'weight', 'label': 'Weight'}, {'key': 'pcs', 'label': 'Pcs'},
            {'key': 'due_date', 'label': 'Due Date'},
        ],
    },
    'repair_bill': {
        'label': 'Bill / Quotation',
        'module': 'repairs',
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
        'label': 'Karigar Issue Challan',
        'module': 'repairs',
        'fields': [
            {'key': 'challan_no', 'label': 'Challan No'}, {'key': 'date', 'label': 'Date'},
            {'key': 'karigar', 'label': 'Karigar'}, {'key': 'tag', 'label': 'Tag'},
            {'key': 'item', 'label': 'Item'}, {'key': 'weight_issued', 'label': 'Weight Issued'},
            {'key': 'purity', 'label': 'Purity'}, {'key': 'fine_weight', 'label': 'Fine Weight'},
            {'key': 'issued_by', 'label': 'Issued By'}, {'key': 'note', 'label': 'Note'},
        ],
    },
    'sample_issue': {
        'label': 'Sample Issue Challan',
        'module': 'samples',
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
        'label': 'Loan Voucher',
        'module': 'gold_loans',
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


DEFAULT_FONT_SIZE = 10
MIN_FONT_SIZE, MAX_FONT_SIZE = 7, 20

# A field_order entry starting with this prefix isn't a real registry field —
# it's a blank-line spacer the owner inserted via Print Master's "Add Line"
# button, positioned and removed exactly like a field (same up/down arrows,
# same list) but rendered as empty vertical space with no label or rule.
BLANK_KEY_PREFIX = 'blank_'


def is_blank_key(key: str) -> bool:
    return key.startswith(BLANK_KEY_PREFIX)

# Legacy values from the first cut of this feature (2026-09-07), before sizes
# became numeric — kept only so a config saved that day still loads sanely.
_LEGACY_FONT_SIZE = {'normal': 10, 'large': 13}


def _coerce_size(value, fallback: int) -> int:
    if isinstance(value, str):
        value = _LEGACY_FONT_SIZE.get(value, fallback)
    try:
        return max(MIN_FONT_SIZE, min(MAX_FONT_SIZE, int(value)))
    except (TypeError, ValueError):
        return fallback


def template_config(doc: dict | None, key: str) -> dict:
    """Merge a template's stored config (from the print_templates settings
    doc) with its defaults. Returns {'disabled_fields': set, 'font_size':
    int, 'field_sizes': {field_key: int}, 'field_order': [field_key, ...],
    'title_size': int | None, 'show_shop_name': bool, 'field_dividers':
    bool}. `title_size` is the slip's heading line (e.g. "Loan Against
    Gold") — None means it follows `font_size`. `field_dividers` prints a
    thin rule between every field row instead of just between sections."""
    meta = PRINT_TEMPLATES[key]
    valid_keys = {f['key'] for f in meta['fields']}
    stored = (doc or {}).get('templates', {}).get(key, {})
    font_size = _coerce_size(stored.get('font_size'), DEFAULT_FONT_SIZE)
    field_sizes = {
        k: _coerce_size(v, font_size) for k, v in (stored.get('field_sizes') or {}).items() if k in valid_keys
    }
    field_order = [k for k in (stored.get('field_order') or []) if k in valid_keys or is_blank_key(k)]
    title_size = _coerce_size(stored['title_size'], font_size) if stored.get('title_size') is not None else None
    return {
        'disabled_fields': {k for k in (stored.get('disabled_fields') or []) if k in valid_keys},
        'font_size': font_size,
        'title_size': title_size,
        'field_sizes': field_sizes,
        'field_order': field_order,
        'show_shop_name': stored.get('show_shop_name', meta.get('default_show_shop_name', True)),
        'field_dividers': bool(stored.get('field_dividers', False)),
    }


def filter_lines(lines: list, disabled_fields: set) -> list:
    """Drops (key, label, value) lines whose key is in disabled_fields.
    Plain strings (section headers, dividers, signature lines) always pass
    through untouched — only real fields are toggle-able."""
    if not disabled_fields:
        return lines
    return [item for item in lines if not (isinstance(item, tuple) and item[0] in disabled_fields)]


def reorder_lines(lines: list, field_order: list) -> list:
    """Reorders (key, label, value) lines per field_order. Plain strings
    (section headers like 'Item 2', dividers, the signature line) stay in
    place and act as boundaries — each run of fields between them is
    reordered independently, so a multi-item receipt (e.g. repair_intake)
    gets the same field order applied within every item's block rather than
    one giant reshuffle across the whole receipt. Fields not mentioned in
    field_order keep their original relative order, after the ones that are."""
    if not field_order:
        return lines
    rank = {k: i for i, k in enumerate(field_order)}

    def sort_key(indexed_item):
        i, item = indexed_item
        return (rank.get(item[0], len(field_order)), i)

    out: list = []
    group: list = []

    def flush():
        group.sort(key=sort_key)
        out.extend(item for _, item in group)
        group.clear()

    for i, item in enumerate(lines):
        if isinstance(item, tuple):
            group.append((i, item))
        else:
            flush()
            out.append(item)
    flush()
    return out


def inject_blank_lines(lines: list, field_order: list) -> list:
    """Adds one blank-line marker — (blank_key, '', '') — per blank_* entry
    in field_order, once per structural block (each run of fields between
    the plain-string separators reorder_lines also groups by), so a blank
    line inserted between two fields lands in that same relative spot in
    every item's block on a multi-item receipt (e.g. repair_intake), not
    just the first. Markers are appended at the end of each block here —
    reorder_lines (run right after, via apply_field_config) is what actually
    moves each one to its configured position, using its rank in
    field_order same as any real field."""
    blank_keys = [k for k in field_order if is_blank_key(k)]
    if not blank_keys:
        return lines
    out: list = []
    group: list = []

    def flush():
        out.extend(group)
        for bk in blank_keys:
            out.append((bk, '', ''))
        group.clear()

    for item in lines:
        if isinstance(item, tuple):
            group.append(item)
        else:
            flush()
            out.append(item)
    flush()
    return out


def apply_field_config(lines: list, cfg: dict) -> list:
    """inject_blank_lines + filter_lines + reorder_lines in one call — the
    shape every print endpoint actually wants."""
    lines = inject_blank_lines(lines, cfg['field_order'])
    lines = filter_lines(lines, cfg['disabled_fields'])
    return reorder_lines(lines, cfg['field_order'])


def field_font_size(cfg: dict, field_key: str) -> int:
    """The effective point size for one field: its own override if set,
    otherwise the template's overall font_size."""
    return cfg['field_sizes'].get(field_key, cfg['font_size'])
