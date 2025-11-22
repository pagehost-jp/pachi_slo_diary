// ========================================
// pachi_slo_diary - Main Script
// ========================================

// ========== Firebase設定 ==========
const firebaseConfig = {
  apiKey: "AIzaSyCBTih30LehJfHvuF9x8TLUsNKIPBAqhAE",
  authDomain: "pachi-slo-diary.firebaseapp.com",
  projectId: "pachi-slo-diary",
  storageBucket: "pachi-slo-diary.firebasestorage.app",
  messagingSenderId: "1040619476876",
  appId: "1:1040619476876:web:be1a167e4fe777f92d28a9"
};

// Firebase初期化
let firebaseApp = null;
let auth = null;
let firestoreDb = null;
let currentUser = null;

function initFirebase() {
  if (firebaseConfig.apiKey === "YOUR_API_KEY") {
    console.log('Firebase未設定 - クラウド同期は無効');
    return false;
  }
  try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    firestoreDb = firebase.firestore();

    // 認証状態の監視
    auth.onAuthStateChanged(handleAuthStateChanged);
    return true;
  } catch (error) {
    console.error('Firebase初期化エラー:', error);
    return false;
  }
}

// 認証状態変更ハンドラ
async function handleAuthStateChanged(user) {
  currentUser = user;
  updateUserUI();

  if (user) {
    // ログイン時：クラウドからデータを同期
    await syncFromCloud();
  }
}

// UI更新
function updateUserUI() {
  const userBtn = document.getElementById('btn-user');
  const userName = document.getElementById('user-name');
  const loginBtn = document.getElementById('btn-google-login');
  const logoutBtn = document.getElementById('btn-logout');
  const syncText = document.getElementById('sync-text');
  const syncIcon = document.querySelector('.sync-icon');

  if (currentUser) {
    userBtn.classList.add('logged-in');
    userName.textContent = currentUser.displayName?.split(' ')[0] || 'ユーザー';
    document.querySelector('.user-icon').textContent = '✓';
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'block';
    if (syncText) {
      syncText.textContent = '同期済み';
      syncText.classList.add('synced');
    }
    if (syncIcon) syncIcon.textContent = '✅';
  } else {
    userBtn.classList.remove('logged-in');
    userName.textContent = 'ログイン';
    document.querySelector('.user-icon').textContent = '👤';
    if (loginBtn) loginBtn.style.display = 'block';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (syncText) {
      syncText.textContent = '未ログイン';
      syncText.classList.remove('synced');
    }
    if (syncIcon) syncIcon.textContent = '☁️';
  }
}

// Googleログイン
async function loginWithGoogle() {
  if (!auth) {
    alert('Firebase未設定です。設定を確認してください。');
    return;
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (error) {
    console.error('ログインエラー:', error);
    if (error.code === 'auth/popup-closed-by-user') {
      // ユーザーがポップアップを閉じた - 何もしない
    } else {
      alert('ログインに失敗しました: ' + error.message);
    }
  }
}

// ログアウト
async function logout() {
  if (!auth) return;
  try {
    await auth.signOut();
  } catch (error) {
    console.error('ログアウトエラー:', error);
  }
}

// クラウドからデータを同期
async function syncFromCloud() {
  if (!currentUser || !firestoreDb) return;

  try {
    const snapshot = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .get();

    if (snapshot.empty) {
      // クラウドにデータがない場合、ローカルからアップロード
      await syncToCloud();
      return;
    }

    // クラウドのデータをローカルに保存
    for (const doc of snapshot.docs) {
      const cloudEntry = doc.data();
      cloudEntry.cloudId = doc.id;

      // ローカルに同じ日付のエントリーがあるかチェック
      const localEntries = await getEntriesByMonth(cloudEntry.year, cloudEntry.month);
      const existingEntry = localEntries.find(e => e.day === cloudEntry.day);

      if (existingEntry) {
        // 更新日時で比較して新しい方を採用
        const cloudUpdated = cloudEntry.updatedAt?.toDate?.() || new Date(0);
        const localUpdated = existingEntry.updatedAt ? new Date(existingEntry.updatedAt) : new Date(0);

        if (cloudUpdated > localUpdated) {
          cloudEntry.id = existingEntry.id;
          await saveEntry(cloudEntry, false); // クラウド同期なしで保存
        }
      } else {
        await saveEntry(cloudEntry, false);
      }
    }

    console.log('クラウドからの同期完了');
    // 画面を更新
    loadMonthlyData();
  } catch (error) {
    console.error('クラウド同期エラー:', error);
  }
}

// クラウドへデータを同期
async function syncToCloud() {
  if (!currentUser || !firestoreDb) return;

  try {
    const entries = await getAllEntries();
    const batch = firestoreDb.batch();
    const userEntriesRef = firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries');

    for (const entry of entries) {
      // 画像はサイズが大きいのでクラウドに保存しない
      const cloudEntry = { ...entry };
      delete cloudEntry.images;
      delete cloudEntry.id;
      cloudEntry.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

      // ドキュメントIDは日付ベースで一意に
      const docId = `${entry.year}-${String(entry.month).padStart(2, '0')}-${String(entry.day).padStart(2, '0')}`;
      const docRef = userEntriesRef.doc(docId);
      batch.set(docRef, cloudEntry, { merge: true });
    }

    await batch.commit();
    console.log('クラウドへの同期完了');
  } catch (error) {
    console.error('クラウドアップロードエラー:', error);
  }
}

// 単一エントリーをクラウドに保存
async function saveEntryToCloud(entry) {
  if (!currentUser || !firestoreDb) return;

  try {
    const cloudEntry = { ...entry };
    delete cloudEntry.images;
    delete cloudEntry.id;
    cloudEntry.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

    const docId = `${entry.year}-${String(entry.month).padStart(2, '0')}-${String(entry.day).padStart(2, '0')}`;

    await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .doc(docId)
      .set(cloudEntry, { merge: true });
  } catch (error) {
    console.error('クラウド保存エラー:', error);
  }
}

// クラウドからエントリーを削除
async function deleteEntryFromCloud(entry) {
  if (!currentUser || !firestoreDb) return;

  try {
    const docId = `${entry.year}-${String(entry.month).padStart(2, '0')}-${String(entry.day).padStart(2, '0')}`;

    await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .doc(docId)
      .delete();
  } catch (error) {
    console.error('クラウド削除エラー:', error);
  }
}

// APIキー管理
let geminiApiKey = localStorage.getItem('gemini_api_key') || '';

// IndexedDB設定
const DB_NAME = 'pachiSloDiary';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

let db = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let showAllMonths = false;
let currentEntryId = null;
let uploadedImages = [];
let currentOcrData = null;

// ========== IndexedDB初期化 ==========
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('yearMonth', 'yearMonth', { unique: false });
        store.createIndex('year', 'year', { unique: false });
      }
    };
  });
}

