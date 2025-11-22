// ========================================
// pachi_slo_diary - Main Script
// ========================================

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
async function saveEntry(entry) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // インデックス用
    entry.yearMonth = `${entry.year}-${String(entry.month).padStart(2, '0')}`;

    const request = entry.id ? store.put(entry) : store.add(entry);
    request.onsuccess = () => resolve(request.result);
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

async function deleteEntry(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
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
}

async function loadEntry(id) {
  const entry = await getEntry(id);
  if (!entry) return;

  document.getElementById('entry-date').textContent =
    `${entry.year}年${entry.month}月${entry.day}日`;
  document.getElementById('machine-name').value = entry.machine || '';
  document.getElementById('input-in').value = entry.in || '';
  document.getElementById('input-out').value = entry.out || '';
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

  updateBalance();
}

function clearEntryForm() {
  document.getElementById('machine-name').value = '';
  document.getElementById('input-in').value = '';
  document.getElementById('input-out').value = '';
  document.getElementById('memo').value = '';
  document.getElementById('blog-content').value = '';
  document.getElementById('blog-output').style.display = 'none';
  document.getElementById('ocr-result').style.display = 'none';
  uploadedImages = [null, null, null, null, null];
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
}

// ========== 画像処理（ドロップゾーン） ==========
function initDropZones() {
  const dropZones = document.querySelectorAll('.drop-zone');

  dropZones.forEach((zone, index) => {
    const input = zone.querySelector('.drop-input');
    const preview = zone.querySelector('.drop-preview');
    const removeBtn = zone.querySelector('.drop-remove');
    const label = zone.querySelector('.drop-label');
    const icon = zone.querySelector('.drop-icon');

    // タップで選択
    zone.addEventListener('click', (e) => {
      if (e.target === removeBtn) return;
      input.click();
    });

    // ファイル選択時
    input.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleDropZoneFile(zone, index, e.target.files[0]);
      }
    });

    // ドラッグ＆ドロップ
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleDropZoneFile(zone, index, e.dataTransfer.files[0]);
      }
    });

    // 削除ボタン
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeDropZoneImage(zone, index);
    });
  });
}

function handleDropZoneFile(zone, index, file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImages[index] = e.target.result;
    updateDropZonePreview(zone, e.target.result);
    // 自動OCR実行
    autoOcr();
  };
  reader.readAsDataURL(file);
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

function updateDropZonePreview(zone, src) {
  const preview = zone.querySelector('.drop-preview');
  const removeBtn = zone.querySelector('.drop-remove');
  const label = zone.querySelector('.drop-label');
  const icon = zone.querySelector('.drop-icon');

  preview.src = src;
  preview.style.display = 'block';
  removeBtn.style.display = 'flex';
  label.style.display = 'none';
  icon.style.display = 'none';
  zone.classList.add('has-image');
}

function removeDropZoneImage(zone, index) {
  const preview = zone.querySelector('.drop-preview');
  const removeBtn = zone.querySelector('.drop-remove');
  const label = zone.querySelector('.drop-label');
  const icon = zone.querySelector('.drop-icon');
  const input = zone.querySelector('.drop-input');

  uploadedImages[index] = null;
  preview.src = '';
  preview.style.display = 'none';
  removeBtn.style.display = 'none';
  label.style.display = 'block';
  icon.style.display = 'block';
  zone.classList.remove('has-image');
  input.value = '';
}

function renderDropZonePreviews() {
  const dropZones = document.querySelectorAll('.drop-zone');
  dropZones.forEach((zone, index) => {
    if (uploadedImages[index]) {
      updateDropZonePreview(zone, uploadedImages[index]);
    } else {
      removeDropZoneImage(zone, index);
    }
  });
  updateDropZoneVisibility();
}

// 必要な枠だけ表示（アップロード済み + 次の1枠）
function updateDropZoneVisibility() {
  const dropZones = document.querySelectorAll('.drop-zone');
  let lastFilledIndex = -1;

  // 最後にアップロードされた位置を探す
  uploadedImages.forEach((img, i) => {
    if (img) lastFilledIndex = i;
  });

  // 表示する枠数（アップロード済み + 次の1枠、最大5）
  const showCount = Math.min(lastFilledIndex + 2, 5);

  dropZones.forEach((zone, index) => {
    if (index < showCount) {
      zone.classList.add('visible');
    } else {
      zone.classList.remove('visible');
    }
  });
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

// ========== OCR機能 ==========
async function performOcr() {
  const validImages = getValidImages();
  if (validImages.length === 0) return;

  const btn = document.getElementById('btn-ocr');
  const resultDiv = document.getElementById('ocr-result');
  const dataGrid = document.getElementById('ocr-data-grid');

  btn.classList.add('loading');
  btn.textContent = '読み取り中...';

  try {
    if (!geminiApiKey) {
      alert('設定からGemini APIキーを入力してください');
      openSettings();
      return;
    }

    const response = await fetch('http://localhost:8000/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: validImages, api_key: geminiApiKey })
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMsg = errorData.detail || 'OCR失敗';
      // APIキー関連のエラーを判別
      if (errorMsg.includes('API key') || errorMsg.includes('API_KEY')) {
        alert('APIキーが無効です。\n\n正しいAPIキーを設定してください。\nGoogle AI Studio (https://aistudio.google.com/app/apikey) で取得できます。');
        openSettings();
        return;
      }
      throw new Error(errorMsg);
    }

    const result = await response.json();
    displayOcrResult(result.data);

    // 機種名を自動入力
    if (result.data.machine_name) {
      document.getElementById('machine-name').value = result.data.machine_name;
    }

  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      alert('サーバーに接続できません。\nバックエンドサーバーが起動しているか確認してください。');
    } else {
      alert('OCR読み取りに失敗しました: ' + error.message);
    }
  } finally {
    btn.classList.remove('loading');
    btn.textContent = 'データを読み取る（OCR）';
  }
}

