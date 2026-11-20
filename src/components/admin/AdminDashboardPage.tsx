import React, { useCallback, useEffect, useState } from 'react';
import {
  api, ApiError, getToken, setToken, AdminUser, Complaint, Stats,
  STATUS_AR, CATEGORY_AR, RESOLUTION_AR
} from './adminApi';

type Tab = 'overview' | 'tickets' | 'team';
const ACTIVE = ['new', 'in_review', 'investigating'];
const BRAND = '#C91E2F';

const statusStyle: Record<string, string> = {
  new: 'bg-red-50 text-red-700 border-red-200',
  in_review: 'bg-amber-50 text-amber-800 border-amber-200',
  investigating: 'bg-blue-50 text-blue-800 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  rejected: 'bg-gray-100 text-gray-700 border-gray-300'
};
const StatusBadge = ({ s }: { s: string }) => (
  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded border ${statusStyle[s] || ''}`}>{STATUS_AR[s] || s}</span>
);
const ago = (ms: number) => {
  const h = (Date.now() - ms) / 3600000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} د` : h < 48 ? `${Math.round(h)} س` : `${Math.round(h / 24)} يوم`;
};

/* ------------------------------ Login ------------------------------ */
function Login({ onLoggedIn }: { onLoggedIn: (u: AdminUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api<{ token: string; user: AdminUser }>('/login', { method: 'POST', body: { username, password } });
      setToken(r.token);
      onLoggedIn(r.user);
    } catch (ex) {
      setErr(ex instanceof ApiError && ex.status === 429 ? 'محاولات كثيرة، حاول لاحقاً' : 'اسم المستخدم أو كلمة المرور غير صحيحة');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB] px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="text-center">
          <div className="text-2xl font-bold">رش واش</div>
          <div className="text-sm text-gray-500 mt-1">لوحة الإدارة والإشراف</div>
        </div>
        <label className="block text-sm font-semibold text-gray-700">
          اسم المستخدم
          <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" dir="ltr" required
            className="mt-1 w-full px-3 py-3 text-base rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C91E2F]" />
        </label>
        <label className="block text-sm font-semibold text-gray-700">
          كلمة المرور
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" dir="ltr" required
            className="mt-1 w-full px-3 py-3 text-base rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C91E2F]" />
        </label>
        {err && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{err}</div>}
        <button disabled={busy} className="w-full py-3 rounded-lg text-white font-bold disabled:opacity-60" style={{ background: BRAND }}>
          {busy ? 'جاري الدخول...' : 'تسجيل الدخول'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------ Overview ------------------------------ */
function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'bad' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-sm text-gray-600">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${tone === 'bad' ? 'text-red-700' : 'text-gray-900'}`}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

function Bars({ data, labels }: { data: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(e => e[1]));
  if (!entries.length) return <div className="text-sm text-gray-500">لا توجد بيانات</div>;
  return (
    <ul className="space-y-2">
      {entries.map(([k, v]) => (
        <li key={k} className="text-sm">
          <div className="flex justify-between mb-1"><span>{labels[k] || k}</span><span className="font-semibold tabular-nums">{v}</span></div>
          <div className="h-2 bg-gray-100 rounded"><div className="h-2 rounded" style={{ width: `${(v / max) * 100}%`, background: BRAND }} /></div>
        </li>
      ))}
    </ul>
  );
}

function TrendChart({ trend }: { trend: Stats['trend'] }) {
  const max = Math.max(1, ...trend.flatMap(t => [t.created, t.closed]));
  const W = 560, H = 160, bw = W / trend.length;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full" role="img" aria-label="البلاغات الجديدة والمغلقة آخر 14 يوماً">
        {trend.map((t, i) => {
          const h1 = (t.created / max) * H, h2 = (t.closed / max) * H;
          return (
            <g key={t.date} transform={`translate(${i * bw},0)`}>
              <title>{`${t.date}: ${t.created} جديد / ${t.closed} مغلق`}</title>
              <rect x={bw * 0.12} y={H - h1} width={bw * 0.34} height={h1} fill={BRAND} rx="2" />
              <rect x={bw * 0.5} y={H - h2} width={bw * 0.34} height={h2} fill="#059669" rx="2" />
              {i % 2 === 0 && <text x={bw / 2} y={H + 15} fontSize="10" textAnchor="middle" fill="#6B7280">{t.date.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 text-xs text-gray-600 mt-1">
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-middle ml-1" style={{ background: BRAND }} />جديد</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-middle ml-1 bg-emerald-600" />مغلق</span>
      </div>
    </div>
  );
}

function Overview({ goTickets }: { goTickets: (f: { overdue?: boolean; assignee?: string }) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ stats: Stats }>('/stats').then(r => setStats(r.stats)).catch(e => setErr(e.message));
  }, []);
  if (err) return <div role="alert" className="text-red-700">{err}</div>;
  if (!stats) return <div className="text-gray-500">جاري التحميل...</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="بلاغات مفتوحة" value={stats.open} hint={`${stats.unassigned} غير مسندة`} />
        <button onClick={() => goTickets({ overdue: true })} className="text-start">
          <Kpi label={`متأخرة (> ${stats.slaHours} ساعة)`} value={stats.overdue} tone={stats.overdue ? 'bad' : undefined} hint="اضغط للعرض" />
        </button>
        <Kpi label="متوسط وقت الحل" value={stats.avgResolutionHours === null ? '—' : `${stats.avgResolutionHours} س`} hint="آخر 90 يوماً" />
        <Kpi label="تم الحل / مرفوض" value={`${stats.resolved} / ${stats.rejected}`} hint={`من ${stats.total} بلاغاً`} />
      </div>
      <div className="grid lg:grid-cols-3 gap-3">
        <section className="bg-white border border-gray-200 rounded-xl p-4 lg:col-span-2">
          <h3 className="font-bold mb-3">البلاغات آخر 14 يوماً</h3>
          <TrendChart trend={stats.trend} />
        </section>
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-bold mb-3">حسب التصنيف</h3>
          <Bars data={stats.byCategory} labels={CATEGORY_AR} />
          <h3 className="font-bold mt-5 mb-3">قرارات الإغلاق</h3>
          <Bars data={stats.byResolution} labels={RESOLUTION_AR} />
        </section>
      </div>
    </div>
  );
}

/* ------------------------------ Tickets ------------------------------ */
interface Staff { id: string; displayName: string; role: string }

function TicketDetail({ code, me, staff, onChanged, onClose }: {
  code: string; me: AdminUser; staff: Staff[]; onChanged: () => void; onClose: () => void;
}) {
  const [c, setC] = useState<Complaint | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [resType, setResType] = useState('rewash');
  const [resNotes, setResNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ complaint: Complaint }>(`/complaints/${code}`).then(r => setC(r.complaint)).catch(e => setErr(e.message));
  }, [code]);
  useEffect(() => { setC(null); setErr(''); load(); }, [load]);

  const act = async (path: string, body: unknown) => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ complaint: Complaint }>(`/complaints/${code}/${path}`, { method: 'POST', body });
      setC(r.complaint); onChanged();
      return true;
    } catch (e) { setErr((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  if (!c) return <div className="p-4 text-gray-500">{err ? <span role="alert" className="text-red-700">{err}</span> : 'جاري التحميل...'}</div>;
  const active = ACTIVE.includes(c.status);
  const btn = 'px-3 py-2 rounded-lg text-sm font-semibold border disabled:opacity-50';

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-lg tabular-nums" dir="ltr">{c.ticketCode}</div>
          <div className="text-xs text-gray-500">{c.createdAtAST}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge s={c.status} />
          <button onClick={onClose} aria-label="إغلاق" className="lg:hidden px-2 py-1 text-gray-600">✕</button>
        </div>
      </div>

      {err && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{err}</div>}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-gray-500">اللوحة</dt><dd className="font-semibold" dir="ltr">{c.vehiclePlate}</dd></div>
        <div><dt className="text-gray-500">الجوال</dt><dd className="font-semibold" dir="ltr"><a href={`tel:${c.phone}`}>{c.phone}</a></dd></div>
        <div><dt className="text-gray-500">التصنيف</dt><dd className="font-semibold">{CATEGORY_AR[c.category] || c.category}</dd></div>
        <div><dt className="text-gray-500">الأجزاء</dt><dd className="font-semibold">{c.affectedParts?.join('، ') || '—'}</dd></div>
      </dl>
      <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap">{c.description}</div>

      {!!c.evidence?.length && (
        <div className="flex flex-wrap gap-2">
          {c.evidence.map((e, i) => (
            <a key={i} href={e.r2Url} target="_blank" rel="noopener noreferrer" className="text-sm underline text-blue-700">
              {e.fileName || `مرفق ${i + 1}`}
            </a>
          ))}
        </div>
      )}

      {active && (
        <section className="space-y-3 border-t pt-4">
          <label className="block text-sm font-semibold">
            المسؤول
            <select value={c.assignedTo || ''} disabled={busy}
              onChange={e => act('assign', { userId: e.target.value || null })}
              className="mt-1 w-full px-3 py-2.5 text-base rounded-lg border border-gray-300 bg-white">
              <option value="">— غير مسند —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.displayName}{s.id === me.id ? ' (أنا)' : ''}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            {c.assignedTo !== me.id && <button disabled={busy} onClick={() => act('assign', { userId: me.id })} className={`${btn} border-gray-300`}>إسناد لي</button>}
            {ACTIVE.filter(s => s !== c.status).map(s => (
              <button key={s} disabled={busy} onClick={() => act('status', { status: s })} className={`${btn} border-gray-300`}>← {STATUS_AR[s]}</button>
            ))}
          </div>

          <div className="border rounded-lg p-3 space-y-2">
            <div className="text-sm font-semibold">قرار الإغلاق</div>
            <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="نوع القرار">
              {Object.entries(RESOLUTION_AR).map(([k, v]) => (
                <button key={k} role="radio" aria-checked={resType === k} onClick={() => setResType(k)}
                  className={`${btn} ${resType === k ? 'text-white border-transparent' : 'border-gray-300'}`}
                  style={resType === k ? { background: BRAND } : undefined}>{v}</button>
              ))}
            </div>
            <textarea value={resNotes} onChange={e => setResNotes(e.target.value)} rows={2} maxLength={2000}
              placeholder="ملاحظات القرار (تظهر للعميل)" className="w-full p-2.5 text-base rounded-lg border border-gray-300" />
            <button disabled={busy} className={`${btn} text-white border-transparent w-full`} style={{ background: BRAND }}
              onClick={async () => {
                if (!window.confirm('تأكيد إغلاق البلاغ؟ سيظهر القرار للعميل.')) return;
                if (await act('resolve', { resolutionType: resType, notes: resNotes })) setResNotes('');
              }}>
              إغلاق البلاغ
            </button>
          </div>
        </section>
      )}

      {!active && (
        <section className="border-t pt-4 text-sm space-y-2">
          <div>القرار: <b>{RESOLUTION_AR[c.resolutionType || ''] || c.resolutionType}</b> — بواسطة {c.resolvedBy}</div>
          {c.resolutionNotes && <div className="text-gray-600">{c.resolutionNotes}</div>}
          {me.role === 'admin' && (
            <button disabled={busy} onClick={() => window.confirm('إعادة فتح البلاغ؟') && act('reopen', {})} className={`${btn} border-gray-300`}>إعادة فتح</button>
          )}
        </section>
      )}

      <section className="border-t pt-4 space-y-2">
        <h4 className="font-bold text-sm">السجل والملاحظات</h4>
        <ul className="space-y-2">
          {[...(c.notes || [])].reverse().map((n, i) => (
            <li key={i} className={`text-sm rounded-lg p-2.5 border ${n.isPrivate ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                <span>{n.authorName}{n.isPrivate ? ' · داخلي' : ''}</span><span>{n.createdAtAST}</span>
              </div>
              {n.noteText}
            </li>
          ))}
        </ul>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000}
          placeholder="أضف ملاحظة داخلية..." className="w-full p-2.5 text-base rounded-lg border border-gray-300" />
        <button disabled={busy || !note.trim()} className={`${btn} border-gray-300`}
          onClick={async () => { if (await act('note', { text: note, isPrivate: true })) setNote(''); }}>إضافة ملاحظة</button>
      </section>
    </div>
  );
}

function Tickets({ me, initial }: { me: AdminUser; initial: { overdue?: boolean; assignee?: string } }) {
  const [status, setStatus] = useState(initial.overdue ? 'active' : 'active');
  const [assignee, setAssignee] = useState(initial.assignee || 'all');
  const [overdue, setOverdue] = useState(!!initial.overdue);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Complaint[]>([]);
  const [sla, setSla] = useState(24);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);

  useEffect(() => { api<{ staff: Staff[] }>('/staff').then(r => setStaff(r.staff)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    const qs = new URLSearchParams({ status, assignee, search });
    if (overdue) qs.set('overdue', '1');
    try {
      const r = await api<{ complaints: Complaint[]; slaHours: number }>(`/complaints?${qs}`);
      setItems(r.complaints); setSla(r.slaHours);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [status, assignee, search, overdue]);

  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  const sel = 'px-3 py-2.5 text-base rounded-lg border border-gray-300 bg-white';
  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-4 items-start">
      <div className={selected ? 'hidden lg:block' : ''}>
        <div className="flex flex-wrap gap-2 mb-3">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث: رقم البلاغ، اللوحة، الجوال" className={`${sel} flex-1 min-w-[200px]`} />
          <select value={status} onChange={e => { setStatus(e.target.value); setOverdue(false); }} className={sel} aria-label="الحالة">
            <option value="active">المفتوحة</option><option value="all">الكل</option>
            {Object.entries(STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={assignee} onChange={e => setAssignee(e.target.value)} className={sel} aria-label="المسؤول">
            <option value="all">كل المسؤولين</option><option value="me">بلاغاتي</option><option value="none">غير مسندة</option>
          </select>
          <label className="flex items-center gap-2 text-sm px-2">
            <input type="checkbox" checked={overdue} onChange={e => setOverdue(e.target.checked)} className="w-4 h-4" />
            متأخرة فقط
          </label>
        </div>
        {err && <div role="alert" className="text-red-700 mb-2">{err}</div>}
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-start">
              <tr>{['البلاغ', 'اللوحة', 'التصنيف', 'الحالة', 'المسؤول', 'العمر'].map(h => <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.map(c => {
                const late = ACTIVE.includes(c.status) && Date.now() - c.createdAt > sla * 3600000;
                return (
                  <tr key={c.ticketCode} onClick={() => setSelected(c.ticketCode)} tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && setSelected(c.ticketCode)}
                    className={`border-t cursor-pointer hover:bg-gray-50 ${selected === c.ticketCode ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-2.5 font-semibold tabular-nums" dir="ltr">{c.ticketCode}</td>
                    <td className="px-3 py-2.5" dir="ltr">{c.vehiclePlate}</td>
                    <td className="px-3 py-2.5">{CATEGORY_AR[c.category] || c.category}</td>
                    <td className="px-3 py-2.5"><StatusBadge s={c.status} /></td>
                    <td className="px-3 py-2.5">{c.assignedToName || <span className="text-gray-400">—</span>}</td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${late ? 'text-red-700 font-bold' : ''}`}>{ago(c.createdAt)}{late ? ' ⚠' : ''}</td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">{loading ? 'جاري التحميل...' : 'لا توجد بلاغات مطابقة'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <aside className={`bg-white border border-gray-200 rounded-xl lg:sticky lg:top-20 ${selected ? '' : 'hidden lg:block'}`}>
        {selected
          ? <TicketDetail key={selected} code={selected} me={me} staff={staff} onChanged={load} onClose={() => setSelected(null)} />
          : <div className="p-8 text-center text-gray-500 text-sm">اختر بلاغاً لعرض التفاصيل</div>}
      </aside>
    </div>
  );
}

/* ------------------------------ Team (admin) ------------------------------ */
function Team({ me }: { me: AdminUser }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', role: 'supervisor', password: '' });
  const load = useCallback(() => { api<{ users: AdminUser[] }>('/users').then(r => setUsers(r.users)).catch(e => setErr(e.message)); }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); load(); } catch (e) { setErr((e as Error).message); } };
  const inp = 'px-3 py-2.5 text-base rounded-lg border border-gray-300';

  return (
    <div className="space-y-4 max-w-3xl">
      {err && <div role="alert" className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 text-sm">{err}</div>}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>{['الاسم', 'المستخدم', 'الدور', 'الحالة', ''].map(h => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2.5 font-semibold">{u.displayName}</td>
                <td className="px-3 py-2.5" dir="ltr">{u.username}</td>
                <td className="px-3 py-2.5">
                  <select value={u.role} disabled={u.id === me.id} aria-label={`دور ${u.displayName}`}
                    onChange={e => run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }))} className="border rounded px-2 py-1">
                    <option value="admin">مدير</option><option value="supervisor">مشرف</option>
                  </select>
                </td>
                <td className="px-3 py-2.5">{u.active ? 'نشط' : 'معطل'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap space-x-2 space-x-reverse">
                  {u.id !== me.id && (
                    <button className="underline" onClick={() => run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }))}>
                      {u.active ? 'تعطيل' : 'تفعيل'}
                    </button>
                  )}
                  <button className="underline" onClick={() => {
                    const pw = window.prompt('كلمة مرور جديدة (10 أحرف على الأقل)');
                    if (pw) run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { password: pw } }));
                  }}>تغيير كلمة المرور</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="bg-white border border-gray-200 rounded-xl p-4 grid sm:grid-cols-2 gap-3"
        onSubmit={e => { e.preventDefault(); run(async () => { await api('/users', { method: 'POST', body: form }); setForm({ username: '', displayName: '', role: 'supervisor', password: '' }); }); }}>
        <h3 className="font-bold sm:col-span-2">إضافة مستخدم</h3>
        <input className={inp} placeholder="اسم المستخدم" dir="ltr" required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
        <input className={inp} placeholder="الاسم المعروض" required value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} />
        <select className={inp} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="supervisor">مشرف</option><option value="admin">مدير</option>
        </select>
        <input className={inp} type="password" placeholder="كلمة المرور (10+ أحرف)" dir="ltr" required minLength={10} autoComplete="new-password"
          value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <button className="sm:col-span-2 py-3 rounded-lg text-white font-bold" style={{ background: BRAND }}>إضافة</button>
      </form>
    </div>
  );
}

/* ------------------------------ Shell ------------------------------ */
export function AdminDashboardPage() {
  const [me, setMe] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(!!getToken());
  const [tab, setTab] = useState<Tab>('tickets');
  const [ticketFilter, setTicketFilter] = useState<{ overdue?: boolean; assignee?: string }>({});
  const [tabKey, setTabKey] = useState(0);

  useEffect(() => {
    document.title = 'رش واش — لوحة الإدارة';
    document.documentElement.lang = 'ar';
    if (!getToken()) return;
    api<{ user: AdminUser }>('/me')
      .then(r => { setMe(r.user); setTab(r.user.role === 'admin' ? 'overview' : 'tickets'); })
      .catch(() => setToken(''))
      .finally(() => setChecking(false));
  }, []);

  const logout = () => { setToken(''); setMe(null); };
  if (checking) return <div className="min-h-screen flex items-center justify-center text-gray-500">جاري التحميل...</div>;
  if (!me) return <Login onLoggedIn={u => { setMe(u); setTab(u.role === 'admin' ? 'overview' : 'tickets'); }} />;

  const tabs: { id: Tab; label: string }[] = [
    ...(me.role === 'admin' ? [{ id: 'overview' as Tab, label: 'نظرة عامة' }] : []),
    { id: 'tickets', label: 'البلاغات' },
    ...(me.role === 'admin' ? [{ id: 'team' as Tab, label: 'الفريق' }] : [])
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-[#F9FAFB] text-[#0F172A] font-sans antialiased">
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
        <div className="max-w-[1280px] mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="font-bold text-lg">رش واش <span className="text-xs px-1.5 py-0.5 rounded bg-[#FDE8EA] text-[#C91E2F]">{me.role === 'admin' ? 'إدارة' : 'إشراف'}</span></div>
            <nav className="flex gap-1" aria-label="الأقسام">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold ${tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{t.label}</button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline text-gray-600">{me.displayName}</span>
            <button onClick={logout} className="px-3 py-2 rounded-lg border border-gray-300 font-semibold">خروج</button>
          </div>
        </div>
      </header>
      <main className="max-w-[1280px] mx-auto px-4 py-4">
        {tab === 'overview' && <Overview goTickets={f => { setTicketFilter(f); setTabKey(k => k + 1); setTab('tickets'); }} />}
        {tab === 'tickets' && <Tickets key={tabKey} me={me} initial={ticketFilter} />}
        {tab === 'team' && me.role === 'admin' && <Team me={me} />}
      </main>
    </div>
  );
}