// ========== データ操作 ==========
async function saveEntry(entry, syncCloud = true) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // インデックス用
    entry.yearMonth = `${entry.year}-${String(entry.month).padStart(2, '0')}`;
    entry.updatedAt = new Date().toISOString();

    const request = entry.id ? store.put(entry) : store.add(entry);
    request.onsuccess = async () => {
      // クラウド同期
      if (syncCloud && currentUser) {
        entry.id = request.result;
        await saveEntryToCloud(entry);
      }
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getEntry(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteEntry(id, entry = null) {
  return new Promise(async (resolve, reject) => {
    // 削除前にエントリー情報を取得（クラウド削除用）
    if (!entry && currentUser) {
      entry = await getEntry(id);
    }

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = async () => {
      // クラウドからも削除
      if (entry && currentUser) {
        await deleteEntryFromCloud(entry);
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

async function getEntriesByMonth(year, month) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('yearMonth');
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    const request = index.getAll(yearMonth);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getEntriesByYear(year) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = request.result.filter(e => e.year === year);
      resolve(entries);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getAllEntries() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ========== 画面表示 ==========
function showMonthlyView() {
  document.getElementById('monthly-view').style.display = 'block';
  document.getElementById('entry-view').style.display = 'none';
  updateYearDisplay();
  updateMonthButtons();
  loadMonthlyData();
}

function showEntryView(entryId = null) {
  document.getElementById('monthly-view').style.display = 'none';
  document.getElementById('entry-view').style.display = 'block';

  currentEntryId = entryId;
  uploadedImages = [];

  if (entryId) {
    loadEntry(entryId);
  } else {
    clearEntryForm();
    const today = new Date();
    document.getElementById('entry-date').textContent =
      `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    document.getElementById('date-input').value = today.toISOString().slice(0, 10);
  }
}

function updateYearDisplay() {
  document.getElementById('current-year').textContent = `${currentYear}年度`;
}

async function updateMonthButtons() {
  const yearEntries = await getEntriesByYear(currentYear);

  // 月ごとのエントリー数をカウント
  const monthCounts = {};
  let totalCount = 0;
  yearEntries.forEach(entry => {
    monthCounts[entry.month] = (monthCounts[entry.month] || 0) + 1;
    totalCount++;
  });

  // 月ボタンを更新
  const monthButtons = document.querySelectorAll('.month-btn');
  monthButtons.forEach(btn => {
    const month = btn.dataset.month;

    // 既存のバッジを削除
    const existingBadge = btn.querySelector('.badge');
    if (existingBadge) existingBadge.remove();

    // activeクラスを更新
    btn.classList.remove('active');

    if (month === 'all') {
      if (showAllMonths) btn.classList.add('active');
      if (totalCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = totalCount;
        btn.appendChild(badge);
      }
    } else {
      const monthNum = parseInt(month);
      if (!showAllMonths && monthNum === currentMonth) btn.classList.add('active');
      if (monthCounts[monthNum]) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = monthCounts[monthNum];
        btn.appendChild(badge);
      }
    }
  });
}

async function loadMonthlyData() {
  let entries;

  if (showAllMonths) {
    entries = await getEntriesByYear(currentYear);
  } else {
    entries = await getEntriesByMonth(currentYear, currentMonth);
  }

  const dailyList = document.getElementById('daily-list');
  const emptyMessage = document.getElementById('empty-message');

  // 既存のアイテムをクリア（empty-message以外）
  const items = dailyList.querySelectorAll('.daily-item');
  items.forEach(item => item.remove());

  if (entries.length === 0) {
    emptyMessage.style.display = 'block';
    document.getElementById('total-days').textContent = '0日';
    document.getElementById('monthly-total').textContent = '¥0';
    document.getElementById('monthly-total').className = 'summary-value';
    return;
  }

  emptyMessage.style.display = 'none';

  // 日付でソート（降順）
  entries.sort((a, b) => {
    if (a.month !== b.month) return b.month - a.month;
    return b.day - a.day;
  });

  let totalBalance = 0;

  entries.forEach(entry => {
    const balance = (entry.out || 0) - (entry.in || 0);
    totalBalance += balance;

    const item = document.createElement('div');
    item.className = 'daily-item';
    item.onclick = () => showEntryView(entry.id);

    const thumbSrc = entry.images && entry.images.length > 0
      ? entry.images[0]
      : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%230f3460" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23a0a0a0" font-size="12">No Image</text></svg>';

    item.innerHTML = `
      <img class="daily-thumb" src="${thumbSrc}" alt="">
      <div class="daily-info">
        <p class="daily-date">${entry.month}/${entry.day}</p>
        <p class="daily-machine">${entry.machine || '未入力'}</p>
      </div>
      <span class="daily-balance ${balance >= 0 ? 'profit' : 'loss'}">
        ${balance >= 0 ? '+' : ''}${balance.toLocaleString()}円
      </span>
    `;

    dailyList.insertBefore(item, emptyMessage);
  });

  // サマリー更新
  document.getElementById('total-days').textContent = `${entries.length}日`;
  const totalEl = document.getElementById('monthly-total');
  totalEl.textContent = `${totalBalance >= 0 ? '+' : ''}¥${totalBalance.toLocaleString()}`;
  totalEl.className = `summary-value ${totalBalance >= 0 ? 'profit' : 'loss'}`;

  // カレンダーも更新
  renderCalendar(entries);
}

// カレンダー表示
function renderCalendar(entries) {
  if (showAllMonths) {
    document.getElementById('calendar-view').style.display = 'none';
    document.querySelector('.view-toggle').style.display = 'none';
    return;
  }
  document.querySelector('.view-toggle').style.display = 'flex';

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // 月の日数と最初の曜日を取得
  const firstDay = new Date(currentYear, currentMonth - 1, 1);
  const lastDay = new Date(currentYear, currentMonth, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  // エントリーを日付でマップ
  const entryMap = {};
  entries.forEach(entry => {
    if (entry.month === currentMonth) {
      entryMap[entry.day] = entry;
    }
  });

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() + 1 === currentMonth;

  // 空白セルを追加
  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day empty';
    grid.appendChild(emptyCell);
  }

  // 日付セルを追加
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';

    const entry = entryMap[day];
    if (entry) {
      const balance = (entry.out || 0) - (entry.in || 0);
      cell.classList.add('has-entry');
      cell.classList.add(balance >= 0 ? 'profit' : 'loss');
      cell.innerHTML = `
        <span class="day-number">${day}</span>
        <span class="day-balance ${balance >= 0 ? 'profit' : 'loss'}">${balance >= 0 ? '+' : ''}${(balance / 1000).toFixed(0)}k</span>
      `;
      cell.onclick = () => showEntryView(entry.id);
    } else {
      cell.innerHTML = `<span class="day-number">${day}</span>`;
      cell.onclick = () => openEntryForDate(currentYear, currentMonth, day);
    }

    if (isCurrentMonth && day === today.getDate()) {
      cell.classList.add('today');
    }

    grid.appendChild(cell);
  }
}

// 特定の日付でエントリーを開く
async function openEntryForDate(year, month, day) {
  const entries = await getEntriesByMonth(year, month);
  const existingEntry = entries.find(e => e.day === day);

  if (existingEntry) {
    showEntryView(existingEntry.id);
  } else {
    showEntryView(null);
    // 日付を設定
    document.getElementById('entry-date').textContent = `${year}年${month}月${day}日`;
  }
}

async function loadEntry(id) {
  const entry = await getEntry(id);
  if (!entry) return;

  document.getElementById('entry-date').textContent =
    `${entry.year}年${entry.month}月${entry.day}日`;
  document.getElementById('date-input').value = `${entry.year}-${String(entry.month).padStart(2, '0')}-${String(entry.day).padStart(2, '0')}`;
  document.getElementById('hall-name').value = entry.hall || '';
  document.getElementById('btn-clear-hall').style.display = entry.hall ? 'flex' : 'none';
  document.getElementById('machine-name').value = entry.machine || '';
  document.getElementById('btn-clear-machine').style.display = entry.machine ? 'flex' : 'none';
  document.getElementById('input-in').value = entry.in || '';
  document.getElementById('input-out').value = entry.out || '';
  // 稼働時間（時間と分に分解）
  const hoursUnknown = entry.hoursUnknown || false;
  document.getElementById('hours-unknown').checked = hoursUnknown;
  document.getElementById('input-hours').disabled = hoursUnknown;
  document.getElementById('input-minutes').disabled = hoursUnknown;

  if (!hoursUnknown && entry.hours) {
    const totalMinutes = entry.hours * 60;
    const hours = Math.floor(totalMinutes / 60) || 1;
    const minutes = Math.round((totalMinutes % 60) / 10) * 10;
    document.getElementById('input-hours').value = Math.min(hours, 12);
    document.getElementById('input-minutes').value = minutes;
  } else {
    document.getElementById('input-hours').value = '1';
    document.getElementById('input-minutes').value = '0';
  }
  document.getElementById('memo').value = entry.memo || '';
  document.getElementById('blog-content').value = entry.blog || '';

  if (entry.blog) {
    document.getElementById('blog-output').style.display = 'block';
  }

  // 画像プレビュー（5枠に対応）
  const images = entry.images || [];
  uploadedImages = [null, null, null, null, null];
  images.forEach((img, i) => {
    if (i < 5) uploadedImages[i] = img;
  });
  renderDropZonePreviews();

  // OCRデータを復元
  if (entry.ocrData) {
    currentOcrData = entry.ocrData;
    displayOcrResult(entry.ocrData);
    document.getElementById('btn-ocr').style.display = 'inline-block';
  } else {
    currentOcrData = null;
    document.getElementById('ocr-result').style.display = 'none';
    document.getElementById('btn-ocr').style.display = images.length > 0 ? 'inline-block' : 'none';
  }

  updateBalance();
}

function clearEntryForm() {
  document.getElementById('hall-name').value = '';
  document.getElementById('btn-clear-hall').style.display = 'none';
  document.getElementById('machine-name').value = '';
  document.getElementById('btn-clear-machine').style.display = 'none';
  document.getElementById('input-in').value = '';
  document.getElementById('input-out').value = '';
  document.getElementById('input-hours').value = '1';
  document.getElementById('input-minutes').value = '0';
  document.getElementById('hours-unknown').checked = false;
  document.getElementById('input-hours').disabled = false;
  document.getElementById('input-minutes').disabled = false;
  document.getElementById('memo').value = '';
  document.getElementById('blog-content').value = '';
  document.getElementById('blog-output').style.display = 'none';
  document.getElementById('ocr-result').style.display = 'none';
  document.getElementById('btn-ocr').style.display = 'none';
  uploadedImages = [null, null, null, null, null];
  currentOcrData = null;
  renderDropZonePreviews();
  updateBalance();
}

function updateBalance() {
  const inValue = parseInt(document.getElementById('input-in').value) || 0;
  const outValue = parseInt(document.getElementById('input-out').value) || 0;
  const balance = outValue - inValue;

  const balanceEl = document.getElementById('balance-value');
  balanceEl.textContent = `${balance >= 0 ? '+' : ''}¥${balance.toLocaleString()}`;
  balanceEl.className = `balance-value ${balance >= 0 ? 'profit' : 'loss'}`;

  // 時給計算
  const hoursUnknown = document.getElementById('hours-unknown').checked;
  const hourlyDiv = document.getElementById('balance-hourly');
  const hourlyEl = document.getElementById('hourly-value');

  if (hoursUnknown) {
    hourlyDiv.style.display = 'none';
  } else {
    const hours = (parseInt(document.getElementById('input-hours').value) || 1) + (parseInt(document.getElementById('input-minutes').value) || 0) / 60;
    const hourlyRate = Math.round(balance / hours);
    hourlyEl.textContent = `${hourlyRate >= 0 ? '+' : ''}¥${hourlyRate.toLocaleString()}`;
    hourlyEl.className = `hourly-value ${hourlyRate >= 0 ? 'profit' : 'loss'}`;
    hourlyDiv.style.display = 'block';
  }
}

// ========== 画像処理（ドロップゾーン） ==========
function initDropZones() {
  const mainDropZone = document.getElementById('main-drop-zone');
  const mainInput = document.getElementById('main-drop-input');

  if (!mainDropZone || !mainInput) return;

  // タップでファイル選択
  mainDropZone.addEventListener('click', () => {
    mainInput.click();
  });

  // ファイル選択時（複数対応）
  mainInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  });

  // ドラッグ＆ドロップ
  mainDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    mainDropZone.classList.add('dragover');
  });

  mainDropZone.addEventListener('dragleave', () => {
    mainDropZone.classList.remove('dragover');
  });

  mainDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    mainDropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });
}

function handleFiles(files) {
  const maxImages = 5;
  const currentCount = uploadedImages.filter(img => img).length;
  const availableSlots = maxImages - currentCount;

  Array.from(files).slice(0, availableSlots).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      // 空いているスロットに追加
      const emptyIndex = uploadedImages.findIndex((img, i) => !img);
      if (emptyIndex !== -1) {
        uploadedImages[emptyIndex] = e.target.result;
      } else if (uploadedImages.length < maxImages) {
        uploadedImages.push(e.target.result);
      }
      renderThumbnails();
      autoOcr();
    };
    reader.readAsDataURL(file);
  });
}

// 画像アップロード後に自動OCR
let ocrTimeout = null;
function autoOcr() {
  // 少し待ってから実行（連続アップロード対応）
  if (ocrTimeout) clearTimeout(ocrTimeout);
  ocrTimeout = setTimeout(() => {
    if (getValidImages().length > 0) {
      performOcr();
    }
  }, 500);
}

function renderThumbnails() {
  const container = document.getElementById('uploaded-thumbnails');
  if (!container) return;

  container.innerHTML = '';

  uploadedImages.forEach((img, index) => {
    if (!img) return;

    const thumbItem = document.createElement('div');
    thumbItem.className = 'thumb-item';
    thumbItem.innerHTML = `
      <img src="${img}" alt="画像${index + 1}">
      <button class="thumb-remove" data-index="${index}">×</button>
    `;
    container.appendChild(thumbItem);
  });

  // 削除ボタンのイベント
  container.querySelectorAll('.thumb-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      removeImage(index);
    });
  });
}

function removeImage(index) {
  uploadedImages[index] = null;
  // 配列を詰める
  uploadedImages = uploadedImages.filter(img => img);
  renderThumbnails();
}

function renderDropZonePreviews() {
  // 新しい構造に対応
  renderThumbnails();
}

function getValidImages() {
  return uploadedImages.filter(img => img !== null && img !== undefined);
}

function updateOcrButtonState() {
  const btn = document.getElementById('btn-ocr');
  const hasImages = getValidImages().length > 0;
  btn.disabled = !hasImages;
  btn.style.opacity = hasImages ? '1' : '0.4';
  btn.style.cursor = hasImages ? 'pointer' : 'not-allowed';
}

// ========== Gemini API直接呼び出し ==========
async function callGeminiAPI(prompt, images = []) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

  const parts = [{ text: prompt }];

  for (const img of images) {
    const base64Data = img.includes(',') ? img.split(',')[1] : img;
    const mimeType = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: base64Data
      }
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'API呼び出し失敗');
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// ========== OCR機能 ==========
async function performOcr() {
  const validImages = getValidImages();
  if (validImages.length === 0) return;

  const btn = document.getElementById('btn-ocr');
  const statusDiv = document.getElementById('ocr-status');

  // ローディング表示
  statusDiv.style.display = 'block';
  btn.style.display = 'none';

  try {
    if (!geminiApiKey) {
      alert('設定からGemini APIキーを入力してください');
      openSettings();
      statusDiv.style.display = 'none';
      return;
    }

    const prompt = `この画像はパチスロの実戦データ（Qマイスロなど）のスクリーンショットです。
ディスクアップ2またはウルトラリミックスのデータを読み取ってください。

【重要】複数枚の画像がある場合、同じデータが重複している可能性があります。
重複している場合は無視して、ユニークなデータのみを読み取ってください。

読み取るデータ（この9項目）:
- game_count: ゲーム数（数値のみ）
- bb_probability: 総BB確率（例: "1/181.58"）
- rb_probability: RB確率（例: "1/317.75"）
- skill_true_rate: NORMAL-BB中真・技術介入成功率（例: "100.0%"）
- skill_extreme_rate: NORMAL-BB中極・技術介入成功率（例: "33.4%"）
- dance_time_count: DANCE TIME突入回数（数値のみ）
- suika_probability: スイカ確率（例: "1/52.96"）
- cherry_probability: チェリー確率（例: "1/36.32"）
- common_10mai_probability: AT中共通10枚確率（例: "1/55.91"）

JSONのみを返してください。読み取れない項目はnullにしてください。`;

    const resultText = await callGeminiAPI(prompt, validImages);

    // JSONを抽出
    const jsonMatch = resultText.match(/```json\s*([\s\S]*?)\s*```/) || resultText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : resultText;
    const data = JSON.parse(jsonStr);

    displayOcrResult(data);

  } catch (error) {
    console.error('OCR Error:', error);
    if (error.message.includes('API key')) {
      alert('APIキーが無効です。正しいAPIキーを設定してください。');
      openSettings();
    } else {
      // エラー時も結果エリアに表示
      const resultDiv = document.getElementById('ocr-result');
      const dataGrid = document.getElementById('ocr-data-grid');
      dataGrid.innerHTML = `<div class="ocr-error">読み取りに失敗しました</div>`;
      resultDiv.style.display = 'block';
    }
  } finally {
    statusDiv.style.display = 'none';
    btn.style.display = 'inline-block';
    btn.textContent = '再読み取り';
  }
}

function displayOcrResult(data) {
  // OCRデータを保存
  currentOcrData = data;

  const resultDiv = document.getElementById('ocr-result');
  const dataGrid = document.getElementById('ocr-data-grid');

  // プロ目線で重要な9項目
  const labels = {
    game_count: 'ゲーム数',
    bb_probability: 'BB確率',
    rb_probability: 'RB確率',
    skill_true_rate: '真ビタ成功率',
    skill_extreme_rate: '極ビタ成功率',
    dance_time_count: 'DT突入',
    suika_probability: 'スイカ確率',
    cherry_probability: 'チェリー確率',
    common_10mai_probability: '共通10枚'
  };

  dataGrid.innerHTML = '';

  let itemCount = 0;
  for (const [key, label] of Object.entries(labels)) {
    if (data[key] !== null && data[key] !== undefined) {
      const item = document.createElement('div');
      item.className = 'ocr-data-item';
      // 設定推測に重要な項目はハイライト
      if (key === 'skill_true_rate' || key === 'skill_extreme_rate' ||
          key === 'suika_probability' || key === 'cherry_probability' || key === 'common_10mai_probability') {
        item.classList.add('highlight');
      }
      item.innerHTML = `
        <span class="ocr-data-label">${label}</span>
        <span class="ocr-data-value">${data[key]}</span>
      `;
      dataGrid.appendChild(item);
      itemCount++;
    }
  }

  // データがない場合もメッセージを表示
  if (itemCount === 0) {
    dataGrid.innerHTML = '<div class="ocr-error">データを読み取れませんでした</div>';
  }

  resultDiv.style.display = 'block';
}

// ========== 保存処理 ==========
async function saveCurrentEntry() {
  const dateText = document.getElementById('entry-date').textContent;
  const match = dateText.match(/(\d+)年(\d+)月(\d+)日/);

  if (!match) {
    alert('日付の形式が不正です');
    return;
  }

  const entry = {
    year: parseInt(match[1]),
    month: parseInt(match[2]),
    day: parseInt(match[3]),
    date: `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`,
    hall: document.getElementById('hall-name').value,
    machine: document.getElementById('machine-name').value,
    in: parseInt(document.getElementById('input-in').value) || 0,
    out: parseInt(document.getElementById('input-out').value) || 0,
    hours: document.getElementById('hours-unknown').checked ? null : (parseInt(document.getElementById('input-hours').value) || 1) + (parseInt(document.getElementById('input-minutes').value) || 0) / 60,
    hoursUnknown: document.getElementById('hours-unknown').checked,
    memo: document.getElementById('memo').value,
    blog: document.getElementById('blog-content').value,
    images: getValidImages(),
    ocrData: currentOcrData
  };

  if (currentEntryId) {
    entry.id = currentEntryId;
  }

  try {
    await saveEntry(entry);
    alert('保存しました');
    showMonthlyView();
  } catch (error) {
    alert('保存に失敗しました: ' + error.message);
  }
}

async function deleteCurrentEntry() {
  if (!currentEntryId) return;

  if (!confirm('この記録を削除しますか？')) return;

  try {
    await deleteEntry(currentEntryId);
    showMonthlyView();
  } catch (error) {
    alert('削除に失敗しました: ' + error.message);
  }
}

// ========== ブログ生成 ==========
async function generateBlog() {
  const validImages = getValidImages();
  if (validImages.length === 0) {
    alert('スクリーンショットをアップロードしてください');
    return;
  }

  const btn = document.getElementById('btn-generate-blog');
  btn.classList.add('loading');
  btn.textContent = 'ブログ生成中';

  try {
    if (!geminiApiKey) {
      alert('設定からGemini APIキーを入力してください');
      openSettings();
      btn.classList.remove('loading');
      btn.textContent = 'Gemini AIでブログ生成';
      return;
    }

    const styleRadio = document.querySelector('input[name="blog-style"]:checked');
    const blogStyle = styleRadio ? styleRadio.value : 'polite';

    const machine = document.getElementById('machine-name').value;
    const inAmount = parseInt(document.getElementById('input-in').value) || 0;
    const outAmount = parseInt(document.getElementById('input-out').value) || 0;
    const memo = document.getElementById('memo').value;
    const balance = outAmount - inAmount;
    const balanceText = balance >= 0 ? `+${balance.toLocaleString()}` : balance.toLocaleString();

    const styleInstructions = {
      polite: '- ですます調で丁寧に書いてください\n- 読者に語りかけるような親しみやすい文章で',
      casual: '- 口語調でラフに書いてください\n- 友達に話すようなカジュアルな感じで',
      live: '- 実況風・ライブ感のある文体で書いてください\n- 「きたああ！」「うおおお！」など興奮表現OK\n- スロット専門ブログ風の熱い文章で'
    };

    const prompt = `あなたはパチスロブロガーです。
以下の実戦データのスクリーンショットを分析して、面白くて読みやすいブログ記事を書いてください。

【基本情報】
- 機種名: ${machine || '（画像から判断してください）'}
- 投資: ${inAmount.toLocaleString()}円
- 回収: ${outAmount.toLocaleString()}円
- 収支: ${balanceText}円

【メモ】
${memo || 'なし'}

【文体指示】
${styleInstructions[blogStyle] || styleInstructions.polite}

【お願い】
1. スクリーンショットのデータを読み取って分析してください
2. 展開や印象的な場面があれば触れてください
3. 技術介入成功率が高ければ褒めてください
4. 300〜500文字程度でまとめてください

ブログ記事:`;

    const blogText = await callGeminiAPI(prompt, validImages);
    document.getElementById('blog-content').value = blogText;
    document.getElementById('blog-output').style.display = 'block';
  } catch (error) {
    alert('ブログ生成に失敗しました: ' + error.message);
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'Gemini AIでブログ生成';
  }
}

function copyBlog() {
  const blogContent = document.getElementById('blog-content');
  blogContent.select();
  document.execCommand('copy');
  alert('コピーしました');
}

// ========== 今日のエントリーを開く ==========
async function openTodaysEntry() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  // 今日のエントリーが既にあるか確認
  const entries = await getEntriesByMonth(year, month);
  const todaysEntry = entries.find(e => e.day === day);

  if (todaysEntry) {
    // 既存のエントリーを開く
    showEntryView(todaysEntry.id);
  } else {
    // 新規エントリーを開く
    showEntryView(null);
  }
}

// ========== 機種統計 ==========
async function getMachineStats() {
  const entries = await getAllEntries();
  const stats = {};

  entries.forEach(entry => {
    if (!entry.machine) return;
    const machine = entry.machine;

    if (!stats[machine]) {
      stats[machine] = {
        count: 0,
        wins: 0,
        losses: 0,
        totalBalance: 0
      };
    }

    const balance = (entry.out || 0) - (entry.in || 0);
    stats[machine].count++;
    stats[machine].totalBalance += balance;
    if (balance >= 0) {
      stats[machine].wins++;
    } else {
      stats[machine].losses++;
    }
  });

  return stats;
}

async function updateMachineDatalist() {
  const stats = await getMachineStats();
  const datalist = document.getElementById('machine-list');
  datalist.innerHTML = '';

  // 回数順でソート
  const sorted = Object.entries(stats).sort((a, b) => b[1].count - a[1].count);

  sorted.forEach(([machine]) => {
    const option = document.createElement('option');
    option.value = machine;
    datalist.appendChild(option);
  });
}

async function showMachineStats(machineName) {
  if (!machineName) {
    document.getElementById('machine-stats').style.display = 'none';
    return;
  }

  const stats = await getMachineStats();
  const data = stats[machineName];

  if (!data) {
    document.getElementById('machine-stats').style.display = 'none';
    return;
  }

  const winRate = data.count > 0 ? Math.round((data.wins / data.count) * 100) : 0;
  const avgBalance = data.count > 0 ? Math.round(data.totalBalance / data.count) : 0;
  const balanceClass = data.totalBalance >= 0 ? 'profit' : 'loss';

  document.getElementById('machine-stats').innerHTML = `
    <div class="machine-stat-item">
      <span class="machine-stat-label">実戦:</span>
      <span class="machine-stat-value">${data.count}回</span>
    </div>
    <div class="machine-stat-item">
      <span class="machine-stat-label">勝率:</span>
      <span class="machine-stat-value">${winRate}%</span>
    </div>
    <div class="machine-stat-item">
      <span class="machine-stat-label">累計:</span>
      <span class="machine-stat-value ${balanceClass}">${data.totalBalance >= 0 ? '+' : ''}${data.totalBalance.toLocaleString()}円</span>
    </div>
    <div class="machine-stat-item">
      <span class="machine-stat-label">平均:</span>
      <span class="machine-stat-value ${avgBalance >= 0 ? 'profit' : 'loss'}">${avgBalance >= 0 ? '+' : ''}${avgBalance.toLocaleString()}円</span>
    </div>
  `;
  document.getElementById('machine-stats').style.display = 'flex';
}

// ========== ホール統計 ==========
async function getHallStats() {
  const entries = await getAllEntries();
  const stats = {};

  entries.forEach(entry => {
    if (!entry.hall) return;
    const hall = entry.hall;

    if (!stats[hall]) {
      stats[hall] = { count: 0 };
    }
    stats[hall].count++;
  });

  return stats;
}

async function updateHallDatalist() {
  const stats = await getHallStats();
  const datalist = document.getElementById('hall-list');
  datalist.innerHTML = '';

  // 回数順でソート（よく行く店が上）
  const sorted = Object.entries(stats).sort((a, b) => b[1].count - a[1].count);

  sorted.forEach(([hall]) => {
    const option = document.createElement('option');
    option.value = hall;
    datalist.appendChild(option);
  });
}

// ========== 彦一分析 ==========
async function generateHikoichiAnalysis() {
  const validImages = getValidImages();
  const btn = document.getElementById('btn-hikoichi');
  const outputDiv = document.getElementById('hikoichi-output');
  const contentDiv = document.getElementById('hikoichi-content');

  btn.textContent = 'チェック中...';
  btn.disabled = true;

  try {
    if (!geminiApiKey) {
      alert('設定からGemini APIキーを入力してください');
      openSettings();
      return;
    }

    const machineName = document.getElementById('machine-name').value;
    const inAmount = parseInt(document.getElementById('input-in').value) || 0;
    const outAmount = parseInt(document.getElementById('input-out').value) || 0;
    const memo = document.getElementById('memo').value;
    const balance = outAmount - inAmount;
    const balanceText = balance >= 0 ? `+${balance.toLocaleString()}` : balance.toLocaleString();

    const stats = await getMachineStats();
    const machineData = stats[machineName];
    let statsText = '';
    if (machineData) {
      const winRate = Math.round((machineData.wins / machineData.count) * 100);
      statsText = `\n【この機種の過去データ】\n- 実戦回数: ${machineData.count}回\n- 勝率: ${winRate}%\n- 累計収支: ${machineData.totalBalance.toLocaleString()}円`;
    }

    const memoSection = memo ? `\n【打ち手のメモ・感想】\n${memo}\n※このメモの内容も必ず分析に含めて、コメントしてください！` : '';

    const prompt = `あなたはスラムダンクの相田彦一ですが、実はスロプロとしての深い知識と愛情を持っています。

彦一のキャラクター:
- 口癖は「要チェックや！」「チェックチェック！」
- メモ魔で何でもメモを取る、関西弁で喋る
- 打ち手の成長を願っている、愛のあるコーチ的存在

【重要】打ち手は仕事終わりに趣味として楽しんでいます。
- 絶対にいちゃもんをつけない、説教しない
- 負けても「もっとこうすべき」などの批判は禁止
- 純粋に楽しんでいることを応援する姿勢で

【機種知識】打った機種「${machineName || '不明'}」について完全把握した上で分析すること
＜ディスクアップ2＞設定1〜6のBB確率1/287.4〜1/245.1、真ビタ100%なら優秀
＜ウルトラリミックス＞HYPER BIG搭載、技術介入要素あり

【スロプロ視点】設定推測、技術介入評価、期待値についてコメント（批判ではなく情報として）

【大切にすること】
- まず打ち手の頑張りを認める、褒める
- 負けた日も「お疲れ様！」「ドンマイや！」と明るく
- 次回への期待を込めて前向きに締める

【今日の実戦データ】
- 機種: ${machineName || '不明'}
- 投資: ${inAmount.toLocaleString()}円
- 回収: ${outAmount.toLocaleString()}円
- 収支: ${balanceText}円${statsText}${memoSection}

必ず以下のJSON形式で返してください:
\`\`\`json
{
  "score": 85,
  "comment": "彦一のコメント（200-400文字程度）"
}
\`\`\``;

    const resultText = await callGeminiAPI(prompt, validImages);

    const jsonMatch = resultText.match(/```json\s*([\s\S]*?)\s*```/) || resultText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : resultText;
    const result = JSON.parse(jsonStr);

    contentDiv.innerHTML = `
      <div class="hikoichi-score">
        <span class="hikoichi-score-label">彦一スコア</span>
        <span class="hikoichi-score-value">${result.score}点</span>
      </div>
      <div class="hikoichi-comment">${result.comment}</div>
    `;
    outputDiv.style.display = 'block';

  } catch (error) {
    alert('彦一分析に失敗しました: ' + error.message);
  } finally {
    btn.textContent = '彦一の実戦チェック';
    btn.disabled = false;
  }
}

// ========== グラフ表示 ==========
let balanceChart = null;

async function showChart(chartType = 'monthly') {
  document.getElementById('chart-modal').style.display = 'flex';

  const entries = await getEntriesByYear(currentYear);

  // 月別データを集計
  const monthlyData = {};
  for (let i = 1; i <= 12; i++) {
    monthlyData[i] = 0;
  }

  entries.forEach(entry => {
    const balance = (entry.out || 0) - (entry.in || 0);
    monthlyData[entry.month] += balance;
  });

  const labels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  let data, label;

  if (chartType === 'monthly') {
    data = Object.values(monthlyData);
    label = '月別収支';
  } else {
    // 累計
    let cumulative = 0;
    data = Object.values(monthlyData).map(val => {
      cumulative += val;
      return cumulative;
    });
    label = '累計収支';
  }

  const ctx = document.getElementById('balance-chart').getContext('2d');

  if (balanceChart) {
    balanceChart.destroy();
  }

  balanceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: data,
        backgroundColor: data.map(val => val >= 0 ? 'rgba(0, 255, 136, 0.6)' : 'rgba(255, 71, 87, 0.6)'),
        borderColor: data.map(val => val >= 0 ? '#00ff88' : '#ff4757'),
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#a0a0a0',
            callback: (value) => (value / 1000) + 'k'
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: '#a0a0a0'
          }
        }
      }
    }
  });
}

function closeChart() {
  document.getElementById('chart-modal').style.display = 'none';
  if (balanceChart) {
    balanceChart.destroy();
    balanceChart = null;
  }
}

// ========== 年・月移動 ==========
function prevYear() {
  currentYear--;
  updateYearDisplay();
  updateMonthButtons();
  loadMonthlyData();
}

function nextYear() {
  currentYear++;
  updateYearDisplay();
  updateMonthButtons();
  loadMonthlyData();
}

function selectMonth(month) {
  if (month === 'all') {
    showAllMonths = true;
  } else {
    showAllMonths = false;
    currentMonth = parseInt(month);
  }
  updateMonthButtons();
  loadMonthlyData();
}

// ========== イベントリスナー ==========
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();

  // Firebase初期化
  initFirebase();

  // 起動時に今日のエントリーを直接開く
  await openTodaysEntry();

  // 年移動
  document.getElementById('btn-prev-year').addEventListener('click', prevYear);
  document.getElementById('btn-next-year').addEventListener('click', nextYear);

  // 月ボタン
  document.querySelectorAll('.month-btn').forEach(btn => {
    btn.addEventListener('click', () => selectMonth(btn.dataset.month));
  });

  // 表示切替（リスト/カレンダー）
  document.getElementById('btn-list-view').addEventListener('click', () => {
    document.getElementById('btn-list-view').classList.add('active');
    document.getElementById('btn-calendar-view').classList.remove('active');
    document.getElementById('daily-list').style.display = 'flex';
    document.getElementById('calendar-view').style.display = 'none';
  });
  document.getElementById('btn-calendar-view').addEventListener('click', () => {
    document.getElementById('btn-calendar-view').classList.add('active');
    document.getElementById('btn-list-view').classList.remove('active');
    document.getElementById('calendar-view').style.display = 'block';
    document.getElementById('daily-list').style.display = 'none';
  });

  // グラフ表示
  document.getElementById('btn-chart').addEventListener('click', () => showChart('monthly'));
  document.getElementById('btn-close-chart').addEventListener('click', closeChart);
  document.querySelectorAll('.chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      showChart(tab.dataset.chart);
    });
  });

  // エントリー操作
  document.getElementById('btn-add-entry').addEventListener('click', () => showEntryView());
  document.getElementById('btn-back').addEventListener('click', showMonthlyView);
  document.getElementById('btn-save').addEventListener('click', saveCurrentEntry);
  document.getElementById('btn-delete').addEventListener('click', deleteCurrentEntry);

  // 日付変更
  const dateInput = document.getElementById('date-input');
  dateInput.addEventListener('change', (e) => {
    const date = new Date(e.target.value);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    document.getElementById('entry-date').textContent = `${year}年${month}月${day}日`;
  });

  // ドロップゾーン初期化
  initDropZones();

  // OCRボタン
  document.getElementById('btn-ocr').addEventListener('click', performOcr);

  // IN/OUT入力時の収支計算
  document.getElementById('input-in').addEventListener('input', updateBalance);
  document.getElementById('input-out').addEventListener('input', updateBalance);

  // 稼働時間変更時も時給を更新
  document.getElementById('input-hours').addEventListener('change', updateBalance);
  document.getElementById('input-minutes').addEventListener('change', updateBalance);

  // 稼働時間不明チェックボックス
  document.getElementById('hours-unknown').addEventListener('change', (e) => {
    document.getElementById('input-hours').disabled = e.target.checked;
    document.getElementById('input-minutes').disabled = e.target.checked;
    updateBalance();
  });

  // 機種名入力時の統計表示
  const machineInput = document.getElementById('machine-name');
  const clearBtn = document.getElementById('btn-clear-machine');

  machineInput.addEventListener('input', () => {
    showMachineStats(machineInput.value);
    clearBtn.style.display = machineInput.value ? 'flex' : 'none';
  });
  machineInput.addEventListener('focus', updateMachineDatalist);

  // クリアボタン（機種名）
  clearBtn.addEventListener('click', () => {
    machineInput.value = '';
    clearBtn.style.display = 'none';
    document.getElementById('machine-stats').style.display = 'none';
  });

  // ホール名入力
  const hallInput = document.getElementById('hall-name');
  const hallClearBtn = document.getElementById('btn-clear-hall');

  hallInput.addEventListener('input', () => {
    hallClearBtn.style.display = hallInput.value ? 'flex' : 'none';
  });
  hallInput.addEventListener('focus', updateHallDatalist);

  // クリアボタン（ホール名）
  hallClearBtn.addEventListener('click', () => {
    hallInput.value = '';
    hallClearBtn.style.display = 'none';
  });

  // 彦一分析
  document.getElementById('btn-hikoichi').addEventListener('click', generateHikoichiAnalysis);

  // ブログ生成
  document.getElementById('btn-generate-blog').addEventListener('click', generateBlog);
  document.getElementById('btn-copy-blog').addEventListener('click', copyBlog);

  // 設定モーダル
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-toggle-key').addEventListener('click', toggleKeyVisibility);

  // Firebase認証
  document.getElementById('btn-user').addEventListener('click', () => {
    if (currentUser) {
      openSettings();
    } else {
      loginWithGoogle();
    }
  });
  document.getElementById('btn-google-login').addEventListener('click', loginWithGoogle);
  document.getElementById('btn-logout').addEventListener('click', logout);

  // バックアップ機能
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importData(e.target.files[0]);
      e.target.value = ''; // リセット
    }
  });

  // APIキーがあれば入力欄にセット、なければ設定画面を表示
  if (geminiApiKey) {
    document.getElementById('api-key-input').value = geminiApiKey;
  } else {
    // 未設定なら設定画面を自動表示
    openSettings();
  }
});

