let installPrompt = null;
const installBtn = document.getElementById("installBtn");
const testStatus = document.getElementById("testStatus");

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js");
      testStatus.textContent = "نجح تسجيل Service Worker. ملفات الواجهة قابلة للتخزين المؤقت.";
    } catch (error) {
      testStatus.textContent = "تعذر تسجيل Service Worker: " + error.message;
    }
  });
} else {
  testStatus.textContent = "افتح الصفحة من رابط HTTPS لاختبار خصائص PWA.";
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  installBtn.classList.remove("hidden");
});

installBtn.addEventListener("click", async () => {
  if (!installPrompt) {
    alert("على آيفون: افتح الصفحة في Safari ثم اضغط مشاركة، وبعدها «إضافة إلى الشاشة الرئيسية». على أندرويد استخدم قائمة المتصفح ثم «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».");
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.classList.add("hidden");
});

document.getElementById("bookingInfo").addEventListener("click", () => {
  alert("هذه نسخة اختبار للواجهة. سنفعّل الحجز بعد اختبار طبقة الربط مع Google Apps Script.");
});
document.getElementById("paymentInfo").addEventListener("click", () => {
  alert("القاعدة المعتمدة: أي سداد موجب بعد اعتماده يحجز الكمية كاملة، لكن الاستلام لا يُؤكّد إلا بعد اعتماد كامل المبلغ.");
});
document.getElementById("dataInfo").addEventListener("click", () => {
  alert("هذه الواجهة التجريبية لا تتصل بملف Google Sheets ولا تقرأ بيانات الطلاب.");
});
