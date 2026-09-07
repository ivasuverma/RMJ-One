import { Ionicons } from '@expo/vector-icons';

// Shared types/constants for the Print Master screens (index, [module],
// [module]/[template]) — not a route itself (expo-router ignores files
// prefixed with `_`). Mirrors backend/print_templates.py's registry.
export type Field = { key: string; label: string };
export type TemplateCfg = {
  label: string; module: string; module_label: string; fields: Field[];
  disabled_fields: string[]; font_size: number; field_sizes: Record<string, number>;
  field_order: string[]; show_shop_name: boolean;
};
export type Templates = Record<string, TemplateCfg>;

type IoniconName = keyof typeof Ionicons.glyphMap;

export const MODULE_ORDER: { key: string; label: string }[] = [
  { key: 'repairs', label: 'Repairs' },
  { key: 'samples', label: 'Stock In/Out' },
  { key: 'gold_loans', label: 'Gold Loan' },
];

export const MODULE_ICONS: Record<string, IoniconName> = {
  repairs: 'construct-outline',
  samples: 'swap-horizontal-outline',
  gold_loans: 'diamond-outline',
};

export const MIN_FONT_SIZE = 7;
export const MAX_FONT_SIZE = 20;

// Placeholder values for the live preview only — never sent to the backend.
export const SAMPLE_VALUES: Record<string, string> = {
  order_no: 'RO-1042', customer: 'Ramesh Kumar', mobile: '98765 43210', received: '07/09/2026',
  tag: 'RT-2201', description: '22K Ring — sizing', repair_type: 'Sizing', weight: '5.320g',
  pcs: '1', due_date: '10/09/2026', item: '22K Gold Chain', pieces: '2', issue_type: 'Quoting',
  due_back: '10/09/2026', issued_by: 'Suresh', note: 'Handle with care', challan_no: 'CH-118',
  date: '07/09/2026', karigar: 'Amarpal', weight_issued: '10.000g', purity: '91.6%',
  fine_weight: '9.160g', labour_charge: 'Rs.500', material_adjustment: 'Rs.120',
  extra_charges: 'Rs.50', total_billed: 'Rs.2,450', payment_mode: 'Cash', sample_no: 'SMP-77',
  loan_no: 'GL-045', principal: 'Rs.50,000', interest_rate: '2.50% / month', est_return: '10/10/2026',
};

// Static preview headings — mirror what each print endpoint actually sends
// as its `heading` argument (see repairs.py/samples.py/gold_loans.py).
export const PREVIEW_HEADINGS: Record<string, string> = {
  repair_intake: 'Repair Intake — RO-1042',
  repair_tag: 'Item Tag — RT-2201',
  repair_bill: 'Repair Bill — RT-2201',
  repair_issue: 'Karigar Issue Challan',
  sample_issue: 'Sample Issue Challan',
  gold_loan_voucher: 'Loan Against Gold',
};

export function clampSize(n: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)));
}

export function summarize(t: TemplateCfg): string {
  const parts: string[] = [];
  parts.push(t.disabled_fields.length > 0 ? `${t.disabled_fields.length} field(s) hidden` : 'All fields shown');
  parts.push(`${t.font_size}pt`);
  if (!t.show_shop_name) parts.push('shop name hidden');
  if (t.field_order.length > 0) parts.push('reordered');
  return parts.join(' · ');
}
