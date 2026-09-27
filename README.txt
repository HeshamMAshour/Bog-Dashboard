Operations Dashboard - Render Ready
===================================

الخصائص
-------
- Dashboard عربي تفاعلي.
- البيانات تُقرأ من data.xlsx.
- زر "رفع Excel جديد" داخل الصفحة.
- بعد الرفع تتحدث جميع المؤشرات والرسوم تلقائيًا.
- API Health Check مناسب لـ Render.
- المنفذ يعتمد على process.env.PORT تلقائيًا.

رفع المشروع على Render
----------------------
الطريقة المقترحة:
1. فك ضغط المشروع.
2. ارفع الملفات إلى GitHub Repository جديد.
3. في Render اختر:
   New + > Blueprint
   ثم اختر الـ Repository.
4. Render سيقرأ render.yaml ويجهز الخدمة.
5. بعد انتهاء الـ Deploy افتح رابط الخدمة.

بديلًا:
- New + > Web Service
- Build Command: npm install
- Start Command: npm start

تحديث البيانات بعد النشر
------------------------
من داخل الـ Dashboard اضغط:
"رفع Excel جديد"
ثم اختر ملف .xlsx من جهازك.

الأعمدة المطلوبة:
ID
Work Item Type
Title
State
Tags
Done Date
Cost

مهم بخصوص Render Free
----------------------
نظام الملفات في الخدمات العادية قد يكون مؤقتًا.
هذا يعني أن ملف Excel المرفوع من الصفحة قد يعود للنسخة الأصلية عند Restart أو Redeploy للخدمة.

للاحتفاظ بآخر Excel بشكل دائم:
1. استخدم Render Persistent Disk.
2. Mount Path مثال:
   /var/data
3. أضف Environment Variable:
   DATA_FILE_PATH=/var/data/data.xlsx

الكود يدعم ذلك تلقائيًا، وإذا كان الملف غير موجود في الـ Disk أول مرة
سيتم نسخ data.xlsx الأصلي إليه.

تشغيل محلي
----------
npm install
npm start

ثم:
http://localhost:3000
