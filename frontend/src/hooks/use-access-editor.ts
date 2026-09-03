import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';

// Shared data/state/save logic behind every "notifications + access + document
// rights" editor in the app — used by both the employee profile's Notifications
// and Access tabs (employee/[id].tsx) and the staff-login editor
// (settings/person/[id].tsx). Extracted so the two don't drift out of sync the
// way they did once already (the Documents section existed only in one copy
// and silently disappeared from the other during a refactor).
export type ModuleDef = { key: string; label: string; default_roles: string[]; employee_assignable?: boolean };
export type Rights = { edit?: boolean; delete?: boolean };
export type DocRight = { view?: boolean; record?: boolean };
export type Counter = { id: string; name: string };
export type DocCategory = { key: string; label: string };
export type NotifModule = { key: string; label: string; default_roles: string[]; events?: { key: string; label: string; admin_only?: boolean }[] };
export type AccessAccount = {
  id: string; name: string; username?: string; role: string; account_type: 'user' | 'employee';
  designation?: string; status?: string; module_access: string[] | null; resolved_modules: string[];
  module_rights?: Record<string, Rights>; cashbook_counter_ids?: string[];
  notifications_enabled?: boolean; notif_prefs?: Record<string, boolean>;
  doc_category_rights?: Record<string, DocRight>; doc_see_done?: boolean;
};

export function useAccessEditor(accountId: string | undefined) {
  const [acc, setAcc] = useState<AccessAccount | null>(null);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [docCats, setDocCats] = useState<DocCategory[]>([]);
  const [notifModules, setNotifModules] = useState<NotifModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [mods, setMods] = useState<Set<string>>(new Set());
  const [rights, setRights] = useState<Record<string, Rights>>({});
  const [counterSel, setCounterSel] = useState<Set<string>>(new Set());
  const [notifOn, setNotifOn] = useState(true);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [docRights, setDocRights] = useState<Record<string, DocRight>>({});
  const [seeDone, setSeeDone] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoadError(false);
    try {
      const [accts, m, c, dc, nm] = await Promise.all([
        api.get<AccessAccount[]>('/access/accounts'),
        api.get<ModuleDef[]>('/access/modules'),
        api.get<Counter[]>('/cashbook/counters').catch(() => []),
        api.get<DocCategory[]>('/document-categories?all=1').catch(() => []),
        api.get<NotifModule[]>('/access/notification-modules').catch(() => []),
      ]);
      const a = accts.find((x) => x.id === accountId) || null;
      setAcc(a); setModules(m); setCounters(c); setDocCats(dc); setNotifModules(nm);
      if (a) {
        setMods(new Set(a.resolved_modules));
        setRights({ ...(a.module_rights || {}) });
        setCounterSel(new Set(a.cashbook_counter_ids || []));
        setNotifOn(a.notifications_enabled !== false);
        const prefs: Record<string, boolean> = {};
        for (const nmod of nm) {
          prefs[nmod.key] = a.notif_prefs && nmod.key in a.notif_prefs
            ? !!a.notif_prefs[nmod.key]
            : nmod.default_roles.includes(a.role);
        }
        setNotifPrefs(prefs);
        setDocRights({ ...(a.doc_category_rights || {}) });
        setSeeDone(a.doc_see_done !== false);
      }
    } catch {
      // A plain 403 here means "caller isn't owner" — the screens that mount
      // this editor already gate on that before rendering it, so anything
      // that reaches here is a genuine network/server failure worth surfacing
      // rather than silently leaving every toggle at its blank default.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isOwner = acc?.role === 'owner';
  const isEmployee = acc?.account_type === 'employee';
  const availableModules = useMemo(
    () => (isEmployee ? modules.filter((m) => m.employee_assignable) : modules),
    [modules, isEmployee],
  );

  const toggleMod = (k: string) => setMods((p) => {
    const n = new Set(p);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const toggleCounter = (cid: string) => setCounterSel((p) => {
    const n = new Set(p);
    if (n.has(cid)) n.delete(cid); else n.add(cid);
    return n;
  });
  const toggleRight = (k: string, which: 'edit' | 'delete') => setRights((p) => {
    const r = { ...(p[k] || {}) };
    r[which] = !r[which];
    return { ...p, [k]: r };
  });
  const toggleDoc = (k: string, which: 'view' | 'record') => setDocRights((p) => {
    const r = { ...(p[k] || {}) };
    r[which] = !r[which];
    if (which === 'record' && r.record) r.view = true;
    if (which === 'view' && !r.view) r.record = false;
    return { ...p, [k]: r };
  });

  const save = useCallback(async (opts?: { newPassword?: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!acc) return { ok: false, error: 'Nothing loaded yet' };
    setSaving(true);
    try {
      if (opts?.newPassword?.trim() && acc.account_type === 'user') {
        if (opts.newPassword.trim().length < 4) return { ok: false, error: 'Password must be 4+ characters.' };
        await api.put(`/users/${acc.id}`, { name: acc.name, username: acc.username, role: acc.role, password: opts.newPassword.trim() });
      }
      const payload: any = { notifications_enabled: notifOn, notif_prefs: notifPrefs };
      if (!isOwner) {
        const mr: Record<string, Rights> = {};
        if (isEmployee) {
          for (const m of availableModules) {
            if (!mods.has(m.key)) continue;
            const r = rights[m.key];
            if (r) mr[m.key] = { edit: !!r.edit, delete: !!r.delete };
          }
        }
        const docPayload: Record<string, DocRight> = {};
        for (const [k, v] of Object.entries(docRights)) {
          if (v && (v.view || v.record)) docPayload[k] = { view: !!v.view, record: !!v.record };
        }
        payload.module_access = Array.from(mods);
        payload.module_rights = mr;
        payload.cashbook_counter_ids = isEmployee && mods.has('cash_book') ? Array.from(counterSel) : [];
        payload.doc_category_rights = docPayload;
        payload.doc_see_done = seeDone;
      }
      await api.put(`/access/accounts/${acc.id}`, payload);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.detail || 'Please try again' };
    } finally {
      setSaving(false);
    }
  }, [acc, notifOn, notifPrefs, isOwner, isEmployee, availableModules, mods, rights, docRights, counterSel, seeDone]);

  return {
    acc, loading, loadError, saving, isOwner, isEmployee,
    availableModules, notifModules, docCats, counters,
    mods, toggleMod, rights, toggleRight, counterSel, toggleCounter,
    notifOn, setNotifOn, notifPrefs, setNotifPrefs,
    docRights, toggleDoc, seeDone, setSeeDone,
    save, reload: load,
  };
}

export type AccessEditor = ReturnType<typeof useAccessEditor>;