function displayOcrResult(data) {
  const resultDiv = document.getElementById('ocr-result');
  const dataGrid = document.getElementById('ocr-data-grid');

  // プロ目線で重要な6項目のみ
  const labels = {
    game_count: 'ゲーム数',
    bb_probability: 'BB確率',
    rb_probability: 'RB確率',
    skill_true_rate: '真ビタ成功率',
    skill_extreme_rate: '極ビタ成功率',
    dance_time_count: 'DT突入'
  };

  dataGrid.innerHTML = '';

  for (const [key, label] of Object.entries(labels)) {
    if (data[key] !== null && data[key] !== undefined) {
      const item = document.createElement('div');
      item.className = 'ocr-data-item';
      // 真ビタ/極ビタは重要なのでハイライト
      if (key === 'skill_true_rate' || key === 'skill_extreme_rate') {
        item.classList.add('highlight');
      }
      item.innerHTML = `
        <span class="ocr-data-label">${label}</span>
        <span class="ocr-data-value">${data[key]}</span>
      `;
      dataGrid.appendChild(item);
    }
  }

  resultDiv.style.display = dataGrid.children.length > 0 ? 'block' : 'none';
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
    machine: document.getElementById('machine-name').value,
    in: parseInt(document.getElementById('input-in').value) || 0,
    out: parseInt(document.getElementById('input-out').value) || 0,
    memo: document.getElementById('memo').value,
    blog: document.getElementById('blog-content').value,
    images: getValidImages()
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

// ========== Gemini API連携 ==========
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
      btn.classList.remove('loading');
      btn.textContent = 'Gemini AIでブログ生成';
      return;
    }

    // 選択された文体を取得
    const styleRadio = document.querySelector('input[name="blog-style"]:checked');
    const blogStyle = styleRadio ? styleRadio.value : 'polite';

    const response = await fetch('http://localhost:8000/generate-blog', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        images: validImages,
        machine: document.getElementById('machine-name').value,
        in_amount: parseInt(document.getElementById('input-in').value) || 0,
        out_amount: parseInt(document.getElementById('input-out').value) || 0,
        memo: document.getElementById('memo').value,
        api_key: geminiApiKey,
        style: blogStyle
      })
    });

    if (!response.ok) {
      throw new Error('API呼び出しに失敗しました');
    }

    const data = await response.json();
    document.getElementById('blog-content').value = data.blog;
    document.getElementById('blog-output').style.display = 'block';
  } catch (error) {
    alert('ブログ生成に失敗しました: ' + error.message + '\n\nバックエンドサーバーが起動しているか確認してください。');
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

  // 起動時に今日のエントリーを直接開く
  await openTodaysEntry();

  // 年移動
  document.getElementById('btn-prev-year').addEventListener('click', prevYear);
  document.getElementById('btn-next-year').addEventListener('click', nextYear);

  // 月ボタン
  document.querySelectorAll('.month-btn').forEach(btn => {
    btn.addEventListener('click', () => selectMonth(btn.dataset.month));
  });

  // エントリー操作
  document.getElementById('btn-add-entry').addEventListener('click', () => showEntryView());
  document.getElementById('btn-back').addEventListener('click', showMonthlyView);
  document.getElementById('btn-save').addEventListener('click', saveCurrentEntry);
  document.getElementById('btn-delete').addEventListener('click', deleteCurrentEntry);

  // ドロップゾーン初期化
  initDropZones();
  updateDropZoneVisibility(); // 最初は1枠だけ表示

  // OCRボタン
  document.getElementById('btn-ocr').addEventListener('click', performOcr);

  // IN/OUT入力時の収支計算
  document.getElementById('input-in').addEventListener('input', updateBalance);
  document.getElementById('input-out').addEventListener('input', updateBalance);

  // ブログ生成
  document.getElementById('btn-generate-blog').addEventListener('click', generateBlog);
  document.getElementById('btn-copy-blog').addEventListener('click', copyBlog);

  // 設定モーダル
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-toggle-key').addEventListener('click', toggleKeyVisibility);
  document.getElementById('btn-test-key').addEventListener('click', testApiKey);

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

// グローバル関数（onclick用）
window.removeImage = removeImage;
