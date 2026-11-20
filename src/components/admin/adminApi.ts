import { getComplaintsApiUrl } from '../../services/complaintsClient';

export type Role = 'admin' | 'supervisor';
export interface AdminUser { id: string; username: string; displayName: string; role: Role; active?: boolean; lastLoginAt?: number | null }

export interface Note { author: string; authorName: string; noteText: string; isPrivate: boolean; createdAtAST: string }
export interface Complaint {
  ticketCode: string; status: string; category: string; severity?: string;
  vehiclePlate: string; phone: string; customerName?: string; description?: string;
  affectedParts?: string[]; evidence?: { fileName: string; fileType: string; r2Url: string }[];
  notes?: Note[]; assignedTo?: string | null; assignedToName?: string | null;
  resolutionType?: string; resolutionNotes?: string; resolvedBy?: string;
  createdAt: number; createdAtAST: string; washDetails?: Record<string, unknown> | null;
}
export interface Stats {
  total: number; open: number; overdue: number; slaHours: number; resolved: number; rejected: number;
  avgResolutionHours: number | null; unassigned: number;
  byStatus: Record<string, number>; byCategory: Record<string, number>; byResolution: Record<string, number>;
  trend: { date: string; created: number; closed: number }[];
}

const KEY = 'rush_admin_token';
export const getToken = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setToken = (t: string) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ } };

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(getComplaintsApiUrl(`/api/admin${path}`), {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data as T;
}

export const STATUS_AR: Record<string, string> = {
  new: 'جديد', in_review: 'قيد المراجعة', investigating: 'جاري الفحص', resolved: 'تم الحل', rejected: 'مرفوض'
};
export const CATEGORY_AR: Record<string, string> = {
  damage: 'مركبة متضررة', quality: 'جودة الغسيل', billing: 'اشتراك ومبالغ', delay: 'تأخير', staff: 'تعامل موظفين'
};
export const RESOLUTION_AR: Record<string, string> = { rewash: 'غسيل تعويضي', refund: 'استرداد', rejected: 'رفض' };
