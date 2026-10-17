
let installPrompt = null;

const installBtn = document.getElementById("installBtn");
const testStatus = document.getElementById("testStatus");

// عنوان وسيط الاتصال الذي اختبرناه بنجاح
const API_URL = "https://4print-api.m01099842700.workers.dev/";

// تسجيل Service Worker
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js");

      if (testStatus) {
        testStatus.textContent =
          "نجح تسجيل Service Worker. جارٍ اختبار الاتصال بالخامات...";
      }
    } catch (error) {
      if (testStatus) {
        testStatus.textContent =
          "تعذر تسجيل Service Worker: " + error.message;
      }
    }

    await loadProducts();
  });
} else {
  if (testStatus) {
    testStatus.textContent =
      "افتح الصفحة من رابط HTTPS لاختبار خصائص PWA.";
  }
}

// جلب الخامات الفعلية من Google Sheets عبر Cloudflare
async function loadProducts() {
  if (!testStatus) return;

  try {
    testStatus.textContent = "جارٍ تحميل الخامات من النظام...";

    const response = await fetch(API_URL, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("رمز الاستجابة: " + response.status);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.products)) {
      throw new Error(data.error || "بيانات الخامات غير صحيحة");
    }

    window.fourPrintProducts = data.products;

    testStatus.textContent =
      "نجح الاتصال بالنظام. عدد الخامات المحمّلة: " +
      data.products.length;

    console.log("خامات 4Print:", data.products);

    // عرض الخامات يحتاج إلى ربطها بعناصر واجهة HTML المناسبة.
  } catch (error) {
    testStatus.textContent =
      "تعذر تحميل الخامات: " + error.message;

    console.error("خطأ تحميل خامات 4Print:", error);
  }
}

// تثبيت التطبيق
if (installBtn) {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    installBtn.classList.remove("hidden");
  });

  installBtn.addEventListener("click", async () => {
    if (!installPrompt) {
      alert(
        "على آيفون: افتح الصفحة في Safari ثم اضغط مشاركة، وبعدها إضافة إلى الشاشة الرئيسية. على أندرويد استخدم قائمة المتصفح ثم تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية."
      );
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installBtn.classList.add("hidden");
  });
}

// الرسائل التوضيحية الحالية
const bookingInfo = document.getElementById("bookingInfo");
if (bookingInfo) {
  bookingInfo.addEventListener("click", () => {
    alert(
      "سيتم تفعيل الحجز بعد استكمال ربط نموذج الطلب والتحقق من البيانات."
    );
  });
}

const paymentInfo = document.getElementById("paymentInfo");
if (paymentInfo) {
  paymentInfo.addEventListener("click", () => {
    alert(
      "أي سداد موجب بعد اعتماده يحجز الكمية كاملة، لكن تأكيد الاستلام لا يتم إلا بعد اعتماد كامل المبلغ."
    );
  });
}

const dataInfo = document.getElementById("dataInfo");
if (dataInfo) {
  dataInfo.addEventListener("click", () => {
    alert(
      "تُحمّل بيانات الخامات من النظام الفعلي. لم يتم تفعيل إرسال الطلبات أو بيانات الطلاب بعد."
    );
  });
}
