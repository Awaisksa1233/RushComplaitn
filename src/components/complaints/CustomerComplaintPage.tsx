import React, { useState, useEffect } from 'react';
import { getComplaintsApiUrl } from '../../services/complaintsClient';
import { 
  Car, 
  ShieldCheck, 
  AlertTriangle, 
  UploadCloud, 
  X, 
  CheckCircle2, 
  MessageSquare, 
  Clock, 
  ChevronRight, 
  Sparkles,
  Phone,
  FileText,
  MapPin,
  ExternalLink,
  Camera,
  RefreshCw
} from 'lucide-react';

interface VerifiedWash {
  washId: string;
  washDateAST: string;
  washDateASTArabic: string;
  branch: string;
  branchAr: string;
  lane: string;
  laneAr: string;
  packageTier: string;
  packageNameAr: string;
  displayPlate: string;
  normalizedPlate: string;
  customerName: string;
}

interface VerifiedOrder {
  orderId: string;
  orderCode: string;
  totalSAR: number;
  orderDateAST: string;
  packageNameAr: string;
  displayPlate: string;
}

interface ExistingTicket {
  ticketCode: string;
  category: string;
  status: string;
  statusAr: string;
  createdAtAST: string;
  vehiclePlate: string;
}

interface UploadedFile {
  fileKey: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  r2Url: string;
  previewUrl: string;
}

