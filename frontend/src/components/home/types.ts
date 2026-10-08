import type { Notif } from '@/src/components/notifications/NotifRow';

// Shape of GET /home/summary (see backend routers/home.py). A section is null when this
// person has no access to it, and { unavailable: true } when it failed to load this time.
export type Unavailable = { unavailable: true };
export type Maybe<T> = T | Unavailable | null;
export const isOk = <T,>(x: Maybe<T> | undefined): x is T => !!x && !(x as Unavailable).unavailable;

export type RateItem = { key: string; label: string; rate: number; change: number | null };
export type Broadcast = { state: 'sent' | 'not_sent' | 'template_not_approved'; sent_at: string | null; late: boolean; subscribers: number };
export type Rates = { items: RateItem[]; fetched_at?: string; can_open: boolean; broadcast: Broadcast | null };

export type CashLocation = { id: string; name: string; balance: number; share: number; last_entry_at: string | null; closed_today?: boolean };
export type Cash = {
  total: number; received_today: number; paid_today: number; net_today: number;
  locations: CashLocation[]; can_edit: boolean; day_close_available: boolean;
};

export type QuickTile = { key: string; label: string; module: string; add_only?: boolean };
export type QuickActions = { tiles: QuickTile[]; available: QuickTile[]; hidden: string[] };

export type NeedRow = {
  key: string; severity: 'red' | 'amber' | 'gold'; module: string; title: string; detail: string;
  action: string; route: string; can_act: boolean; count?: number;
};

export type StaffStatus = 'present' | 'late' | 'not_in' | 'due' | 'absent' | 'leave';
export type StaffPerson = {
  id: string; name: string; first_name: string; photo: string; role: string; department: string;
  status: StaffStatus; check_in: string | null; late_min: number;
};
export type Staff = { working_day: boolean; due: number; present: number; people: StaffPerson[]; can_see_pay?: boolean };

export type Owed = {
  customers: { total: number; accounts: number } | null;
  loan_interest: { total: number; overdue: number } | null;
  karigars: { fine: number; amount: number } | null;
  top: { id: string; name: string; balance: number; since: string | null; days: number | null }[];
};

export type ComingItem = { date: string; kind: string; module: string; title: string; detail: string; route: string };
export type ComingUp = { items: ComingItem[]; total: number; until: string };

export type HomeSummary = {
  generated_at: string;
  header: Maybe<{ date: string; greeting: string; first_name: string; unread_notifications: number }>;
  rates: Maybe<Rates>;
  cash: Maybe<Cash>;
  quick_actions: Maybe<QuickActions>;
  needs_you: NeedRow[] | Unavailable | null;   // null = hidden in Settings › Home screen
  needs_hidden?: number;   // rows swiped away today
  staff: Maybe<Staff>;
  owed: Maybe<Owed>;
  coming_up: Maybe<ComingUp>;
  notifications?: Maybe<{ unread: number; items: Notif[]; staff?: { on: number; total: number } }>;
  hidden_sections?: string[];
  section_order?: string[];
  cached?: boolean;
};
