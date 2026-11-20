import React, { useState, useEffect } from 'react';
import { getComplaintsApiUrl } from '../../services/complaintsClient';
import { 
  Car, 
  CheckCircle2, 
  Clock, 
  MessageSquare, 
  AlertCircle, 
  ChevronLeft, 
  Send, 
  Camera, 
  FileText,
  MapPin,
  RefreshCw 
} from 'lucide-react';

interface NoteItem {
  author: string;
  authorName: string;
  noteText: string;
  createdAtAST: string;
}

interface EvidenceItem {
  fileKey: string;
  fileName: string;
  fileType: string;
  r2Url: string;
}

interface ComplaintData {
  ticketCode: string;
  status: string;
  statusAr: string;
  category: string;
  vehiclePlate: string;
  phoneMasked: string;
  branch: string;
  bay: string;
  affectedParts?: string[];
  description: string;
  evidence: EvidenceItem[];
  resolutionType?: string;
  resolutionNotes?: string;
  notes: NoteItem[];
  createdAtAST: string;
  createdAtASTArabic: string;
}

export function ComplaintTrackerPage({ ticketCode: propTicketCode }: { ticketCode?: string }) {
  const [ticketCode, setTicketCode] = useState(propTicketCode || '');
  const [complaint, setComplaint] = useState<ComplaintData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Appending note state
  const [newNote, setNewNote] = useState('');
  const [isAppending, setIsAppending] = useState(false);

  useEffect(() => {
    document.title = 'رش واش — متابعة البلاغ';
    document.documentElement.lang = 'ar';
  }, []);

  useEffect(() => {
    // If ticketCode not passed via prop, extract from URL: /complaint/C-2026-XXXX
    let code = ticketCode;
    if (!code && typeof window !== 'undefined') {
      const match = window.location.pathname.match(/\/complaint\/([A-Za-z0-9-_]+)/);
      if (match) code = match[1];
    }

    if (code) {
      setTicketCode(code);
      fetchTicket(code);
    } else {
      setIsLoading(false);
      setError('يرجى إدخال رقم البلاغ للمتابعة');
    }
  }, []);

  const fetchTicket = async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(getComplaintsApiUrl(`/api/complaints/${encodeURIComponent(code)}`));
      const data = await res.json();
      if (data.success && data.complaint) {
        setComplaint(data.complaint);
      } else {
        setError(data.error || 'لم يتم العثور على البلاغ المطلوب');
      }
    } catch (err: any) {
      setError('تعذر الاتصال بالخادم، يرجى المحاولة لاحقاً');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppendNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || !ticketCode) return;

    setIsAppending(true);
    try {
      const res = await fetch(getComplaintsApiUrl(`/api/complaints/${encodeURIComponent(ticketCode)}/append`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteText: newNote.trim(), author: 'customer' })
      });
      const data = await res.json();
      if (data.success) {
        setNewNote('');
        fetchTicket(ticketCode);
      }
    } catch (err) {
      console.warn('Append note error:', err);
    } finally {
      setIsAppending(false);
    }
  };

  // Status Stepper
  const statusSteps = [
    { key: 'new', label: 'تم الاستلام', desc: 'تم توثيق البلاغ وتعيينه' },
    { key: 'in_review', label: 'قيد المراجعة', desc: 'مشرف الفرع يراجع الحالة' },
    { key: 'investigating', label: 'فحص الكاميرات', desc: 'تفريغ تسجيلات كاميرات النفق' },
    { key: 'resolved', label: 'تم الحل والتعويض', desc: 'إصدار غسيل مجاني أو تعويض' }
  ];

  const getStepStatus = (stepKey: string) => {
    if (!complaint) return 'upcoming';
    const order = ['new', 'in_review', 'investigating', 'resolved'];
    const currentIdx = order.indexOf(complaint.status);
    const stepIdx = order.indexOf(stepKey);

    if (complaint.status === 'rejected') {
      return stepKey === 'new' ? 'completed' : 'rejected';
    }

    if (currentIdx >= stepIdx) return 'completed';
    return 'upcoming';
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#F9FAFB] text-[#0F172A] font-sans antialiased pb-12">
      <div className="max-w-[440px] mx-auto bg-white min-h-screen shadow-sm border-x border-[#E5E7EB] flex flex-col">
        
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E5E7EB] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <a href="/complaint" className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700 hover:bg-gray-200">
              <ChevronLeft className="w-4 h-4" />
            </a>
            <div>
              <span className="font-bold text-base text-[#111111]">متابعة حالة البلاغ</span>
              <p className="text-xs text-gray-500">رش واش · فرع الخرج</p>
            </div>
          </div>
          <a
            href="https://wa.me/966500000000"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#E7F8EE] text-emerald-800 font-bold border border-emerald-200"
          >
            <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
            <span>واتساب</span>
          </a>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 space-y-4">

          {/* Search box if needed */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={ticketCode}
              onChange={e => setTicketCode(e.target.value)}
              placeholder="أدخل رقم البلاغ (مثال: C-2026-0001)"
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C91E2F]"
            />
            <button
              type="button"
              onClick={() => fetchTicket(ticketCode)}
              disabled={isLoading || !ticketCode}
              className="px-4 py-2 bg-[#C91E2F] text-white text-xs font-bold rounded-lg hover:bg-[#B21927] transition"
            >
              {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'بحث'}
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {complaint && (
            <div className="space-y-4">
              
              {/* Ticket Headline Card */}
              <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-xl p-4 space-y-2 shadow-sm">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>رقم البلاغ</span>
                  <span className="text-xs text-gray-300">{complaint.createdAtAST}</span>
                </div>
                <div className="text-2xl font-black tracking-wider text-white">
                  #{complaint.ticketCode}
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-gray-700/60 text-xs">
                  <span className="text-gray-300">المركبة: <strong className="text-white">{complaint.vehiclePlate}</strong></span>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-[#C91E2F] text-white">
                    {complaint.statusAr}
                  </span>
                </div>
              </div>

              {/* Progress Stepper */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <h4 className="text-xs font-bold text-gray-800">مراحل معالجة البلاغ</h4>
                <div className="space-y-3 relative pr-2">
                  {statusSteps.map((s, idx) => {
                    const status = getStepStatus(s.key);
                    const isDone = status === 'completed';
                    return (
                      <div key={s.key} className="flex items-start gap-3">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${
                          isDone ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-400'
                        }`}>
                          {isDone ? '✓' : idx + 1}
                        </div>
                        <div>
                          <div className={`text-xs font-bold ${isDone ? 'text-gray-900' : 'text-gray-400'}`}>
                            {s.label}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {s.desc}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Details & Notes Timeline */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <h4 className="text-xs font-bold text-gray-800">سجل التحديثات والملاحظات</h4>
                
                {complaint.notes?.length > 0 ? (
                  <div className="space-y-2">
                    {complaint.notes.map((n, i) => (
                      <div key={i} className="p-2.5 rounded-lg bg-gray-50 border border-gray-100 text-xs space-y-1">
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span className="font-bold text-gray-700">{n.authorName}</span>
                          <span>{n.createdAtAST}</span>
                        </div>
                        <p className="text-gray-800 text-xs leading-relaxed">{n.noteText}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">لا توجد ملاحظات إضافية حتى الآن.</p>
                )}

                {/* Form to append additional notes */}
                <form onSubmit={handleAppendNote} className="pt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    placeholder="إضافة ملاحظة أو توضيح..."
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C91E2F]"
                  />
                  <button
                    type="submit"
                    disabled={isAppending || !newNote.trim()}
                    className="px-3 py-2 bg-[#C91E2F] text-white text-xs font-bold rounded-lg hover:bg-[#B21927] disabled:opacity-50"
                  >
                    {isAppending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                </form>
              </div>

            </div>
          )}

        </main>
      </div>
    </div>
  );
}