export function CustomerComplaintPage() {
  // Localization
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const isAr = lang === 'ar';

  // Step 1: Context Detection from URL
  const [branch, setBranch] = useState<'al-kharj' | 'watan'>('al-kharj');
  const [bay, setBay] = useState<string>('tunnel-1');
  const [isEditingContext, setIsEditingContext] = useState(false);

  // Step 2: Customer Inputs & Verification
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedWashes, setVerifiedWashes] = useState<VerifiedWash[]>([]);
  const [verifiedOrders, setVerifiedOrders] = useState<VerifiedOrder[]>([]);
  const [selectedWash, setSelectedWash] = useState<VerifiedWash | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<VerifiedOrder | null>(null);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [existingTicket, setExistingTicket] = useState<ExistingTicket | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Step 4: Complaint Details
  const [category, setCategory] = useState<'damage' | 'quality' | 'billing' | 'delay' | 'staff'>('damage');
  const [selectedParts, setSelectedParts] = useState<string[]>(['hood_bumper']);
  const [description, setDescription] = useState('');
  const [evidenceList, setEvidenceList] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Step 5: Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedTicket, setSubmittedTicket] = useState<{
    ticketCode: string;
    createdAtAST: string;
    whatsappSupportUrl?: string;
  } | null>(null);

  // Parse query params on mount
  useEffect(() => {
    document.title = isAr ? 'رش واش — تقديم بلاغ' : 'RUSH Car Wash — Submit a complaint';
    document.documentElement.lang = isAr ? 'ar' : 'en';
  }, [isAr]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const b = params.get('branch');
      const by = params.get('bay');
      if (b === 'watan') setBranch('watan');
      if (by) setBay(by);
    }
  }, []);

  // Verification lookup against backend
  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!phone && !plate) return;

    setIsVerifying(true);
    setHasSearched(true);
    setExistingTicket(null);
    setSelectedWash(null);
    setSelectedOrder(null);

    try {
      const res = await fetch(getComplaintsApiUrl('/api/complaints/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, plate, branch })
      });
      const data = await res.json();
      if (data.success) {
        setVerifiedWashes(data.matchedWashes || []);
        setVerifiedOrders(data.matchedOrders || []);
        if (data.matchedWashes?.length > 0) {
          setSelectedWash(data.matchedWashes[0]);
        }
        if (data.duplicateFound && data.existingTicket) {
          setExistingTicket(data.existingTicket);
        }
      }
    } catch (err) {
      console.warn('Verify error:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  // Toggle vehicle damage part chip
  const togglePart = (partKey: string) => {
    if (selectedParts.includes(partKey)) {
      setSelectedParts(selectedParts.filter(p => p !== partKey));
    } else {
      setSelectedParts([...selectedParts, partKey]);
    }
  };

  // Mock / R2 File Upload handler
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (evidenceList.length + files.length > 5) {
      alert(isAr ? 'الحد الأقصى المسموح به هو 5 ملفات فقط' : 'Maximum 5 files allowed');
      return;
    }

    setIsUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 15 * 1024 * 1024) {
          alert(isAr ? 'حجم الملف يتجاوز 15 ميجابايت' : 'File exceeds 15MB limit');
          continue;
        }

        // Request upload URL from backend
        const res = await fetch(getComplaintsApiUrl('/api/complaints/upload-url'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size
          })
        });
        const data = await res.json();
        if (data.success) {
          const previewUrl = URL.createObjectURL(file);
          setEvidenceList(prev => [
            ...prev,
            {
              fileKey: data.fileKey,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
              r2Url: data.r2Url,
              previewUrl
            }
          ]);
        }
      }
    } catch (err) {
      console.error('File upload error:', err);
    } finally {
      setIsUploading(false);
    }
  };

  // Final Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !plate || !description.trim()) {
      alert(isAr ? 'يرجى إكمال جميع الحقول المطلوبة' : 'Please fill all required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        phone,
        vehiclePlate: plate,
        branch,
        bay,
        category,
        affectedParts: selectedParts,
        description,
        washId: selectedWash?.washId || null,
        orderId: selectedOrder?.orderId || null,
        washDetails: selectedWash || selectedOrder || null,
        evidence: evidenceList
      };

      const res = await fetch(getComplaintsApiUrl('/api/complaints/submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.status === 409 && data.existingTicket) {
        setExistingTicket(data.existingTicket);
        return;
      }

      if (data.success) {
        setSubmittedTicket({
          ticketCode: data.ticketCode,
          createdAtAST: data.createdAtAST,
          whatsappSupportUrl: data.whatsappSupportUrl
        });
      } else {
        alert(data.error || 'Submission failed');
      }
    } catch (err) {
      console.error('Submit error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Vehicle part options
  const vehicleParts = [
    { key: 'hood_bumper', labelAr: 'الكبوت والصدام الأمامي', labelEn: 'Hood & Front Bumper' },
    { key: 'windshield', labelAr: 'الزجاج والمرايا', labelEn: 'Windshield & Mirrors' },
    { key: 'doors_side', labelAr: 'الأبواب والطلاء الجانبي', labelEn: 'Doors & Side Paint' },
    { key: 'rims_tires', labelAr: 'الجنوط والإطارات', labelEn: 'Rims & Tires' },
    { key: 'trunk_rear', labelAr: 'الشنطة والصدام الخلفي', labelEn: 'Trunk & Rear Bumper' },
    { key: 'interior', labelAr: 'المقصورة والمقاعد', labelEn: 'Interior & Seats' },
    { key: 'other', labelAr: 'أخرى', labelEn: 'Other' }
  ];

  // Category options
  const categories = [
    { key: 'damage', labelAr: 'مركبة متضررة', labelEn: 'Vehicle Damage', badge: '#C91E2F' },
    { key: 'quality', labelAr: 'جودة الغسيل', labelEn: 'Wash Quality', badge: '#0284C7' },
    { key: 'billing', labelAr: 'مشاكل اشتراك / مبالغ', labelEn: 'Billing & Refund', badge: '#D97706' },
    { key: 'delay', labelAr: 'تأخير بالخدمة', labelEn: 'Service Delay', badge: '#64748B' },
    { key: 'staff', labelAr: 'تعامل موظفين / أمن وسلامة', labelEn: 'Staff & Safety', badge: '#475569' }
  ];

  return (
    <div dir={isAr ? 'rtl' : 'ltr'} className="min-h-screen bg-[#F9FAFB] text-[#0F172A] font-sans antialiased pb-12">
      {/* Mobile-optimized Container */}
      <div className="max-w-[440px] mx-auto bg-white min-h-screen shadow-sm border-x border-[#E5E7EB] flex flex-col">
        
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E5E7EB] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#C91E2F] flex items-center justify-center text-white shadow-sm">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-lg tracking-tight text-[#111111]">رش واش</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-[#FDE8EA] text-[#C91E2F] font-bold">RUSH</span>
              </div>
              <p className="text-xs text-gray-500">
                {branch === 'al-kharj' ? 'فرع الخرج' : 'فرع الوطن'} · {bay === 'tunnel-1' ? 'مسار النفق 1' : bay}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button 
              type="button" 
              onClick={() => setIsEditingContext(!isEditingContext)}
              className="text-xs px-3 py-2 rounded border border-[#E5E7EB] bg-gray-50 text-gray-700 hover:bg-gray-100 flex items-center gap-1"
            >
              <MapPin className="w-3 h-3 text-[#C91E2F]" />
              <span>{isAr ? 'الموقع' : 'Location'}</span>
            </button>
            <button
              type="button"
              onClick={() => setLang(l => l === 'ar' ? 'en' : 'ar')}
              className="text-xs font-semibold px-3 py-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              {isAr ? 'EN' : 'عربي'}
            </button>
          </div>
        </header>

        {/* Branch Context Dropdown if editing */}
        {isEditingContext && (
          <div className="bg-[#FFF5F5] border-b border-[#FDE8EA] p-3 text-xs space-y-2">
            <div className="font-semibold text-gray-800">{isAr ? 'تأكيد فرع ومسار الخدمة:' : 'Confirm Branch & Lane:'}</div>
            <div className="grid grid-cols-2 gap-2">
              <select 
                value={branch} 
                onChange={e => setBranch(e.target.value as any)}
                className="p-1.5 rounded border border-gray-300 text-xs bg-white"
              >
                <option value="al-kharj">فرع الخرج (Al Kharj)</option>
                <option value="watan">فرع الوطن (Watan)</option>
              </select>
              <input 
                type="text" 
                value={bay} 
                onChange={e => setBay(e.target.value)}
                placeholder="مسار الخدمة (Bay)"
                className="p-1.5 rounded border border-gray-300 text-xs bg-white"
              />
            </div>
          </div>
        )}

        {/* Step Progress Pill Indicator */}
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center justify-between text-xs font-medium text-gray-400 border-b border-gray-100 pb-2">
            <span className={submittedTicket ? 'text-gray-400' : 'text-[#C91E2F] font-bold'}>
              {isAr ? '1. التحقق' : '1. Verify'}
            </span>
            <span>→</span>
            <span className={selectedWash || isManualEntry ? 'text-[#C91E2F] font-bold' : ''}>
              {isAr ? '2. تفاصيل البلاغ' : '2. Details'}
            </span>
            <span>→</span>
            <span className={submittedTicket ? 'text-[#C91E2F] font-bold' : ''}>
              {isAr ? '3. الإرسال والمتابعة' : '3. Submit'}
            </span>
          </div>
        </div>

        {/* Main Body */}
        <main className="flex-1 p-4 space-y-5">

          {/* Submission Success Screen */}
          {submittedTicket ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {isAr ? 'تم استلام بلاغكم بنجاح!' : 'Complaint Received!'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  {isAr ? 'تم توثيق البلاغ وتعيينه لفريق المتابعة ومشرف الفرع' : 'Ticket created and assigned for DVR review'}
                </p>
              </div>

              {/* Ticket Card */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center space-y-2">
                <span className="text-xs text-gray-500 uppercase tracking-wider">{isAr ? 'رقم البلاغ' : 'Ticket Number'}</span>
                <div className="text-2xl font-black text-[#C91E2F] tracking-wider">
                  #{submittedTicket.ticketCode}
                </div>
                <div className="text-xs text-gray-400">
                  {submittedTicket.createdAtAST}
                </div>
              </div>

              {/* WhatsApp Action */}
              <div className="bg-[#E7F8EE] border border-[#B3E8C7] rounded-xl p-4 text-right space-y-2">
                <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                  <span>{isAr ? 'متابعة مباشرة عبر واتساب' : 'Direct WhatsApp Updates'}</span>
                </div>
                <p className="text-xs text-emerald-900 leading-relaxed">
                  {isAr 
                    ? 'تم إرسال رسالة تأكيد لرقمك. يمكنك المتابعة وإرسال صور إضافية مباشرة عبر محادثة واتساب.'
                    : 'A WhatsApp confirmation has been dispatched. You can track or send photos directly via chat.'}
                </p>
                <a
                  href={`/complaint/${submittedTicket.ticketCode}`}
                  className="block w-full py-2.5 rounded-lg bg-emerald-600 text-white font-bold text-xs text-center hover:bg-emerald-700 transition"
                >
                  {isAr ? 'عرض صفحة تتبع البلاغ' : 'View Tracking Timeline'}
                </a>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSubmittedTicket(null);
                  setSelectedWash(null);
                  setDescription('');
                  setEvidenceList([]);
                }}
                className="text-xs text-gray-500 hover:text-gray-800 underline"
              >
                {isAr ? 'تقديم بلاغ جديد' : 'Submit another claim'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              
              {/* Trust Guarantee Header */}
              <div className="rounded-xl bg-[#FDE8EA]/60 border border-[#FDE8EA] p-3 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-[#C91E2F] shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-bold text-[#C91E2F]">
                    {isAr ? 'ضمان رضا عملاء رش واش 100%' : '100% Customer Satisfaction Guarantee'}
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                    {isAr 
                      ? 'نحن ملتزمون بأعلى معايير الخدمة. سيتم فحص كاميرات النفق بدقة وتعويضكم فوراً في حال وجود أي ملاحظة.'
                      : 'We inspect DVR footage to resolve any wash quality or vehicle issues immediately.'}
                  </p>
                </div>
              </div>

              {/* Step 2: Customer Phone & Saudi Vehicle Plate Verification */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-[#C91E2F] text-white text-xs flex items-center justify-center font-bold">1</span>
                    {isAr ? 'بيانات العميل والمركبة' : 'Customer & Vehicle Identification'}
                  </span>
                  <span className="text-xs text-gray-400">{isAr ? 'التحقق الآلي' : 'Auto Verification'}</span>
                </div>

                {/* Plate & Phone Grid */}
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      {isAr ? 'رقم لوحة المركبة *' : 'Vehicle License Plate *'}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        dir="ltr"
                        autoComplete="off"
                        autoCapitalize="characters"
                        value={plate}
                        onChange={e => setPlate(e.target.value)}
                        placeholder="1234 ABC"
                        className="w-full px-3 py-3 text-base rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C91E2F]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      {isAr ? 'رقم الجوال *' : 'Mobile Phone Number *'}
                    </label>
                    <div className="relative">
                      <input
                        type="tel"
                        required
                        dir="ltr"
                        inputMode="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="05XXXXXXXX"
                        className="w-full px-3 py-3 text-base rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C91E2F]"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleVerify()}
                    disabled={isVerifying || (!phone && !plate)}
                    className="w-full py-3 rounded-lg bg-gray-900 text-white text-sm font-bold hover:bg-black transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isVerifying ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-[#C91E2F]" />
                    )}
                    <span>{isAr ? 'مطابقة بيانات الغسيل تلقائياً' : 'Match Wash Record'}</span>
                  </button>
                </div>

                {/* Duplicate Alert Card if active ticket exists */}
                {existingTicket && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-2">
                    <div className="flex items-center gap-1.5 text-amber-800 font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span>{isAr ? 'يوجد بلاغ نشط لهذه المركبة بالفعل' : 'Active Ticket Exists'}</span>
                    </div>
                    <p className="text-xs text-amber-900">
                      {isAr 
                        ? `البلاغ رقم #${existingTicket.ticketCode} (${existingTicket.statusAr}) تم تسجيله بتاريخ ${existingTicket.createdAtAST}.`
                        : `Ticket #${existingTicket.ticketCode} is currently ${existingTicket.status}.`}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <a
                        href={`/complaint/${existingTicket.ticketCode}`}
                        className="flex-1 py-1.5 rounded bg-amber-600 text-white font-bold text-center text-xs hover:bg-amber-700"
                      >
                        {isAr ? 'متابعة البلاغ' : 'Track Status'}
                      </a>
                      <a
                        href={`https://wa.me/966500000000?text=${encodeURIComponent(`أستفسر عن بلاغي #${existingTicket.ticketCode}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 py-1.5 rounded bg-emerald-600 text-white font-bold text-center text-xs hover:bg-emerald-700"
                      >
                        {isAr ? 'محادثة واتساب' : 'WhatsApp'}
                      </a>
                    </div>
                  </div>
                )}

                {/* Verified Washes List (last 7 days) */}
                {verifiedWashes.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <span className="text-xs font-bold text-gray-700 block">
                      {isAr ? 'تم العثور على الغسلات التالية (آخر 7 أيام):' : 'Matched Washes (Last 7 Days):'}
                    </span>
                    {verifiedWashes.map(w => (
                      <div
                        key={w.washId}
                        onClick={() => { setSelectedWash(w); setIsManualEntry(false); }}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer transition flex items-center justify-between ${
                          selectedWash?.washId === w.washId
                            ? 'border-[#C91E2F] bg-[#FFF5F5]'
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-gray-900">{w.packageNameAr} · {w.branchAr}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{w.washDateASTArabic} · {w.laneAr}</div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                          selectedWash?.washId === w.washId ? 'bg-[#C91E2F] text-white' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {selectedWash?.washId === w.washId ? (isAr ? 'محدد' : 'Selected') : (isAr ? 'اختيار' : 'Select')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Fallback to manual entry if search has run and no wash selected */}
                {hasSearched && (
                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={() => setIsManualEntry(!isManualEntry)}
                      className="text-xs text-[#C91E2F] hover:underline font-semibold"
                    >
                      {isAr ? 'لم تجد غسلتك؟ المتابعة بإدخال يدوي دون حظر' : 'Cannot find wash? Proceed with manual entry'}
                    </button>
                  </div>
                )}
              </div>

              {/* Step 4: Category, Chips & Description */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-[#C91E2F] text-white text-xs flex items-center justify-center font-bold">2</span>
                    {isAr ? 'تفاصيل الملاحظة أو الضرر' : 'Complaint Details'}
                  </span>
                </div>

                {/* Category Chips */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    {isAr ? 'تصنيف البلاغ *' : 'Category *'}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map(c => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setCategory(c.key as any)}
                        className={`px-3.5 py-2.5 rounded-lg text-sm font-semibold transition ${
                          category === c.key
                            ? 'bg-[#C91E2F] text-white shadow-sm'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {isAr ? c.labelAr : c.labelEn}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vehicle Part Chips (if category is damage or quality) */}
                {(category === 'damage' || category === 'quality') && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      {isAr ? 'الجزء المتأثر بالمركبة (حدد كل ما ينطبق) *' : 'Affected Vehicle Parts *'}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {vehicleParts.map(p => {
                        const isSelected = selectedParts.includes(p.key);
                        return (
                          <button
                            key={p.key}
                            type="button"
                            onClick={() => togglePart(p.key)}
                            className={`px-3 py-2 rounded-md text-xs font-medium border transition ${
                              isSelected
                                ? 'border-[#C91E2F] bg-[#FDE8EA] text-[#C91E2F]'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            {isAr ? p.labelAr : p.labelEn}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    {isAr ? 'وصف المشكلة بدقة لمراجعة الكاميرات *' : 'Detailed Description *'}
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={isAr 
                      ? 'يرجى كتابة ما حدث بدقة (مثال: لاحظت خدش في الصدام بعد الخروج من النفق)'
                      : 'Describe what happened to help us inspect DVR recordings...'}
                    className="w-full p-3 text-base rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C91E2F]"
                  />
                </div>

                {/* Evidence Upload (Cloudflare R2) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-gray-700">
                      {isAr ? 'إرفاق صور أو فيديو للضرر (اختياري - حتى 5 ملفات)' : 'Attach Photos/Video (Up to 5)'}
                    </label>
                    <span className="text-xs text-gray-400">15MB Max</span>
                  </div>

                  {/* Dropzone */}
                  <label className="block border-2 border-dashed border-gray-300 hover:border-[#C91E2F] rounded-xl p-4 text-center cursor-pointer bg-gray-50/50 transition">
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      onChange={e => handleFileUpload(e.target.files)}
                      className="hidden"
                    />
                    <div className="flex flex-col items-center gap-1.5 text-gray-500">
                      <Camera className="w-5 h-5 text-[#C91E2F]" />
                      <span className="text-xs font-semibold text-gray-700">
                        {isAr ? 'اضغط لالتقاط صورة أو اختيار ملفات' : 'Tap to take photo or upload files'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {isAr ? 'الصور تساعدنا في إنهاء البلاغ بسرعة' : 'Photos speed up video investigation'}
                      </span>
                    </div>
                  </label>

                  {/* Uploaded previews */}
                  {evidenceList.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {evidenceList.map((f, idx) => (
                        <div key={idx} className="relative w-16 h-16 rounded-lg border border-gray-200 overflow-hidden bg-gray-100 group">
                          {f.fileType.startsWith('image') ? (
                            <img src={f.previewUrl} alt={f.fileName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs font-bold text-gray-500">
                              VIDEO
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setEvidenceList(evidenceList.filter((_, i) => i !== idx))}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center text-xs"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Submit CTA */}
              <div className="space-y-2 pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || !phone || !plate || !description.trim()}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#C91E2F] hover:bg-[#B21927] text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <MessageSquare className="w-4 h-4" />
                  )}
                  <span>
                    {isAr ? 'إرسال البلاغ والمتابعة عبر واتساب 💬' : 'Submit & Track via WhatsApp 💬'}
                  </span>
                </button>
                <p className="text-xs text-gray-400 text-center leading-tight">
                  {isAr 
                    ? 'سيتم ربط بلاغكم برقم الجوال وفتح محادثة خدمة عملاء رسمية عبر تطبيق واتساب'
                    : 'A WhatsApp service ticket will be initiated directly with branch supervision.'}
                </p>
              </div>

            </form>
          )}

        </main>
      </div>
    </div>
  );
}