// ========== 設定モーダル ==========
function openSettings() {
  document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() {
  // APIキー未設定なら閉じられない
  if (!geminiApiKey) {
    alert('APIキーを入力して保存してください');
    return;
  }
  document.getElementById('settings-modal').style.display = 'none';
}

function saveSettings() {
  const apiKey = document.getElementById('api-key-input').value.trim();
  if (apiKey) {
    geminiApiKey = apiKey;
    localStorage.setItem('gemini_api_key', apiKey);
    alert('APIキーを保存しました');
    closeSettings();
  } else {
    alert('APIキーを入力してください');
  }
}

function toggleKeyVisibility() {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('btn-toggle-key');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '非表示';
  } else {
    input.type = 'password';
    btn.textContent = '表示';
  }
}

async function testApiKey() {
  const apiKey = document.getElementById('api-key-input').value.trim();
  if (!apiKey) {
    alert('APIキーを入力してください');
    return;
  }

  const btn = document.getElementById('btn-test-key');
  btn.textContent = 'テスト中...';
  btn.disabled = true;

  try {
    const response = await fetch('http://localhost:8000/test-api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey })
    });

    if (response.ok) {
      alert('APIキーは有効です！');
    } else {
      const errorData = await response.json();
      alert(errorData.detail || 'APIキーが無効です');
    }
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      alert('サーバーに接続できません。\nバックエンドサーバーが起動しているか確認してください。');
    } else {
      alert('テストに失敗しました: ' + error.message);
    }
  } finally {
    btn.textContent = 'テスト';
    btn.disabled = false;
  }
}

// ========== バックアップ機能 ==========
async function exportData() {
  const entries = await getAllEntries();
  const data = {
    version: 1,
    exportDate: new Date().toISOString(),
    entries: entries
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pachi_slo_diary_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  alert(`${entries.length}件のデータをエクスポートしました`);
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.entries || !Array.isArray(data.entries)) {
      throw new Error('無効なバックアップファイルです');
    }

    const count = data.entries.length;
    if (!confirm(`${count}件のデータをインポートします。\n既存のデータは上書きされる可能性があります。\n続行しますか？`)) {
      return;
    }

    // データをインポート
    for (const entry of data.entries) {
      await saveEntry(entry);
    }

    alert(`${count}件のデータをインポートしました`);
    showMonthlyView();
  } catch (error) {
    alert('インポートに失敗しました: ' + error.message);
  }
}

// グローバル関数（onclick用）
window.removeImage = removeImage;

// ========== Service Worker登録 ==========
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}
