// Official Catalog of Approved WhatsApp Templates for Rush Wash (رش واش).
// Synced from Meta/Unifonic live approved registry.

export interface WhatsAppTemplateItem {
  id: string;
  name: string;
  language: 'ar' | 'en';
  category: 'marketing' | 'utility' | 'service' | 'authentication';
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  body: string;
  buttons: string[];
}

export const TEMPLATE_CATALOG: WhatsAppTemplateItem[] = [
  {
    "id": "100_sar_a",
    "name": "100_sar_a",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "يا هلا ومسهلا! 💎\nودّك توفّر وموترك دايم نظيف؟\nاشترك في أي باقة تناسبك في رش واش واستمتع بغسيل لا محدود بـ 100 ريال/شهر بس لأول شهرين كاملين!",
    "buttons": [
      "أي باقة بـ 100 ريال"
    ]
  },
  {
    "id": "50_sar_a",
    "name": "50_sar_a",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "🎁 أضفنا لك 50 ريال في محفظتك!\n\nرصيد هدية من رش تقدر تستخدمه في غسيل سيارتك 🚘\n\n⏳ الرصيد صالح لمدة 7 أيام فقط، لا تفوّت الفرصة!",
    "buttons": [
      "زيارة الموقع"
    ]
  },
  {
    "id": "50_sar_reminder_a",
    "name": "50_sar_reminder_a",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "⚠️ لا تخسر رصيدك!\n\n🎁 50 ريال في محفظتك من رش، راح تُلغى تلقائياً خلال 48 ساعة!\n\n🚘 اغسل سيارتك واستفد منها قبل ما تنتهي.",
    "buttons": [
      "زيارة الفرع"
    ]
  },
  {
    "id": "50_sar_reminder_b",
    "name": "50_sar_reminder_b",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "🚘 اغسل سيارتك بـ 9 ريالات فقط!\n\n🎁 استخدم رصيدك 50 ريال من رش قبل إلغائه خلال 48 ساعة!",
    "buttons": [
      "زيارة الفرع"
    ]
  },
  {
    "id": "cloudy_weather",
    "name": "cloudy_weather",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "☁️ الجو مغيّم ومتردد تغسل سيارتك؟\n\nمع رش، لا تشيل هم الجو! 🌦️\nاغسل سيارتك وقت ما تبي، وخلّها نظيفة مهما تغيّر الجو.\n\n🔥 اشترك الآن بأي باقة بـ 100 ريال شهرياً لأول شهرين!",
    "buttons": [
      "اشترك الآن"
    ]
  },
  {
    "id": "family_plan",
    "name": "family_plan",
    "language": "ar",
    "category": "marketing",
    "status": "APPROVED",
    "body": "سيارات أكثر.. توفير أكثر!\n\nاجمع سيارات الأهل والأصدقاء في رش، حتى ٥ سيارات، واستمتع بخصم يزيد مع كل سيارة إضافية ويصل إلى ٣٥٪؜.\n\nلكل سيارة اشتراكها الخاص بغسيل غير محدود، والخصم يُطبّق على اشتراكات السيارات الإضافية.\n\nأضف السيارات بسهولة عبر موقع رش",
    "buttons": [
      "وفّر أكثر الآن"
    ]
  },
  {
    "id": "firstwash",
    "name": "firstwash",
    "language": "ar",
    "category": "marketing",
    "status": "APPROVED",
    "body": "حياك الله في رش! غسلتك الأولى علينا. استخدم الرمز FIRSTWASH عند مسار المبيعات خلال ٧ أيام واستمتع بغسلة نانو + تنظيف داخلي مجاناً.",
    "buttons": [
      "Visit website"
    ]
  },
  {
    "id": "firstwash_bulk",
    "name": "firstwash_bulk",
    "language": "ar",
    "category": "marketing",
    "status": "APPROVED",
    "body": "حياك الله في رش! غسلتك الأولى علينا. استخدم الرمز {{1}} عند مسار المبيعات خلال ٧ أيام واستمتع بغسلة نانو مجانية.",
    "buttons": []
  },
  {
    "id": "free_interior",
    "name": "free_interior",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "🎁 غسلة داخلية مجانية لسيارتك!\n\n🚘 جرّب نظافة رش الداخلية على حسابنا!\n\n⏳ استفد من هديتك خلال 7 أيام.",
    "buttons": [
      "زيارة الفرع"
    ]
  },
  {
    "id": "free_interior_membership",
    "name": "free_interior_membership",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "🎁 اشترك بالخارجي والداخلي علينا!\n\n🚘 احصل على شهر تنظيف داخلي غير محدود مجاناً عند اشتراكك في إحدى باقات رش!\n\n⏳ العرض صالح لمدة 7 أيام فقط.",
    "buttons": [
      "اشتراك الان"
    ]
  },
  {
    "id": "free_interior_subscription_reminder",
    "name": "free_interior_subscription_reminder",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "⏰ باقي 48 ساعة على انتهاء هديتك!\n\n🎁 اشترك بإحدى باقات رش الخارجية واحصل على شهر تنظيف داخلي غير محدود مجاناً!\n\n🚘 لا تفوّت العرض!",
    "buttons": [
      "اشترك الآن"
    ]
  },
  {
    "id": "free_interior_wash_reminder",
    "name": "free_interior_wash_reminder",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "⏰ غسلتك الداخلية المجانية بتنتهي خلال 48 ساعة!\n\n🎁 هديتك من رش بانتظارك!\n\n🚘 زرنا واستمتع بالتنظيف الداخلي مجاناً قبل انتهاء العرض.",
    "buttons": [
      "زيارة الفرع"
    ]
  },
  {
    "id": "freewash_redemption_reminder",
    "name": "freewash_redemption_reminder",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "يا هلا! ⏰🚗\nباقي 48 ساعة بس على كود FIRSTWASH!\nمر رش واش وعط موترك لمعة وحماية النانو + تنظيف داخلي مجاناً. ✨",
    "buttons": [
      "توجّه للفرع الآن"
    ]
  },
  {
    "id": "national_day_offer_summary",
    "name": "national_day_offer_summary",
    "language": "ar",
    "category": "marketing",
    "status": "APPROVED",
    "body": "عزيزي العميل،\n\nشكراً لاختيارك رش واش عبر عرض اليوم الوطني لسيارتك ذات اللوحة ({{1}}).\n\nأكملت سيارتك {{2}} غسلات حتى الآن محققاً وفراً قدره {{3}} ريال، وموعد تجديد اشتراكك القادم هو بتاريخ {{4}}.\n\nنسعد دائماً بخدمتك في المسار السريع!\n\nمع خالص التحية،\nرش واش",
    "buttons": []
  },
  {
    "id": "national_day_offer_summary_utility",
    "name": "national_day_offer_summary_utility",
    "language": "ar",
    "category": "utility",
    "status": "APPROVED",
    "body": "عزيزي العميل،\n\nملخص اشتراكك في رش واش للسيارة ذات اللوحة ({{1}}): أكملت {{2}} غسلات حتى الآن بوفر قدره {{3}} ريال، وموعد تجديد اشتراكك القادم هو {{4}}.\n\nمع خالص التحية،\nرش واش",
    "buttons": []
  },
  {
    "id": "no_wash",
    "name": "no_wash",
    "language": "en",
    "category": "utility",
    "status": "APPROVED",
    "body": "Hello {{1}}, this is an update regarding your active subscription with Rush. Your plan includes unlimited washes, valid through {{2}} , 2026",
    "buttons": [
      "Opt Out"
    ]
  },
  {
    "id": "otp",
    "name": "otp",
    "language": "en",
    "category": "authentication",
    "status": "APPROVED",
    "body": "*{{1}}* is your verification code. For your security, do not share this code.",
    "buttons": [
      "Copy code"
    ]
  },
  {
    "id": "payment_failed_b",
    "name": "payment_failed_b",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "💳 اشتراكك في رش يحتاج خطوة بسيطة!\n\nتعذّر سحب رسوم التجديد من بطاقتك.\n\n⚡ حدّث بيانات الدفع الآن وخلّ اشتراكك يستمر بدون انقطاع!",
    "buttons": [
      "حدّث الدفع"
    ]
  },
  {
    "id": "redemption_reminder_b",
    "name": "redemption_reminder_b",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "هلا والله! 🚗✨\nودّك بحماية ولمعة نانو لموترك مجاناً؟\nباقي 48 ساعة وينتهي كودك FIRSTWASH في رش واش (+ تنظيف داخلي كامل). مرنا اليوم!",
    "buttons": [
      "توجّه للفرع الآن"
    ]
  },
  {
    "id": "renewal_payment_failed_ar",
    "name": "renewal_payment_failed_ar",
    "language": "ar",
    "category": "utility",
    "status": "APPROVED",
    "body": "مرحباً {{1}}،\n\nلم نتمكن من إتمام تجديد اشتراكك في رش واش.\n\nالباقة: {{2}}\nالمركبة: {{3}}\nالمبلغ: {{4}} ريال\n\nيرجى تحديث وسيلة الدفع قبل {{5}} عبر الزر أدناه.\n\nنحن هنا لمساعدتك، ما عليك سوى الرد على هذه الرسالة.\n\nرش واش",
    "buttons": [
      "تحديث وسيلة الدفع"
    ]
  },
  {
    "id": "renewal_reminder_a",
    "name": "renewal_reminder_a",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "💰 وفّرت{{1}} ريال مع رش!\n\n🚘✨ غسلت سيارتك{{2}} مرات هذا الشهر، ودفعت أقل لأن اشتراكك غير محدود!\n\n⚡ اشتراكك يتجدد تلقائياً بعد 5 أيام.. ووفّر أكثر مع كل غسلة!",
    "buttons": []
  },
  {
    "id": "tailscale_unreachable",
    "name": "tailscale_unreachable",
    "language": "en",
    "category": "utility",
    "status": "APPROVED",
    "body": "Service alert for your account: the {{1}} connection is currently unreachable as of {{2}}. Please check the status and take action to restore access.",
    "buttons": []
  },
  {
    "id": "usage_nudge_a",
    "name": "usage_nudge_a",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "🚘 سيارتك نظيفة على طول مع رش!\n\n✨ اشتراكك يمنحك غسيل غير محدود، يعني تقدر تزورنا وقت ما تحب، بدون أي تكلفة إضافية!\n\n❤️ ننتظرك في رش!",
    "buttons": [
      "زيارة الموقع"
    ]
  },
  {
    "id": "usage_nudge_b",
    "name": "usage_nudge_b",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "⚡ جدولك زحمة؟ اللمعة ما تعطلك!\n\n🚘✨ مع رش، غسيل غير محدود خلال دقائق وبدون تكلفة إضافية!\n\nمرّ علينا وكمّل مشاويرك بلمعة!",
    "buttons": [
      "زيارة الفرع"
    ]
  },
  {
    "id": "wash_reminder",
    "name": "wash_reminder",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "عزيزي المشترك، سيارتك تستاهل تلمع دايمًا! اشتراكك في رش واش لا محدود. مرّ علينا اليوم واستمتع بغسيل سريع خلال دقائق. نسعد بزيارتك.",
    "buttons": []
  },
  {
    "id": "winback_25",
    "name": "winback_25",
    "language": "ar",
    "category": "marketing",
    "status": "APPROVED",
    "body": "فقدت اللمعة؟\n\nرجّع اشتراكك في رش وخذ خصم 25% شهريًا لمدة 6 أشهر.\n\nاستخدم كود الخصم: {{1}}\nوفعّل اشتراكك من موقعنا rush.com.sa أو زُر مسار المبيعات.",
    "buttons": [
      "لإعادة الاشتراك"
    ]
  },
  {
    "id": "winback_rain_25",
    "name": "winback_rain_25",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "🌧️ جدّد اشتراكك بخصم 25% ولا تشيل هم المطر!\n\n🚘 غسيل لا محدود خلال دقائق، مسار سريع ولمعة مستمرة!\n\n⚡ الخصم لمدة 3 أشهر.. ارجع لرش اليوم!",
    "buttons": [
      "ارجع لرش اليوم!"
    ]
  },
  {
    "id": "winback_winter_b",
    "name": "winback_winter_b",
    "language": "en",
    "category": "marketing",
    "status": "APPROVED",
    "body": "❄️ جدّد اشتراكك واستعد للشتاء، بأسعار تبدأ من 112 ريال!\n\n🚘 غسيل لا محدود خلال دقائق، مسار سريع ولمعة مستمرة!\n\n⚡ الخصم لمدة 3 أشهر.. ارجع لرش اليوم!",
    "buttons": [
      "ارجع لرش اليوم!"
    ]
  }
];

export const TEMPLATE_MAP: Record<string, WhatsAppTemplateItem> = Object.fromEntries(
  TEMPLATE_CATALOG.map((t) => [t.id, t])
);

export const getTemplateById = (id: string | null | undefined): WhatsAppTemplateItem | undefined => {
  if (!id) return undefined;
  return TEMPLATE_MAP[id];
};
