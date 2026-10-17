
let installPrompt = null;

const API_URL = "https://4print-api.m01099842700.workers.dev/";

const installBtn = document.getElementById("installBtn");
const testStatus = document.getElementById("testStatus");
const productsStatus = document.getElementById("productsStatus");
const productsList = document.getElementById("productsList");
const connectionNotice = document.getElementById("connectionNotice");
const selectedCount = document.getElementById("selectedCount");
const orderTotal = document.getElementById("orderTotal");

let products = [];
const quantities = Object.create(null);

function formatMoney(value) {
  return Number(value).toLocaleString("ar-EG", {
    maximumFractionDigits: 2
  });
}

function updateSummary() {
  let count = 0;
  let total = 0;

  products.forEach(product => {
    const quantity = quantities[product.code] || 0;
    if (quantity > 0) {
      count++;
      total += quantity * Number(product.price || 0);
    }
  });

  selectedCount.textContent = count;
  orderTotal.textContent = formatMoney(total);
}

function renderProducts() {
  productsList.replaceChildren();

  if (!products.length) {
    productsStatus.textContent = "لا توجد خامات لعرضها حاليًا.";
    return;
  }

  products.forEach(product => {
    const card = document.createElement("article");
    card.className = "tile";
    card.style.marginBottom = "12px";

    const name = document.createElement("h3");
    name.textContent = product.name || "خامة دون اسم";

    const code = document.createElement("p");
    code.textContent = "كود الخامة: " + (product.code || "—");

    const price = document.createElement("p");
    price.textContent = "السعر: " + formatMoney(product.price) + " جنيه";

    const unit = document.createElement("p");
    unit.textContent = "الوحدة: " + (product.unit || "—");

    const stock = Math.max(0, Number(product.stock) || 0);
    const stockText = document.createElement("p");
    stockText.textContent = "الكمية المتاحة: " + stock;

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "12px";
    controls.style.flexWrap = "wrap";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "secondary";
    minus.textContent = "−";
    minus.setAttribute("aria-label", "تقليل كمية " + product.name);

    const quantityText = document.createElement("strong");
    quantityText.textContent = quantities[product.code] || 0;
    quantityText.style.minWidth = "24px";
    quantityText.style.textAlign = "center";

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "secondary";
    plus.textContent = "+";
    plus.setAttribute("aria-label", "زيادة كمية " + product.name);
    plus.disabled = stock <= 0;

    minus.disabled = !(quantities[product.code] > 0);

    minus.addEventListener("click", () => {
      quantities[product.code] = Math.max(
        0,
        (quantities[product.code] || 0) - 1
      );
      renderProducts();
      updateSummary();
    });

    plus.addEventListener("click", () => {
      const current = quantities[product.code] || 0;

      if (current < stock) {
        quantities[product.code] = current + 1;
        renderProducts();
        updateSummary();
      }
    });

    controls.append(minus, quantityText, plus);

    card.append(name, code, price, unit, stockText, controls);
    productsList.appendChild(card);
  });

  productsStatus.textContent =
    "تم تحميل " + products.length + " خامة بنجاح.";
}

async function loadProducts() {
  productsStatus.textContent = "جارٍ تحميل الخامات...";
  connectionNotice.textContent = "جارٍ الاتصال بنظام الخامات...";

  try {
    const response = await fetch(API_URL, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("رمز الاستجابة " + response.status);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.products)) {
      throw new Error(data.error || "استجابة غير صحيحة من النظام");
    }

    products = data.products;
    window.fourPrintProducts = products;

    renderProducts();
    updateSummary();

    connectionNotice.textContent =
      "تم الاتصال بالنظام بنجاح وتحميل " + products.length + " خامة.";

    if (testStatus) {
      testStatus.textContent =
        "نجح الاتصال بالنظام. عدد الخامات المحمّلة: " +
        products.length;
    }
  } catch (error) {
    productsStatus.textContent =
      "تعذر تحميل الخامات: " + error.message;

    connectionNotice.textContent =
      "تعذر الاتصال بنظام الخامات. حدّث الصفحة وحاول مرة أخرى.";

    if (testStatus) {
      testStatus.textContent =
        "فشل تحميل الخامات: " + error.message;
    }

    console.error("خطأ تحميل خامات 4Print:", error);
  }
}

// تسجيل التطبيق القابل للتثبيت
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js");

      if (testStatus) {
        testStatus.textContent = "تم تسجيل Service Worker. جارٍ تحميل الخامات...";
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
    testStatus.textContent = "افتح الصفحة من رابط HTTPS.";
  }
  loadProducts();
}

if (installBtn) {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    installBtn.classList.remove("hidden");
  });

  installBtn.addEventListener("click", async () => {
    if (!installPrompt) {
      alert("افتح قائمة المتصفح واختر إضافة إلى الشاشة الرئيسية أو تثبيت التطبيق.");
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installBtn.classList.add("hidden");
  });
}

const paymentInfo = document.getElementById("paymentInfo");
if (paymentInfo) {
  paymentInfo.addEventListener("click", () => {
    alert("أي سداد موجب بعد اعتماده يحجز الكمية كاملة، والاستلام لا يُؤكّد إلا بعد اعتماد كامل المبلغ.");
  });
}

const dataInfo = document.getElementById("dataInfo");
if (dataInfo) {
  dataInfo.addEventListener("click", () => {
    alert("تُحمّل الخامات من النظام الفعلي. اختيار الكميات الحالي تجريبي ولا يسجل طلبًا في قاعدة البيانات.");
  });
}

const bookingForm = document.getElementById("bookingForm");
const bookingStatus = document.getElementById("bookingStatus");
const submitOrderBtn = document.getElementById("submitOrderBtn");

if (bookingForm) {
  bookingForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const name = document.getElementById("studentName").value.trim();
    const phone = document.getElementById("studentPhone").value.trim();

    const items = products
      .filter(product => (quantities[product.code] || 0) > 0)
      .map(product => ({
        code: product.code,
        quantity: quantities[product.code]
      }));

    if (items.length === 0) {
      bookingStatus.textContent = "يرجى اختيار خامة واحدة على الأقل.";
      return;
    }

    if (!bookingForm.reportValidity()) return;

    if (!confirm("هل تريد إرسال طلب الحجز؟")) return;

    submitOrderBtn.disabled = true;
    bookingStatus.textContent = "جارٍ إرسال طلب الحجز...";

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, phone, items })
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "تعذر تسجيل الحجز.");
      }

      bookingStatus.textContent =
        "تم تسجيل الحجز بنجاح. رقم الطلب: " +
        result.orderId +
        " — الإجمالي: " +
        formatMoney(result.total) +
        " جنيه.";

      bookingForm.reset();

      Object.keys(quantities).forEach(code => {
        quantities[code] = 0;
      });

      renderProducts();
      updateSummary();

    } catch (error) {
      bookingStatus.textContent =
        "لم نتأكد من تسجيل الطلب: " + error.message +
        " يُرجى التحقق من النظام قبل إعادة الإرسال.";
    } finally {
      submitOrderBtn.disabled = false;
    }
  });
}
