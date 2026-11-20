import React, { useState, useEffect } from 'react';
import { 
  Car, 
  ShieldAlert, 
  Video, 
  MessageSquare, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  Search, 
  ChevronLeft, 
  ExternalLink,
  Sliders,
  Check,
  AlertTriangle,
  Send,
  Camera,
  Layers,
  ArrowRight
} from 'lucide-react';

interface ComplaintItem {
  ticketCode: string;
  phone: string;
  vehiclePlate: string;
  customerName?: string;
  branch: string;
  bay: string;
  category: string;
  affectedParts?: string[];
  description: string;
  status: string;
  severity: string;
  evidence?: Array<{ fileKey: string; fileName: string; fileType: string; r2Url: string }>;
  washDetails?: any;
  notes?: Array<{ author: string; authorName: string; noteText: string; createdAtAST: string }>;
  createdAtAST: string;
}

export function SupervisorDeskPage() {
  const [complaints, setComplaints] = useState<ComplaintItem[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<ComplaintItem | null>(null);
  const [activeTab, setActiveTab] = useState<'dvr' | 'whatsapp' | 'resolution'>('dvr');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  // Camera angle selection
  const [activeCamera, setActiveCamera] = useState<'entrance' | 'brushes' | 'rims' | 'exit'>('entrance');

  // Resolution state
  const [resolutionType, setResolutionType] = useState<'rewash' | 'refund' | 'rejected'>('rewash');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionSuccess, setResolutionSuccess] = useState<string | null>(null);

  // Quick WhatsApp message
  const [quickMsg, setQuickMsg] = useState('');

  useEffect(() => {
    fetchComplaints();
  }, [statusFilter]);

  const deskHeaders = (): Record<string, string> => {
    let key = '';
    try { key = sessionStorage.getItem('rush_desk_key') || ''; } catch { /* storage unavailable */ }
    return key ? { 'x-desk-key': key } : {};
  };

  // On 401, ask the supervisor for the desk key once and retry.
  const deskFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const run = () => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...deskHeaders() } });
    let res = await run();
    if (res.status === 401) {
      const entered = window.prompt('أدخل مفتاح مكتب المشرف (Desk key)');
      if (entered) {
        try { sessionStorage.setItem('rush_desk_key', entered); } catch { /* ignore */ }
        res = await run();
      }
    }
    return res;
  };

  const fetchComplaints = async () => {
    setIsLoading(true);
    try {
      const url = `/api/complaints/desk/list?status=${statusFilter}&search=${encodeURIComponent(search)}`;
      const res = await deskFetch(url);
      const data = await res.json();
      if (data.success && data.complaints) {
        setComplaints(data.complaints);
        if (data.complaints.length > 0 && !selectedTicket) {
          setSelectedTicket(data.complaints[0]);
        }
      }
    } catch (err) {
      console.warn('Fetch complaints error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolve = async () => {
    if (!selectedTicket) return;
    setIsResolving(true);
    setResolutionSuccess(null);
    try {
      const res = await deskFetch(`/api/complaints/desk/${encodeURIComponent(selectedTicket.ticketCode)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolutionType,
          resolutionNotes,
          resolvedBy: 'مشرف الفرع (Supervisor)'
        })
      });
      const data = await res.json();
      if (data.success) {
        setResolutionSuccess(`تم اتخاذ القرار بنجاح للبلاغ #${selectedTicket.ticketCode}`);
        fetchComplaints();
      }
    } catch (err) {
      console.warn('Resolve error:', err);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#0B0B0F] text-[#F8FAFC] font-sans antialiased pb-12">
      {/* Mobile-optimized viewport (max-w-[480px]) */}
      <div className="max-w-[480px] mx-auto bg-[#131318] min-h-screen border-x border-[#232329] flex flex-col shadow-2xl">
        
        {/* Sticky Header */}
        <header className="sticky top-0 z-30 bg-[#131318]/95 backdrop-blur-md border-b border-[#232329] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <a href="/" className="w-8 h-8 rounded-lg bg-[#232329] flex items-center justify-center text-white hover:bg-gray-700">
              <ChevronLeft className="w-4 h-4" />
            </a>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base text-white">لوحة إشراف البلاغات</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#C91E2F] text-white font-bold">الخرج</span>
              </div>
              <p className="text-[11px] text-gray-400">تفريغ الكاميرات والتنسيق عبر واتساب</p>
            </div>
          </div>

          <a 
            href="/"
            className="text-xs px-2.5 py-1 rounded-md border border-[#232329] bg-[#1A1A22] text-gray-300 hover:text-white flex items-center gap-1"
          >
            <Car className="w-3.5 h-3.5 text-[#C91E2F]" />
            <span>بوابة العميل</span>
          </a>
        </header>

        {/* Search & Filters */}
        <div className="p-3 border-b border-[#232329] bg-[#0E0E13] space-y-2">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchComplaints()}
              placeholder="بحث برقم اللوحة، الجوال، أو رقم البلاغ..."
              className="w-full pl-3 pr-8 py-2 text-xs rounded-lg bg-[#181820] border border-[#2A2A33] text-white placeholder-gray-500 focus:outline-none focus:border-[#C91E2F]"
            />
            <Search className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-2.5" />
          </div>

          <div className="flex items-center gap-1 text-[11px] overflow-x-auto pb-0.5">
            {[
              { id: 'all', label: 'الكل' },
              { id: 'new', label: 'جديدة' },
              { id: 'in_review', label: 'قيد المراجعة' },
              { id: 'resolved', label: 'تم الحل' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-2.5 py-1 rounded-md font-semibold transition shrink-0 ${
                  statusFilter === f.id ? 'bg-[#C91E2F] text-white' : 'bg-[#181820] text-gray-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Complaints List Carousel / Selector */}
        {complaints.length > 0 ? (
          <div className="p-3 border-b border-[#232329] overflow-x-auto flex items-center gap-2">
            {complaints.map(c => {
              const isSelected = selectedTicket?.ticketCode === c.ticketCode;
              return (
                <div
                  key={c.ticketCode}
                  onClick={() => { setSelectedTicket(c); setResolutionSuccess(null); }}
                  className={`p-2.5 rounded-xl border text-xs cursor-pointer transition shrink-0 w-[180px] ${
                    isSelected 
                      ? 'border-[#C91E2F] bg-[#C91E2F]/10' 
                      : 'border-[#232329] bg-[#181820] hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span className="font-bold text-white">#{c.ticketCode}</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-red-950 text-red-300 font-bold">
                      {c.category === 'damage' ? 'ضرر' : 'ملاحظة'}
                    </span>
                  </div>
                  <div className="font-bold text-white text-xs mt-1 truncate">{c.vehiclePlate}</div>
                  <div className="text-[10px] text-gray-400 truncate mt-0.5">{c.customerName || c.phone}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-6 text-center text-xs text-gray-500">
            {isLoading ? 'جاري تحميل البلاغات...' : 'لا توجد بلاغات مسجلة حالياً.'}
          </div>
        )}

        {/* Active Ticket Details View */}
        {selectedTicket && (
          <main className="flex-1 p-4 space-y-4">
            
            {/* Active Ticket Snapshot */}
            <div className="rounded-xl bg-[#181822] border border-[#2A2A36] p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-[#C91E2F]">#{selectedTicket.ticketCode}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 font-bold border border-emerald-800">
                  {selectedTicket.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-gray-300 pt-1">
                <div>
                  <span className="text-[10px] text-gray-500 block">المركبة</span>
                  <strong className="text-white text-sm">{selectedTicket.vehiclePlate}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 block">الجوال</span>
                  <a href={`tel:${selectedTicket.phone}`} className="text-white hover:underline">{selectedTicket.phone}</a>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 block">وقت الغسيل</span>
                  <span className="text-gray-300 text-[11px]">{selectedTicket.createdAtAST}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 block">التصنيف</span>
                  <span className="text-white text-[11px]">{selectedTicket.category}</span>
                </div>
              </div>

              <div className="bg-[#101017] rounded-lg p-2.5 text-xs text-gray-300 border border-[#232329] mt-2">
                <span className="text-[10px] text-gray-500 block mb-1">وصف العميل:</span>
                <p className="leading-relaxed">{selectedTicket.description}</p>
              </div>
            </div>

            {/* 3-Tab Mobile Navigation */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-[#181822] rounded-xl border border-[#2A2A36] text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('dvr')}
                className={`py-2 rounded-lg font-bold flex items-center justify-center gap-1 transition ${
                  activeTab === 'dvr' ? 'bg-[#C91E2F] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>الكاميرات</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('whatsapp')}
                className={`py-2 rounded-lg font-bold flex items-center justify-center gap-1 transition ${
                  activeTab === 'whatsapp' ? 'bg-[#C91E2F] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>واتساب</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('resolution')}
                className={`py-2 rounded-lg font-bold flex items-center justify-center gap-1 transition ${
                  activeTab === 'resolution' ? 'bg-[#C91E2F] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>القرار</span>
              </button>
            </div>

            {/* Tab 1: DVR Camera Arch & Telematics */}
            {activeTab === 'dvr' && (
              <div className="space-y-3">
                {/* Simulated DVR Video Screen */}
                <div className="rounded-xl overflow-hidden bg-black border border-[#2A2A36] relative aspect-video flex flex-col justify-between p-3">
                  <div className="flex items-center justify-between text-[10px] text-gray-400 z-10">
                    <span className="flex items-center gap-1 bg-red-600 text-white px-1.5 py-0.2 rounded font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      DVR REC
                    </span>
                    <span className="bg-black/60 px-2 py-0.5 rounded font-mono text-white">
                      CAM-{activeCamera.toUpperCase()} · 13:15:22 AST
                    </span>
                  </div>

                  <div className="text-center my-auto">
                    <Video className="w-10 h-10 text-gray-600 mx-auto" />
                    <span className="text-[11px] text-gray-400 block mt-1">تسجيل كاميرا النفق متزامن مع لحظة الغسيل</span>
                  </div>

                  {/* Camera Angle Selector */}
                  <div className="flex items-center justify-center gap-1 z-10">
                    {[
                      { id: 'entrance', label: 'المدخل' },
                      { id: 'brushes', label: 'الفرش' },
                      { id: 'rims', label: 'الجنوط' },
                      { id: 'exit', label: 'المخرج' }
                    ].map(cam => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => setActiveCamera(cam.id as any)}
                        className={`text-[10px] px-2 py-0.5 rounded transition ${
                          activeCamera === cam.id ? 'bg-[#C91E2F] text-white font-bold' : 'bg-black/70 text-gray-400'
                        }`}
                      >
                        {cam.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Telematics Sensors Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-[#181822] border border-[#2A2A36]">
                    <span className="text-[10px] text-gray-500 block">سرعة النفق (Speed)</span>
                    <span className="font-bold text-white text-sm">2.1 كم/س (طبيعي)</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#181822] border border-[#2A2A36]">
                    <span className="text-[10px] text-gray-500 block">ضغط مضخات الماء</span>
                    <span className="font-bold text-white text-sm">75 بار (مطابق)</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#181822] border border-[#2A2A36]">
                    <span className="text-[10px] text-gray-500 block">توزيع صابون نانو</span>
                    <span className="font-bold text-emerald-400 text-sm">سليم 100%</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#181822] border border-[#2A2A36]">
                    <span className="text-[10px] text-gray-500 block">دوران الفرش</span>
                    <span className="font-bold text-emerald-400 text-sm">متزن (0 عزم شاذ)</span>
                  </div>
                </div>

                {/* Customer Attached Photos */}
                {selectedTicket.evidence && selectedTicket.evidence.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-gray-300">الصور المرفقة من العميل:</span>
                    <div className="grid grid-cols-3 gap-2">
                      {selectedTicket.evidence.map((ev, i) => (
                        <a key={i} href={ev.r2Url} target="_blank" rel="noreferrer" className="rounded-lg overflow-hidden border border-[#2A2A36] aspect-square block bg-black">
                          <img src={ev.r2Url} alt="evidence" className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: WhatsApp Chatwoot Preview */}
            {activeTab === 'whatsapp' && (
              <div className="space-y-3">
                <div className="rounded-xl bg-[#0F1D17] border border-[#1C3A2B] p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between text-emerald-400 font-bold border-b border-[#1C3A2B] pb-1.5">
                    <span className="flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>محادثة واتساب مباشرة ({selectedTicket.phone})</span>
                    </span>
                    <a
                      href={`https://wa.me/${selectedTicket.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`مرحباً معك مشرف فرع رش واش بالخرج بخصوص بلاغكم برقم #${selectedTicket.ticketCode}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold"
                    >
                      فتح في واتساب
                    </a>
                  </div>

                  <div className="space-y-2 py-2">
                    <div className="p-2 rounded-lg bg-[#193225] text-emerald-100 text-[11px] leading-relaxed max-w-[85%] mr-auto">
                      تم إرسال رسالة التأكيد الآلية للعميل برقم التذكرة ورابط المتابعة.
                    </div>
                  </div>
                </div>

                {/* Quick Reply Presets */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-gray-400">ردود سريعة جاهزة:</span>
                  {[
                    'مرحباً، تم فحص كاميرات النفق بدقة ونود التنسيق معكم لإعادة الغسيل فوراً.',
                    'يرجى التفضل بزيارة مشرف الفرع بالخرج لإجراء المعاينة والتعويض الفوري.',
                    'بعد مراجعة الكاميرات بدقة، يظهر أن الخدش كان متواجداً قبل دخول النفق.'
                  ].map((msg, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setQuickMsg(msg)}
                      className="w-full text-right p-2 rounded-lg bg-[#181822] border border-[#2A2A36] text-[11px] text-gray-300 hover:border-gray-500 transition"
                    >
                      {msg}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Resolution & Claim Settlement */}
            {activeTab === 'resolution' && (
              <div className="space-y-3">
                <div className="rounded-xl bg-[#181822] border border-[#2A2A36] p-3.5 space-y-3">
                  <span className="text-xs font-bold text-white block">اتخاذ القرار والتعويض:</span>

                  <div className="grid grid-cols-3 gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setResolutionType('rewash')}
                      className={`p-2 rounded-lg font-bold border transition ${
                        resolutionType === 'rewash'
                          ? 'border-emerald-500 bg-emerald-950/60 text-emerald-300'
                          : 'border-[#2A2A36] text-gray-400'
                      }`}
                    >
                      غسيل تعويضي
                    </button>
                    <button
                      type="button"
                      onClick={() => setResolutionType('refund')}
                      className={`p-2 rounded-lg font-bold border transition ${
                        resolutionType === 'refund'
                          ? 'border-blue-500 bg-blue-950/60 text-blue-300'
                          : 'border-[#2A2A36] text-gray-400'
                      }`}
                    >
                      استرداد مالي
                    </button>
                    <button
                      type="button"
                      onClick={() => setResolutionType('rejected')}
                      className={`p-2 rounded-lg font-bold border transition ${
                        resolutionType === 'rejected'
                          ? 'border-red-500 bg-red-950/60 text-red-300'
                          : 'border-[#2A2A36] text-gray-400'
                      }`}
                    >
                      رفض البلاغ
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">ملاحظات المشرف وتفاصيل القرار:</label>
                    <textarea
                      rows={3}
                      value={resolutionNotes}
                      onChange={e => setResolutionNotes(e.target.value)}
                      placeholder="اكتب سبب القرار أو رقم القسيمة التعويضية..."
                      className="w-full p-2.5 text-xs rounded-lg bg-[#101017] border border-[#2A2A36] text-white focus:outline-none focus:border-[#C91E2F]"
                    />
                  </div>

                  {resolutionSuccess && (
                    <div className="p-2.5 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs">
                      {resolutionSuccess}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleResolve}
                    disabled={isResolving}
                    className="w-full py-2.5 rounded-xl bg-[#C91E2F] hover:bg-[#B21927] text-white font-bold text-xs transition disabled:opacity-50"
                  >
                    {isResolving ? 'جاري توثيق القرار...' : 'اعتماد القرار وإشعار العميل فوراً'}
                  </button>
                </div>
              </div>
            )}

          </main>
        )}

      </div>
    </div>
  );
}
