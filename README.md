# سوالف — Saudi English Voice Showcase

نسخة عرض محلية لمحادثة قصيرة تساعد المتعلم السعودي على طلب القهوة بالإنجليزية، مع صوت ElevenLabs يولَّد من الخادم ومسارات صوت احتياطية عند تعذر الخدمة.

## المتطلبات

- Node.js 22.13 أو أحدث
- npm
- Git

## التشغيل على جهاز جديد

```bash
git clone https://github.com/nejmaldeen/suadi-inglish.git
cd suadi-inglish
npm install
```

أنشئ ملفًا باسم `.env.local` في جذر المشروع اعتمادًا على `.env.example`، ثم أضف القيم يدويًا:

```dotenv
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=t9akNmCDhz230CEXOYmn
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
```

بعد إضافة مفتاح ElevenLabs شغّل المشروع:

```bash
npm run dev
```

افتح العنوان المحلي الذي يظهر في نافذة الأوامر، ثم اضغط زر المايك لتشغيل تسلسل العرض.

> ملف `.env.local` سري ولا يُرفع إلى GitHub. يجب إنشاؤه يدويًا على كل جهاز جديد، ولا ينبغي وضع مفتاح ElevenLabs داخل ملفات TypeScript أو JavaScript أو مجلد `public`.

## مسار الصوت

عند وصول العرض إلى حالة `speaking` ترسل الواجهة `scriptId` ثابتًا إلى `POST /api/tts`. يتصل الخادم بـElevenLabs ويعيد ملف MP3، مع cache داخل الذاكرة لتجنب تكرار الاستهلاك أثناء تشغيل الخادم. عند فشل الخدمة ينتقل التطبيق إلى ملف الصوت المحلي، ثم `speechSynthesis`، ثم المؤقت الاحتياطي.

## التحقق

```bash
npm exec -- tsc --noEmit
npm run lint
npm test
npm run build
```

سكربتات `lint` و`build` تستخدم Bash لأنها جزء من بيئة Vinext/Cloudflare Sites.
