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

// ========== Gemini API モデル設定（一元管理） ==========
// ⚠️ モデル名変更時はここだけを修正すればOK
const GEMINI_MODELS = {
  primary: "gemini-2.5-flash",      // 第一候補（最新・最適）
  fallback1: "gemini-1.5-flash",    // フォールバック1（高速・安定）
  fallback2: "gemini-1.0-pro"       // フォールバック2（最終手段）
};

// 現在使用中のモデル（動的に変更される）
let currentGeminiModel = GEMINI_MODELS.primary;

// 失敗したモデルのリスト（429エラーなど）
let failedModels = [];

// Firebase初期化
let firebaseApp = null;
let auth = null;
let firestoreDb = null;
let storage = null; // Firebase Storage
let currentUser = null;
let unsubscribeSync = null; // リアルタイム同期のリスナー解除用

// デバッグ用: 画面上にログ表示（スマホでも確認できる）
function showDebugLog(message) {
  console.log(message);
  // デバッグモード時のみ画面表示（URLに?debug=1がある場合）
  if (window.location.search.includes('debug=1')) {
    const debugDiv = document.getElementById('debug-log') || (() => {
      const div = document.createElement('div');
      div.id = 'debug-log';
      div.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,0.9);color:#0f0;padding:10px;font-size:10px;max-height:200px;overflow-y:auto;z-index:99999;';
      document.body.appendChild(div);
      return div;
    })();
    const time = new Date().toLocaleTimeString();
    debugDiv.innerHTML = `[${time}] ${message}<br>` + debugDiv.innerHTML;
  }
}

async function initFirebase() {
  if (firebaseConfig.apiKey === "YOUR_API_KEY") {
    console.log('Firebase未設定 - クラウド同期は無効');
    return false;
  }
  try {
    showDebugLog('🔧 Firebase初期化開始');

    firebaseApp = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    firestoreDb = firebase.firestore();
    storage = firebase.storage(); // Storage初期化

    showDebugLog('✅ Firebase初期化完了');

    // 【重要】認証状態の監視を先に設定（リダイレクト結果より前）
    showDebugLog('👁️ 認証状態監視を開始');
    auth.onAuthStateChanged(handleAuthStateChanged);

    // リダイレクトログインの結果を処理（スマホ対応）
    showDebugLog('📱 リダイレクト結果を取得中...');
    try {
      const result = await auth.getRedirectResult();
      showDebugLog('📱 getRedirectResult完了: ' + (result ? 'resultあり' : 'resultなし'));

      // 詳細デバッグ
      if (result) {
        showDebugLog('🔍 result詳細: user=' + (result.user ? 'あり' : 'なし') +
                     ', credential=' + (result.credential ? 'あり' : 'なし') +
                     ', operationType=' + (result.operationType || 'なし'));
        if (result.user) {
          showDebugLog('👤 user詳細: uid=' + result.user.uid +
                       ', email=' + (result.user.email || 'なし') +
                       ', displayName=' + (result.user.displayName || 'なし'));
        }
      }

      if (result && result.user) {
        showDebugLog('✅ リダイレクトログイン成功: ' + result.user.displayName + ' (' + result.user.uid + ')');
        // ログイン成功時は設定モーダルを閉じる
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
          settingsModal.style.display = 'none';
          // 背景のスクロールを再度有効化
          document.body.style.overflow = '';
          showDebugLog('🔒 設定モーダルを閉じました');
        }
      } else {
        showDebugLog('ℹ️ リダイレクト結果なし（通常のページロード）');
      }
    } catch (error) {
      showDebugLog('❌ リダイレクトログインエラー: ' + error.code + ' - ' + error.message);
      console.error('❌ リダイレクトログインエラー:', error);
      if (error.code !== 'auth/popup-closed-by-user') {
        alert('ログインに失敗しました: ' + error.message);
      }
    }

    return true;
  } catch (error) {
    showDebugLog('❌ Firebase初期化エラー: ' + error.message);
    console.error('Firebase初期化エラー:', error);
    return false;
  }
}

// 認証状態変更ハンドラ
async function handleAuthStateChanged(user) {
  const msg = user ? `ログイン中 (${user.displayName})` : 'ログアウト';
  showDebugLog('🔄 認証状態変更: ' + msg);
  currentUser = user;
  updateUserUI();

  if (user) {
    console.log('👤 ユーザー情報:', user.uid, user.email);
    // ログイン時：クラウドからAPIキーと設定を取得
    try {
      const userDoc = await firestoreDb.collection('users').doc(user.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData.apiKey) {
          geminiApiKey = userData.apiKey;
          localStorage.setItem('gemini_api_key', userData.apiKey);
          const apiKeyInput = document.getElementById('api-key-input');
          if (apiKeyInput) apiKeyInput.value = userData.apiKey;
          console.log('✅ APIキーをクラウドから取得しました');
        }
      } else {
        // クラウドにデータがない場合、ローカルのAPIキーをアップロード
        if (geminiApiKey) {
          await firestoreDb.collection('users').doc(user.uid).set({
            apiKey: geminiApiKey
          }, { merge: true });
          console.log('✅ APIキーをクラウドに保存しました');
        }
      }
    } catch (e) {
      console.error('❌ ユーザー設定の取得エラー:', e);
    }
    // クラウドからデータを同期してリアルタイム同期開始
    await syncFromCloud();
    startRealtimeSync();

    // ストレージ使用量を読み込んで表示
    await loadStorageUsage();
    const storageUsageDiv = document.getElementById('storage-usage');
    if (storageUsageDiv) storageUsageDiv.style.display = 'block';

    // ログイン完了後は必ず月別一覧を表示
    showMonthlyView();
  } else {
    // ログアウト時：リアルタイム同期を停止
    stopRealtimeSync();

    // ストレージ使用量表示を非表示
    const storageUsageDiv = document.getElementById('storage-usage');
    if (storageUsageDiv) storageUsageDiv.style.display = 'none';

    showMonthlyView();
  }
}

// リアルタイム同期開始
function startRealtimeSync() {
  if (!currentUser || !firestoreDb || unsubscribeSync) return;

  const userEntriesRef = firestoreDb
    .collection('users')
    .doc(currentUser.uid)
    .collection('entries');

  unsubscribeSync = userEntriesRef.onSnapshot((snapshot) => {
    // Firestoreの変更を検知したら画面を更新
    loadMonthlyData();
  }, (error) => {
    console.error('リアルタイム同期エラー:', error);
  });

  console.log('リアルタイム同期開始');
}

// リアルタイム同期停止
function stopRealtimeSync() {
  if (unsubscribeSync) {
    unsubscribeSync();
    unsubscribeSync = null;
    console.log('リアルタイム同期停止');
  }
}

// UI更新
function updateUserUI() {
  showDebugLog('🖼️ updateUserUI呼び出し: currentUser=' + (currentUser ? currentUser.displayName : 'null'));

  const userBtn = document.getElementById('btn-user');
  const userName = document.getElementById('user-name');
  const loginBtn = document.getElementById('btn-google-login');
  const syncButtons = document.getElementById('sync-buttons');
  const syncText = document.getElementById('sync-text');
  const syncIcon = document.querySelector('.sync-icon');
  const realtimeSyncBadge = document.getElementById('realtime-sync-badge');

  showDebugLog('🔍 DOM要素: userBtn=' + (userBtn ? 'あり' : 'なし') + ', userName=' + (userName ? 'あり' : 'なし'));

  if (currentUser) {
    showDebugLog('✅ ログインUI表示: ' + currentUser.displayName);
    if (userBtn) userBtn.classList.add('logged-in');
    if (userName) userName.textContent = currentUser.displayName?.split(' ')[0] || 'ユーザー';
    const userIcon = document.querySelector('.user-icon');
    if (userIcon) userIcon.textContent = '✓';
    if (loginBtn) loginBtn.style.display = 'none';
    if (syncButtons) syncButtons.style.display = 'flex';
    if (syncText) {
      syncText.textContent = 'ログイン中 (' + (currentUser.displayName || 'ユーザー') + ')';
      syncText.classList.add('synced');
    }
    if (syncIcon) syncIcon.textContent = '✅';
    if (realtimeSyncBadge) realtimeSyncBadge.style.display = 'inline-block';
  } else {
    showDebugLog('❌ ログアウトUI表示');
    if (userBtn) userBtn.classList.remove('logged-in');
    if (userName) userName.textContent = 'ログイン';
    const userIcon = document.querySelector('.user-icon');
    if (userIcon) userIcon.textContent = '👤';
    if (loginBtn) loginBtn.style.display = 'block';
    if (syncButtons) syncButtons.style.display = 'none';
    if (syncText) {
      syncText.textContent = '未ログイン';
      syncText.classList.remove('synced');
    }
    if (syncIcon) syncIcon.textContent = '☁️';
    if (realtimeSyncBadge) realtimeSyncBadge.style.display = 'none';
  }
}

// Googleログイン（スマホ対応）
async function loginWithGoogle() {
  if (!auth) {
    alert('Firebase未設定です。設定を確認してください。');
    return;
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();

    // 【重要】認証の永続性を LOCAL に設定
    showDebugLog('🔐 ログイン直前に認証永続性をLOCALに設定');
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    showDebugLog('✅ 認証永続性設定完了');

    // モバイル判定（iPhone、iPad、Android）
    const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);

    if (isMobile) {
      // スマホ・タブレット → Redirect方式（画面遷移）
      console.log('[loginWithGoogle] use redirect (mobile)');
      showDebugLog('📱 スマホ環境: リダイレクト方式を使用');
      await auth.signInWithRedirect(provider);
    } else {
      // PC・デスクトップ → Popup方式（ポップアップウィンドウ）
      console.log('[loginWithGoogle] use popup (desktop)');
      showDebugLog('💻 PC環境: ポップアップ方式を使用');
      await auth.signInWithPopup(provider);
    }
  } catch (error) {
    console.error('[loginWithGoogle] error:', error);
    showDebugLog('❌ ログインエラー: ' + error.code + ' - ' + error.message);
    if (error.code === 'auth/popup-closed-by-user') {
      // ユーザーがポップアップを閉じた - 何もしない
      showDebugLog('ℹ️ ユーザーがポップアップを閉じました');
    } else if (error.code === 'auth/popup-blocked') {
      alert('ポップアップがブロックされました。\nブラウザの設定でポップアップを許可してください。');
    } else {
      alert('ログインに失敗しました。\n時間をおいて再度お試しください。');
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

// クラウドからデータを同期（画面をリロード）
async function syncFromCloud() {
  if (!currentUser || !firestoreDb) return;

  try {
    console.log('クラウドからの同期完了');
    // 画面を更新（Firestoreから直接読み込み）
    loadMonthlyData();
  } catch (error) {
    console.error('クラウド同期エラー:', error);
  }
}

// クラウドへデータを同期（不要：常にFirestoreに直接保存）
// この関数はIndexedDB時代の遺物のため削除

// 単一エントリーをクラウドに保存
// 画像をFirebase Storageにアップロード
async function uploadImageToStorage(base64Data, entryId, imageIndex) {
  if (!currentUser || !storage) return null;

  try {
    // base64からBlobに変換
    const response = await fetch(base64Data);
    const blob = await response.blob();

    // ファイルパス: users/{uid}/images/{entryId}_{index}.jpg
    const filePath = `users/${currentUser.uid}/images/${entryId}_${imageIndex}.jpg`;
    const storageRef = storage.ref(filePath);

    // アップロード
    await storageRef.put(blob);

    // 使用量を更新（画像サイズを記録）
    await updateStorageUsage(blob.size);

    // ダウンロードURLを取得
    const downloadUrl = await storageRef.getDownloadURL();
    return downloadUrl;
  } catch (error) {
    console.error('画像アップロードエラー:', error);
    return null;
  }
}

// ストレージ使用量を更新
async function updateStorageUsage(addedBytes) {
  if (!currentUser || !firestoreDb) return;

  try {
    const userDocRef = firestoreDb.collection('users').doc(currentUser.uid);
    const userDoc = await userDocRef.get();

    let currentUsage = 0;
    let imageCount = 0;

    if (userDoc.exists) {
      const data = userDoc.data();
      currentUsage = data.storageUsedBytes || 0;
      imageCount = data.imageCount || 0;
    }

    const newUsage = currentUsage + addedBytes;
    const newCount = imageCount + 1;

    await userDocRef.set({
      storageUsedBytes: newUsage,
      imageCount: newCount,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 使用量チェック（4.5GB超えたら警告）
    const usedGB = newUsage / (1024 * 1024 * 1024);
    if (usedGB > 4.5) {
      showStorageWarning(usedGB);
    }

    // UI更新
    updateStorageDisplay(newUsage, newCount);
  } catch (error) {
    console.error('使用量更新エラー:', error);
  }
}

// Firestoreデータ使用量を計算（新システム）
async function calculateFirestoreUsage() {
  if (!currentUser || !firestoreDb) return 0;

  try {
    const snapshot = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .get();

    let totalBytes = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      // JSON文字列に変換してサイズを測定
      const jsonStr = JSON.stringify(data);
      totalBytes += new Blob([jsonStr]).size;
    });

    return totalBytes;
  } catch (error) {
    console.error('使用量計算エラー:', error);
    return 0;
  }
}

// Firestore使用量表示を更新
async function updateFirestoreUsageDisplay() {
  const display = document.getElementById('storage-usage-display');
  const storageUsageDiv = document.getElementById('storage-usage');
  const warningDiv = document.getElementById('storage-warning');
  const barFill = document.getElementById('storage-bar-fill');

  if (!display || !currentUser) return;

  // 使用量を計算
  const bytes = await calculateFirestoreUsage();
  const mb = bytes / (1024 * 1024);
  const gb = bytes / (1024 * 1024 * 1024);

  // 1GBを基準に%計算
  const percent = (mb / 1000 * 100).toFixed(1);

  let sizeText;
  if (gb >= 1) {
    sizeText = `${gb.toFixed(2)} GB`;
  } else {
    sizeText = `${mb.toFixed(1)} MB`;
  }

  display.innerHTML = `📦 ${sizeText} 使用中 / 1000 MB (${percent}%)`;

  // ストレージバーの色と幅を更新
  if (barFill) {
    const barPercent = Math.min(parseFloat(percent), 100);
    barFill.style.width = `${barPercent}%`;

    // 色を変更
    if (mb > 800) {
      barFill.style.backgroundColor = '#ff4757'; // 赤
      display.style.color = '#ff4757';
    } else if (mb > 500) {
      barFill.style.backgroundColor = '#ffa502'; // オレンジ
      display.style.color = '#ffa502';
    } else {
      barFill.style.backgroundColor = '#26de81'; // 緑
      display.style.color = '#26de81';
    }
  }

  // 800MB超えたら警告表示
  if (mb > 800 && warningDiv) {
    warningDiv.style.display = 'block';
  } else if (warningDiv) {
    warningDiv.style.display = 'none';
  }

  // 表示エリアを表示
  if (storageUsageDiv) {
    storageUsageDiv.style.display = 'block';
  }
}

// ストレージ警告を表示（旧システム・互換性のため残す）
function showStorageWarning(usedGB) {
  const warningDiv = document.createElement('div');
  warningDiv.className = 'storage-warning';
  warningDiv.innerHTML = `
    <span>⚠️ 画像の保存容量が ${usedGB.toFixed(2)}GB / 5GB です。もうすぐ上限です！</span>
    <button onclick="this.parentElement.remove()">×</button>
  `;
  document.body.appendChild(warningDiv);
}

// 使用量表示を更新
function updateStorageDisplay(bytes, count) {
  const display = document.getElementById('storage-usage-display');
  if (!display) return;

  const mb = bytes / (1024 * 1024);
  const gb = bytes / (1024 * 1024 * 1024);

  let sizeText;
  if (gb >= 1) {
    sizeText = `${gb.toFixed(2)} GB`;
  } else {
    sizeText = `${mb.toFixed(1)} MB`;
  }

  const percent = (gb / 5 * 100).toFixed(1);
  display.innerHTML = `📸 ${count}枚 / ${sizeText} 使用中 (${percent}%)`;

  // 80%超えたら色を変える
  if (percent > 80) {
    display.style.color = '#ff6b6b';
  } else if (percent > 50) {
    display.style.color = '#ffd93d';
  } else {
    display.style.color = '#6bcb77';
  }

  // ストレージバーの幅を更新
  const barFill = document.getElementById('storage-bar-fill');
  if (barFill) {
    const barPercent = Math.min(parseFloat(percent), 100);
    barFill.style.width = `${barPercent}%`;

    // バーの色も変える
    if (percent > 80) {
      barFill.style.background = 'linear-gradient(90deg, #ff6b6b, #ee5a5a)';
    } else if (percent > 50) {
      barFill.style.background = 'linear-gradient(90deg, #ffd93d, #f0c929)';
    } else {
      barFill.style.background = 'linear-gradient(90deg, #6bcb77, #4ecdc4)';
    }
  }
}

// 使用量を読み込み
async function loadStorageUsage() {
  if (!currentUser || !firestoreDb) return;

  try {
    const userDoc = await firestoreDb.collection('users').doc(currentUser.uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      updateStorageDisplay(data.storageUsedBytes || 0, data.imageCount || 0);
    }
  } catch (error) {
    console.error('使用量読み込みエラー:', error);
  }
}

// 複数画像をアップロード
async function uploadImagesToStorage(images, entryId) {
  if (!images || images.length === 0) return [];

  const uploadedUrls = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img) continue;

    // すでにURLの場合はそのまま使用
    if (img.startsWith('http')) {
      uploadedUrls.push(img);
    } else if (img.startsWith('data:')) {
      // base64の場合はアップロード
      const url = await uploadImageToStorage(img, entryId, i);
      if (url) uploadedUrls.push(url);
    }
  }
  return uploadedUrls;
}

async function saveEntryToCloud(entry) {
  if (!currentUser || !firestoreDb) return;

  try {
    const cloudEntry = { ...entry };

    // 画像はFirebase Storageを使わず、base64のままFirestoreに保存
    // （一時的な対応：Storageの問題を回避）
    delete cloudEntry.id;
    cloudEntry.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

    const entriesRef = firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries');

    // 新規作成の場合は自動生成ID、編集の場合は既存IDを使用
    if (entry.id) {
      // 編集：既存のIDを文字列に変換
      const docId = String(entry.id);
      await entriesRef.doc(docId).set(cloudEntry, { merge: true });
    } else {
      // 新規作成：Firestoreに自動生成IDで保存
      const docRef = await entriesRef.add(cloudEntry);
      // 自動生成されたIDを返す（今後の編集用）
      return docRef.id;
    }
  } catch (error) {
    console.error('クラウド保存エラー:', error);
    throw error;
  }
}

// クラウドからエントリーを削除
async function deleteEntryFromCloud(entry) {
  if (!currentUser || !firestoreDb) return;

  try {
    // 数値IDを文字列に変換
    const docId = String(entry.id);

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

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let showAllMonths = false;
let currentEntryId = null;
let uploadedImages = [];
let currentOcrData = null;
let allowEntryView = false; // 起動直後はエントリー画面への遷移をブロック
let isSelectionMode = false; // 選択モード
let selectedIds = new Set(); // 選択されたエントリーID

// ========== Firestore データ操作 ==========
async function getEntriesByMonthFromCloud(year, month) {
  if (!currentUser || !firestoreDb) {
    return [];
  }

  try {
    const snapshot = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .where('year', '==', year)
      .where('month', '==', month)
      .get();

    const entries = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      data.id = doc.id;
      // 画像URLをimagesとして使用
      if (data.imageUrls && data.imageUrls.length > 0) {
        data.images = data.imageUrls;
      }
      entries.push(data);
    });

    return entries;
  } catch (error) {
    console.error('Firestore読み込みエラー:', error);
    return [];
  }
}

async function getEntriesByYearFromCloud(year) {
  if (!currentUser || !firestoreDb) {
    return [];
  }

  try {
    const snapshot = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .where('year', '==', year)
      .get();

    const entries = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      data.id = doc.id;
      // 画像URLをimagesとして使用
      if (data.imageUrls && data.imageUrls.length > 0) {
        data.images = data.imageUrls;
      }
      entries.push(data);
    });

    return entries;
  } catch (error) {
    console.error('Firestore読み込みエラー:', error);
    return [];
  }
}

async function getEntryFromCloud(id) {
  if (!currentUser || !firestoreDb) {
    return null;
  }

  try {
    // 数値IDを文字列に変換
    const docId = String(id);

    const doc = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .doc(docId)
      .get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    data.id = doc.id;
    // 画像URLをimagesとして使用
    if (data.imageUrls && data.imageUrls.length > 0) {
      data.images = data.imageUrls;
    }

    return data;
  } catch (error) {
    console.error('Firestore読み込みエラー:', error);
    return null;
  }
}

// ========== 画面表示 ==========
function showMonthlyView() {
  // 選択モード中だったら解除
  if (isSelectionMode) {
    exitSelectionMode();
  }

  document.getElementById('monthly-view').style.display = 'block';
  document.getElementById('entry-view').style.display = 'none';
  document.getElementById('btn-back-header').style.display = 'none';
  document.getElementById('btn-edit').style.display = 'block';
  updateYearDisplay();
  updateMonthButtons();
  loadMonthlyData();
}

function showEntryView(entryId = null) {
  // 起動直後の自動遷移をブロック（安全装置）
  if (!allowEntryView) {
    return;
  }

  // 選択モード中だったら解除
  if (isSelectionMode) {
    exitSelectionMode();
  }

  document.getElementById('monthly-view').style.display = 'none';
  document.getElementById('entry-view').style.display = 'block';
  document.getElementById('btn-back-header').style.display = 'block';
  document.getElementById('btn-edit').style.display = 'none';
  window.scrollTo(0, 0);

  currentEntryId = entryId;
  uploadedImages = [];
  originalImagesForOcr = []; // OCR用元画像もクリア

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
  // Firestore から読み込み（ログイン必須）
  if (!currentUser || !firestoreDb) {
    return; // ログインしていない場合は何もしない
  }

  const yearEntries = await getEntriesByYearFromCloud(currentYear);

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

// ホール名を省略する関数（最大文字数を超えたら...で省略）
function truncateHallName(hallName, maxLength = 12) {
  if (!hallName) return '';
  if (hallName.length <= maxLength) return hallName;
  return hallName.substring(0, maxLength) + '...';
}

async function loadMonthlyData() {
  // Firestore から読み込み（ログイン必須）
  if (!currentUser || !firestoreDb) {
    // ログインしていない場合は空の配列を表示
    const dailyList = document.getElementById('daily-list');
    const emptyMessage = document.getElementById('empty-message');
    const items = dailyList.querySelectorAll('.daily-item');
    items.forEach(item => item.remove());
    emptyMessage.style.display = 'block';
    document.getElementById('total-days').textContent = '0日';
    document.getElementById('monthly-total').textContent = '¥0';
    document.getElementById('monthly-total').className = 'summary-value';
    return;
  }

  let entries;
  if (showAllMonths) {
    entries = await getEntriesByYearFromCloud(currentYear);
  } else {
    entries = await getEntriesByMonthFromCloud(currentYear, currentMonth);
  }

  const dailyList = document.getElementById('daily-list');
  const emptyMessage = document.getElementById('empty-message');

  // 既存のアイテムをクリア（empty-message以外）
  const items = dailyList.querySelectorAll('.daily-item');
  items.forEach(item => item.remove());

  // 選択月ラベル更新
  const monthLabel = document.getElementById('summary-month-label');
  if (showAllMonths) {
    monthLabel.textContent = `${currentYear}年 稼働日数`;
  } else {
    monthLabel.textContent = `${currentMonth}月 稼働日数`;
  }

  if (entries.length === 0) {
    emptyMessage.style.display = 'block';
    document.getElementById('total-days').textContent = '0日';
    document.getElementById('monthly-total').textContent = '¥0';
    document.getElementById('monthly-total').className = 'summary-value';
    return;
  }

  emptyMessage.style.display = 'none';

  // 日付でソート（降順：新しい日付が上）
  entries.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return b.day - a.day;
  });

  let totalBalance = 0;

  entries.forEach(entry => {
    const balance = (entry.out || 0) - (entry.in || 0);
    totalBalance += balance;

    const item = document.createElement('div');
    item.className = 'daily-item';
    item.dataset.id = entry.id;

    // 長押し検出用
    let pressTimer = null;
    item.addEventListener('touchstart', (e) => {
      pressTimer = setTimeout(() => {
        enterSelectionMode(entry.id);
      }, 500);
    });
    item.addEventListener('touchend', () => clearTimeout(pressTimer));
    item.addEventListener('touchmove', () => clearTimeout(pressTimer));

    item.onclick = (e) => {
      if (isSelectionMode) {
        e.preventDefault();
        toggleItemSelection(entry.id);
      } else {
        allowEntryView = true;
        showEntryView(entry.id);
      }
    };

    const thumbSrc = entry.images && entry.images.length > 0
      ? entry.images[0]
      : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect fill="%230f3460" width="100" height="100"/%3E%3Ctext x="50" y="55" text-anchor="middle" fill="%23a0a0a0" font-size="12"%3E-%3C/text%3E%3C/svg%3E';

    const displayBalance = `${balance >= 0 ? '+' : ''}${balance.toLocaleString()}枚`;

    // ホール名の表示（省略処理適用）
    const hallNameDisplay = entry.hall ? `<span class="daily-hall">${truncateHallName(entry.hall)}</span>` : '';

    item.innerHTML = `
      <input type="checkbox" class="selection-checkbox" style="display: none;">
      <img class="daily-thumb" src="${thumbSrc}" alt="">
      <div class="daily-info">
        <p class="daily-date">${entry.month}/${entry.day}${hallNameDisplay}</p>
        <p class="daily-machine">${entry.machine || '未入力'}</p>
      </div>
      <span class="daily-balance ${balance >= 0 ? 'profit' : 'loss'}">
        ${displayBalance}
      </span>
    `;

    dailyList.insertBefore(item, emptyMessage);
  });

  // サマリー更新（同じ日は1日としてカウント）
  const uniqueDays = new Set(entries.map(e => `${e.year}-${e.month}-${e.day}`)).size;
  document.getElementById('total-days').textContent = `${uniqueDays}日`;
  const totalEl = document.getElementById('monthly-total');
  totalEl.textContent = `${totalBalance >= 0 ? '+' : ''}${totalBalance.toLocaleString()}枚`;
  totalEl.className = `summary-value ${totalBalance >= 0 ? 'profit' : 'loss'}`;

  // カレンダーも更新
  renderCalendar(entries);
}

// ========== 選択モード ==========
function enterSelectionMode(firstId = null) {
  isSelectionMode = true;
  selectedIds.clear();
  if (firstId) {
    selectedIds.add(firstId);
  }

  const dailyList = document.getElementById('daily-list');
  dailyList.classList.add('selection-mode');

  // 全アイテムにチェックボックス表示
  dailyList.querySelectorAll('.daily-item').forEach(item => {
    item.classList.add('selection-mode');
    const checkbox = item.querySelector('.selection-checkbox');
    if (checkbox) {
      checkbox.style.display = 'block';
      checkbox.checked = firstId && item.dataset.id == firstId;
      if (firstId && item.dataset.id == firstId) {
        item.classList.add('selected');
      }
    }
  });

  document.getElementById('selection-bar').style.display = 'flex';
  updateSelectionCount();

  // 編集ボタンを「完了」に変更
  const btnEdit = document.getElementById('btn-edit');
  if (btnEdit) {
    btnEdit.textContent = '完了';
  }
}

function exitSelectionMode() {
  isSelectionMode = false;
  selectedIds.clear();

  const dailyList = document.getElementById('daily-list');
  dailyList.classList.remove('selection-mode');

  dailyList.querySelectorAll('.daily-item').forEach(item => {
    item.classList.remove('selection-mode', 'selected');
    const checkbox = item.querySelector('.selection-checkbox');
    if (checkbox) {
      checkbox.style.display = 'none';
      checkbox.checked = false;
    }
  });

  document.getElementById('selection-bar').style.display = 'none';

  // 編集ボタンを「編集」に戻す
  const btnEdit = document.getElementById('btn-edit');
  if (btnEdit) {
    btnEdit.textContent = '編集';
  }
}

function toggleItemSelection(id) {
  const item = document.querySelector(`.daily-item[data-id="${id}"]`);
  const checkbox = item?.querySelector('.selection-checkbox');

  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    item?.classList.remove('selected');
    if (checkbox) checkbox.checked = false;
  } else {
    selectedIds.add(id);
    item?.classList.add('selected');
    if (checkbox) checkbox.checked = true;
  }

  updateSelectionCount();
}

function updateSelectionCount() {
  document.getElementById('selection-count').textContent = `${selectedIds.size}件選択中`;
}

async function deleteSelectedEntries() {
  if (selectedIds.size === 0) return;
  if (!currentUser || !firestoreDb) return;

  if (!confirm(`${selectedIds.size}件のデータを削除しますか？`)) return;

  try {
    for (const id of selectedIds) {
      // Firestoreから削除
      const entry = await getEntryFromCloud(id);
      if (entry) {
        await deleteEntryFromCloud(entry);
      }
    }
    showToast(`${selectedIds.size}件削除しました`);
    exitSelectionMode();
    showMonthlyView();
  } catch (error) {
    alert('削除に失敗しました: ' + error.message);
  }
}

// カレンダー表示
function renderCalendar(entries) {
  if (showAllMonths) {
    document.getElementById('calendar-view').style.display = 'none';
    document.querySelector('.view-toggle').style.display = 'none';
    return;
  }
  document.querySelector('.view-toggle').style.display = 'flex';

  // 月表示ラベルを更新
  const monthLabel = document.getElementById('calendar-month-label');
  if (monthLabel) {
    monthLabel.textContent = `${currentYear}年${currentMonth}月`;
  }

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // 月の日数と最初の曜日を取得
  const firstDay = new Date(currentYear, currentMonth - 1, 1);
  const lastDay = new Date(currentYear, currentMonth, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  // エントリーを日付でマップ（同じ日に複数対応）
  const entryMap = {};
  entries.forEach(entry => {
    if (entry.month === currentMonth) {
      if (!entryMap[entry.day]) {
        entryMap[entry.day] = [];
      }
      entryMap[entry.day].push(entry);
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

    const dayEntries = entryMap[day];
    if (dayEntries && dayEntries.length > 0) {
      // 合計収支を計算
      const totalBalance = dayEntries.reduce((sum, e) => sum + ((e.out || 0) - (e.in || 0)), 0);
      cell.classList.add('has-entry');
      cell.classList.add(totalBalance >= 0 ? 'profit' : 'loss');

      // 店舗名（先頭3文字、重複除去）
      const halls = [...new Set(dayEntries.map(e => e.hall).filter(h => h))];
      const hallText = halls.map(h => h.substring(0, 3)).join('/');

      // 複数件ある場合はバッジ表示
      const countBadge = dayEntries.length > 1 ? `<span class="day-count">${dayEntries.length}</span>` : '';
      cell.innerHTML = `
        <span class="day-number">${day}${countBadge}</span>
        <span class="day-hall">${hallText || ''}</span>
        <span class="day-balance ${totalBalance >= 0 ? 'profit' : 'loss'}">${totalBalance >= 0 ? '+' : ''}${(totalBalance / 1000).toFixed(0)}k</span>
      `;
      cell.onclick = () => {
        allowEntryView = true;
        if (dayEntries.length === 1) {
          showEntryView(dayEntries[0].id);
        } else {
          showDayEntriesPopup(dayEntries, currentYear, currentMonth, day);
        }
      };
    } else {
      // データがない日は選択不可
      cell.classList.add('no-data');
      cell.innerHTML = `<span class="day-number">${day}</span>`;
      // onclickは設定しない（選択不可）
    }

    if (isCurrentMonth && day === today.getDate()) {
      cell.classList.add('today');
    }

    grid.appendChild(cell);
  }
}

// カレンダーの月を変更
function changeCalendarMonth(direction) {
  currentMonth += direction;

  // 年をまたぐ処理
  if (currentMonth > 12) {
    currentMonth = 1;
    currentYear += 1;
  } else if (currentMonth < 1) {
    currentMonth = 12;
    currentYear -= 1;
  }

  // 月選択ボタンの状態を更新
  document.querySelectorAll('.month-btn').forEach(btn => {
    btn.classList.remove('active');
    if (parseInt(btn.dataset.month) === currentMonth) {
      btn.classList.add('active');
    }
  });

  // データを再読み込み
  loadMonthlyData();
}

// カレンダーのスワイプ操作を初期化
function initCalendarSwipe() {
  const calendarGrid = document.getElementById('calendar-grid');
  if (!calendarGrid) return;

  let touchStartX = 0;
  let touchEndX = 0;
  let touchStartY = 0;
  let touchEndY = 0;

  calendarGrid.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  calendarGrid.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
  }, { passive: true });

  function handleSwipe() {
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // 横方向のスワイプが縦方向より大きい場合のみ処理
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
      if (diffX > 0) {
        // 右スワイプ → 前月
        changeCalendarMonth(-1);
      } else {
        // 左スワイプ → 次月
        changeCalendarMonth(1);
      }
    }
  }
}

// 同じ日の複数エントリを選択するポップアップ
function showDayEntriesPopup(entries, year, month, day) {
  // 既存のポップアップがあれば削除
  const existingPopup = document.querySelector('.day-entries-popup');
  if (existingPopup) existingPopup.remove();

  const popup = document.createElement('div');
  popup.className = 'day-entries-popup';
  popup.innerHTML = `
    <div class="popup-overlay"></div>
    <div class="popup-content">
      <div class="popup-header">
        <h4>${month}月${day}日の記録</h4>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-list">
        ${entries.map(entry => {
          const balance = (entry.out || 0) - (entry.in || 0);
          const balanceClass = balance >= 0 ? 'profit' : 'loss';
          return `
            <div class="popup-item" data-id="${entry.id}">
              <div class="popup-item-info">
                <span class="popup-item-hall">${entry.hall || '店舗未入力'}</span>
                <span class="popup-item-machine">${entry.machine || '機種未入力'}</span>
              </div>
              <span class="popup-item-balance ${balanceClass}">${balance >= 0 ? '+' : ''}${balance.toLocaleString()}枚</span>
            </div>
          `;
        }).join('')}
      </div>
      <button class="btn btn-secondary popup-add-btn">+ この日に追加</button>
    </div>
  `;

  document.body.appendChild(popup);

  // イベント設定
  popup.querySelector('.popup-overlay').onclick = () => popup.remove();
  popup.querySelector('.popup-close').onclick = () => popup.remove();
  popup.querySelectorAll('.popup-item').forEach(item => {
    item.onclick = () => {
      popup.remove();
      showEntryView(item.dataset.id);
    };
  });
  popup.querySelector('.popup-add-btn').onclick = () => {
    popup.remove();
    showEntryView(null);
    document.getElementById('entry-date').textContent = `${year}年${month}月${day}日`;
    document.getElementById('date-input').value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
}

// 特定の日付でエントリーを開く
async function openEntryForDate(year, month, day) {
  if (!currentUser || !firestoreDb) return;

  const entries = await getEntriesByMonthFromCloud(year, month);
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
  // Firestore から読み込み（ログイン必須）
  if (!currentUser || !firestoreDb) {
    return; // ログインしていない場合は何もしない
  }

  const entry = await getEntryFromCloud(id);
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
  if (entry.hours) {
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
  document.getElementById('memo').value = '';
  document.getElementById('blog-content').value = '';
  document.getElementById('blog-output').style.display = 'none';
  document.getElementById('ocr-result').style.display = 'none';
  document.getElementById('btn-ocr').style.display = 'none';
  document.getElementById('machine-stats').style.display = 'none';
  uploadedImages = [null, null, null, null, null];
  currentOcrData = null;
  renderDropZonePreviews();
  updateBalance();
}

function updateBalance() {
  const inValue = parseInt(document.getElementById('input-in').value) || 0;
  const outValue = parseInt(document.getElementById('input-out').value) || 0;
  const balance = outValue - inValue;

  // 差枚表示
  const balanceEl = document.getElementById('balance-value');
  balanceEl.textContent = `${balance >= 0 ? '+' : ''}${balance.toLocaleString()}枚`;
  balanceEl.className = `balance-value ${balance >= 0 ? 'profit' : 'loss'}`;

  // 時給表示
  updateHourlyRate();
}

function updateHourlyRate() {
  const inValue = parseInt(document.getElementById('input-in').value) || 0;
  const outValue = parseInt(document.getElementById('input-out').value) || 0;
  const balance = outValue - inValue;
  const hours = parseInt(document.getElementById('input-hours').value) || 1;
  const minutes = parseInt(document.getElementById('input-minutes').value) || 0;
  const totalHours = hours + minutes / 60;

  const hourlyRate = Math.round(balance / totalHours);
  const hourlyRateEl = document.getElementById('hourly-rate');

  if (balance !== 0) {
    hourlyRateEl.textContent = `（時給 ${hourlyRate >= 0 ? '+' : ''}${hourlyRate.toLocaleString()}枚）`;
    hourlyRateEl.className = `hourly-rate ${hourlyRate >= 0 ? 'profit' : 'loss'}`;
  } else {
    hourlyRateEl.textContent = '';
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

// 画像圧縮関数（1200px以下は圧縮しない、それ以上は縮小 + 品質80%）
async function compressImage(base64Data) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // 幅が500pxより大きい場合のみリサイズ
      if (width > 500) {
        height = (height * 500) / width;
        width = 500;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // JPEG形式、品質50%で圧縮
      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.5);
      resolve(compressedBase64);
    };
    img.src = base64Data;
  });
}

// 元画像を一時保存する配列（OCR用）
let originalImagesForOcr = [];

function handleFiles(files) {
  const maxImages = 5;
  const currentCount = uploadedImages.filter(img => img).length;
  const availableSlots = maxImages - currentCount;

  // 既に5枚アップロード済みの場合
  if (currentCount >= maxImages) {
    alert('画像は最大5枚までです');
    return;
  }

  // 追加しようとしている枚数が制限を超える場合
  if (files.length > availableSlots) {
    alert(`画像は最大5枚までです（残り${availableSlots}枚追加できます）`);
  }

  Array.from(files).slice(0, availableSlots).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const originalImage = e.target.result;

      // 元画像をOCR用に一時保存
      originalImagesForOcr.push(originalImage);

      // 画像を圧縮
      const compressedImage = await compressImage(originalImage);

      // 圧縮後の画像を表示用・保存用に格納
      const emptyIndex = uploadedImages.findIndex((img, i) => !img);
      if (emptyIndex !== -1) {
        uploadedImages[emptyIndex] = compressedImage;
      } else if (uploadedImages.length < maxImages) {
        uploadedImages.push(compressedImage);
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
      <img src="${img}" alt="画像${index + 1}" data-index="${index}">
      <button class="thumb-remove" data-index="${index}">×</button>
    `;
    container.appendChild(thumbItem);
  });

  // 画像タップで拡大表示
  container.querySelectorAll('.thumb-item img').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      showImageModal(img.src);
    });
  });

  // 削除ボタンのイベント
  container.querySelectorAll('.thumb-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      removeImage(index);
    });
  });

  // 5枚到達時のUI制御
  updateUploadZoneState();
}

// アップロードゾーンの状態を更新（5枚制限）
function updateUploadZoneState() {
  const maxImages = 5;
  const currentCount = uploadedImages.filter(img => img).length;
  const mainDropZone = document.getElementById('main-drop-zone');
  const mainInput = document.getElementById('main-drop-input');
  const dropText = mainDropZone?.querySelector('.drop-text');

  if (!mainDropZone || !mainInput) return;

  if (currentCount >= maxImages) {
    // 5枚到達：無効化
    mainDropZone.style.opacity = '0.5';
    mainDropZone.style.pointerEvents = 'none';
    mainInput.disabled = true;
    if (dropText) {
      dropText.textContent = '画像は5枚まで追加済みです';
    }
  } else {
    // 5枚未満：有効化
    mainDropZone.style.opacity = '1';
    mainDropZone.style.pointerEvents = 'auto';
    mainInput.disabled = false;
    if (dropText) {
      dropText.textContent = 'クリックまたはドラッグ＆ドロップで画像を追加';
    }
  }
}

// 画像拡大モーダル
function showImageModal(src) {
  // 既存のモーダルがあれば削除
  const existing = document.getElementById('image-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'image-modal';
  modal.className = 'image-modal';
  modal.innerHTML = `
    <div class="image-modal-content">
      <img src="${src}" alt="拡大画像">
      <button class="image-modal-close">×</button>
    </div>
  `;
  document.body.appendChild(modal);

  // 閉じるボタン
  modal.querySelector('.image-modal-close').addEventListener('click', () => {
    modal.remove();
  });

  // 背景クリックでも閉じる
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function removeImage(index) {
  uploadedImages[index] = null;
  // 元画像も同じindexで削除
  if (originalImagesForOcr[index]) {
    originalImagesForOcr[index] = null;
  }
  // 配列を詰める
  uploadedImages = uploadedImages.filter(img => img);
  originalImagesForOcr = originalImagesForOcr.filter(img => img);
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

// ========== Gemini API直接呼び出し（自動フォールバック対応） ==========
async function callGeminiAPI(prompt, images = []) {
  // 試行するモデルのリスト（失敗したモデルは除外）
  const modelsToTry = [
    GEMINI_MODELS.primary,
    GEMINI_MODELS.fallback1,
    GEMINI_MODELS.fallback2
  ].filter(model => !failedModels.includes(model));

  if (modelsToTry.length === 0) {
    throw new Error('すべてのモデルが使用不可です。しばらく時間をおいてから再度お試しください。');
  }

  let lastError = null;

  // モデルを順番に試す
  for (const modelName of modelsToTry) {
    try {
      console.log(`🔹 Gemini API呼び出し開始: ${modelName}`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;

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
        const errorData = await response.json();
        const errorMsg = errorData.error?.message || 'Unknown error';
        const statusCode = response.status;

        // エラー詳細ログ
        console.error(`❌ Gemini API Error - Model: ${modelName}`);
        console.error(`   HTTPステータス: ${statusCode}`);
        console.error(`   エラーメッセージ: ${errorMsg}`);
        console.error(`   フルレスポンス:`, errorData);

        // エラー種別判定
        const errorType = classifyGeminiError(statusCode, errorMsg, errorData);
        console.error(`   エラー種別: ${errorType}`);

        // 429（クォータ超過）または limit:0 の場合は次のモデルへ
        if (statusCode === 429 || errorMsg.includes('quota') || errorMsg.includes('limit')) {
          console.warn(`⚠️ ${modelName} はクォータ超過。次のモデルを試します...`);
          failedModels.push(modelName);
          lastError = { type: errorType, message: errorMsg, status: statusCode };
          continue; // 次のモデルへ
        }

        // APIキーエラーの場合は即座に失敗
        if (statusCode === 401 || statusCode === 403 || errorMsg.includes('API key')) {
          throw new Error('APIキーが無効です。設定画面で正しいAPIキーを入力してください。');
        }

        // その他のエラーも記録して次へ
        lastError = { type: errorType, message: errorMsg, status: statusCode };
        failedModels.push(modelName);
        continue;
      }

      // 成功した場合
      const data = await response.json();
      currentGeminiModel = modelName; // 成功したモデルを記録
      console.log(`✅ Gemini API成功: ${modelName}`);
      return data.candidates[0].content.parts[0].text;

    } catch (error) {
      console.error(`❌ ${modelName} でエラー発生:`, error);
      lastError = { type: 'NETWORK_ERROR', message: error.message, status: 0 };
      failedModels.push(modelName);
    }
  }

  // すべてのモデルが失敗した場合
  if (lastError) {
    throw new Error(formatGeminiError(lastError));
  }
  throw new Error('Gemini APIの呼び出しに失敗しました。');
}

// エラー種別を判定
function classifyGeminiError(statusCode, message, errorData) {
  if (statusCode === 401 || statusCode === 403 || message.includes('API key')) {
    return 'API_KEY_ERROR';
  }
  if (statusCode === 429 || message.includes('quota') || message.includes('limit')) {
    return 'QUOTA_EXCEEDED';
  }
  if (message.includes('not found') || message.includes('invalid model')) {
    return 'MODEL_INVALID';
  }
  if (statusCode >= 500) {
    return 'SERVER_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

// エラーメッセージをユーザー向けに整形
function formatGeminiError(error) {
  switch (error.type) {
    case 'API_KEY_ERROR':
      return '❌ APIキーが無効です。設定画面で正しいAPIキーを入力してください。';
    case 'QUOTA_EXCEEDED':
      return '⚠️ 無料枠の制限に達しました。しばらく時間をおいてから再度お試しください。';
    case 'MODEL_INVALID':
      return '❌ 使用中のモデルが無効化されました。開発者に連絡してください。';
    case 'SERVER_ERROR':
      return '❌ Google側のサーバーエラーです。しばらく時間をおいてから再度お試しください。';
    case 'NETWORK_ERROR':
      return '❌ ネットワークエラーが発生しました。インターネット接続を確認してください。';
    default:
      return `❌ エラーが発生しました: ${error.message}`;
  }
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
画像に表示されているデータをすべて読み取ってください。

【機種名の判別 - 最重要】
- 画像の上部・ヘッダー部分に表示されている機種名を必ず正確に読み取ってください
- 画像に「ウルトラリミックス」と書いてあれば「ウルトラリミックス」
- 画像に「ディスクアップ2」と書いてあれば「ディスクアップ2」
- 絶対に推測や勝手な判断をしないでください。画像に書いてある文字をそのまま使ってください

【重要】
- 複数枚の画像がある場合、重複データは1つにまとめてください
- 画像に表示されている項目をすべて読み取ってください
- 「器種」「機種」という項目は除外（machine_nameで既に出力するため）

【出力形式】
以下のJSON形式で返してください:
{
  "machine_name": "画像から読み取った機種名",
  "items": [
    {"label": "項目名", "value": "値", "category": "カテゴリ名"},
    {"label": "項目名", "value": "値", "category": "カテゴリ名"}
  ]
}

カテゴリ例: "基本情報", "ボーナス", "小役", "技術介入", "その他" など
項目名は画像に表示されているそのままの名前を使ってください。

JSONのみを返してください。`;

    // OCRには元画像（非圧縮）を使用
    const imagesToUse = originalImagesForOcr.length > 0 ? originalImagesForOcr : validImages;
    const resultText = await callGeminiAPI(prompt, imagesToUse);

    // OCR完了後、元画像はクリア（次回アップロード用）
    originalImagesForOcr = [];

    // JSONを抽出
    const jsonMatch = resultText.match(/```json\s*([\s\S]*?)\s*```/) || resultText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : resultText;
    const data = JSON.parse(jsonStr);

    displayOcrResult(data);

  } catch (error) {
    console.error('❌ OCR Error:', error);

    // エラーメッセージを表示エリアに表示
    const resultDiv = document.getElementById('ocr-result');
    const dataGrid = document.getElementById('ocr-data-grid');

    // エラーメッセージを整形（既にformatGeminiErrorで整形済み）
    const errorMessage = error.message || '読み取りに失敗しました';
    dataGrid.innerHTML = `<div class="ocr-error">${errorMessage}</div>`;
    resultDiv.style.display = 'block';

    // APIキーエラーの場合は設定画面を開く
    if (error.message.includes('APIキー')) {
      setTimeout(() => openSettings(), 1500);
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

  dataGrid.innerHTML = '';

  // 新フォーマット（items配列）の場合
  if (data.items && Array.isArray(data.items)) {
    // 機種名があれば表示＆自動入力
    if (data.machine_name) {
      const machineHeader = document.createElement('div');
      machineHeader.className = 'ocr-category-header';
      machineHeader.textContent = `機種: ${data.machine_name}`;
      dataGrid.appendChild(machineHeader);

      // 機種名を予測入力（常に上書き）
      const machineInput = document.getElementById('machine-name');
      machineInput.value = data.machine_name;
      document.getElementById('btn-clear-machine').style.display = 'flex';
      showMachineStats(data.machine_name);
      showToast(`機種「${data.machine_name}」を予測入力しました`);
    }

    // カテゴリごとにグループ化
    const grouped = {};
    data.items.forEach(item => {
      const cat = item.category || 'その他';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });

    // カテゴリごとに表示
    for (const [categoryName, items] of Object.entries(grouped)) {
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'ocr-category-header';
      categoryHeader.textContent = categoryName;
      dataGrid.appendChild(categoryHeader);

      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'ocr-data-item';
        div.innerHTML = `
          <span class="ocr-data-label">${item.label}</span>
          <span class="ocr-data-value">${item.value}</span>
        `;
        dataGrid.appendChild(div);
      });
    }

    if (data.items.length === 0) {
      dataGrid.innerHTML = '<div class="ocr-error">データを読み取れませんでした</div>';
    }
  } else {
    // 旧フォーマット（キー:値）の場合の互換性
    let itemCount = 0;
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        const item = document.createElement('div');
        item.className = 'ocr-data-item';
        item.innerHTML = `
          <span class="ocr-data-label">${key}</span>
          <span class="ocr-data-value">${value}</span>
        `;
        dataGrid.appendChild(item);
        itemCount++;
      }
    }
    if (itemCount === 0) {
      dataGrid.innerHTML = '<div class="ocr-error">データを読み取れませんでした</div>';
    }
  }

  resultDiv.style.display = 'block';
}

// ========== 保存処理 ==========
let isSaving = false; // 連打防止フラグ

async function saveCurrentEntry() {
  // 連打防止
  if (isSaving) return;
  isSaving = true;

  const saveBtn = document.getElementById('btn-save');

  const dateText = document.getElementById('entry-date').textContent;
  const match = dateText.match(/(\d+)年(\d+)月(\d+)日/);

  if (!match) {
    showToast('日付の形式が不正です');
    isSaving = false;
    return;
  }

  // 必須項目のバリデーション
  const machineInput = document.getElementById('machine-name');
  const inInput = document.getElementById('input-in');
  const outInput = document.getElementById('input-out');

  const machine = machineInput.value.trim();
  const inValue = inInput.value.trim();
  const outValue = outInput.value.trim();

  const errors = [];
  const errorFields = [];

  if (!machine) {
    errors.push('機種名');
    errorFields.push(machineInput);
  }
  if (!inValue) {
    errors.push('IN枚数');
    errorFields.push(inInput);
  }
  if (!outValue) {
    errors.push('OUT枚数');
    errorFields.push(outInput);
  }

  if (errors.length > 0) {
    // エラーフィールドに赤枠をつける
    errorFields.forEach(field => {
      field.style.border = '2px solid #ff4757';
      field.style.backgroundColor = 'rgba(255, 71, 87, 0.1)';
    });

    showToast(`入力項目が不足しています: ${errors.join('、')}`);
    isSaving = false;

    // 2秒後に赤枠を解除
    setTimeout(() => {
      errorFields.forEach(field => {
        field.style.border = '';
        field.style.backgroundColor = '';
      });
    }, 2000);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  const entry = {
    year: parseInt(match[1]),
    month: parseInt(match[2]),
    day: parseInt(match[3]),
    date: `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`,
    hall: document.getElementById('hall-name').value,
    machine: machine,
    in: parseInt(inValue) || 0,
    out: parseInt(outValue) || 0,
    hours: (parseInt(document.getElementById('input-hours').value) || 1) + (parseInt(document.getElementById('input-minutes').value) || 0) / 60,
    memo: document.getElementById('memo').value,
    blog: document.getElementById('blog-content').value,
    images: getValidImages(),
    ocrData: currentOcrData
  };

  if (currentEntryId) {
    entry.id = currentEntryId;
  }

  try {
    if (!currentUser || !firestoreDb) {
      alert('ログインしてください');
      return;
    }

    await saveEntryToCloud(entry);
    showToast('保存しました');

    // 入力したエントリーの年月に移動
    currentYear = entry.year;
    currentMonth = entry.month;
    showAllMonths = false; // 月別表示に切り替え
  } catch (error) {
    console.error('保存エラー:', error);
    alert('保存に失敗しました: ' + error.message);
  } finally {
    isSaving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = '保存する';
    showMonthlyView();
  }
}

async function deleteCurrentEntry() {
  if (!currentEntryId) return;
  if (!currentUser || !firestoreDb) return;

  if (!confirm('このエントリーを削除しますか？')) return;

  try {
    // Firestoreから削除
    const entry = await getEntryFromCloud(currentEntryId);
    if (entry) {
      await deleteEntryFromCloud(entry);
      showToast('削除しました');
    }
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

    const prompt = `以下の実戦データからブログ記事を書いてください。

【重要】ブログ本文のみを出力してください。
- 「承知しました」「それでは」などの前置きは絶対に書かない
- 説明や補足は一切不要
- いきなりブログ本文から始める

【基本情報】
- 機種名: ${machine || '（画像から判断してください）'}
- 投資: ${inAmount.toLocaleString()}枚
- 回収: ${outAmount.toLocaleString()}枚
- 差枚: ${balanceText}枚

【メモ】
${memo || 'なし'}

【文体】
${styleInstructions[blogStyle] || styleInstructions.polite}

【内容】
- スクリーンショットのデータを分析
- 展開や印象的な場面に触れる
- 技術介入成功率が高ければ褒める
- 300〜500文字程度`;

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

async function copyBlog() {
  const blogContent = document.getElementById('blog-content').value;
  try {
    await navigator.clipboard.writeText(blogContent);
    showToast('コピーしました');
  } catch (err) {
    // フォールバック（古いブラウザ用）
    const textarea = document.getElementById('blog-content');
    textarea.select();
    document.execCommand('copy');
    textarea.blur(); // フォーカスを外してキーボードを閉じる
    showToast('コピーしました');
  }
}

// ========== 今日のエントリーを開く ==========
async function openTodaysEntry() {
  if (!currentUser || !firestoreDb) return;

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  // 今日のエントリーが既にあるか確認
  const entries = await getEntriesByMonthFromCloud(year, month);
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
async function getMachineStats(year = null, month = null) {
  if (!currentUser || !firestoreDb) {
    return {};
  }

  let entries;
  if (year && month) {
    entries = await getEntriesByMonthFromCloud(year, month);
  } else if (year) {
    entries = await getEntriesByYearFromCloud(year);
  } else {
    // 全データを取得する場合（複数年分）
    const snapshot = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .get();
    entries = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      data.id = doc.id;
      entries.push(data);
    });
  }
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

// カスタムドロップダウンで機種候補を表示
async function showMachineDropdown() {
  const stats = await getMachineStats();
  const dropdown = document.getElementById('machine-dropdown');
  const machineInput = document.getElementById('machine-name');
  const machineClearBtn = document.getElementById('btn-clear-machine');

  // 回数順でソート
  const sorted = Object.entries(stats).sort((a, b) => b[1].count - a[1].count);

  if (sorted.length === 0) {
    dropdown.innerHTML = '<div class="dropdown-empty">履歴がありません</div>';
  } else {
    dropdown.innerHTML = sorted.map(([machine, data]) =>
      `<div class="dropdown-item" data-value="${machine}">${machine}（${data.count}回）</div>`
    ).join('');

    // 各アイテムにクリックイベント
    dropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        machineInput.value = item.dataset.value;
        machineClearBtn.style.display = 'flex';
        dropdown.style.display = 'none';
        showMachineStats(item.dataset.value);
      });
    });
  }

  dropdown.style.display = 'block';
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
      <span class="machine-stat-value ${balanceClass}">${data.totalBalance >= 0 ? '+' : ''}${data.totalBalance.toLocaleString()}枚</span>
    </div>
    <div class="machine-stat-item">
      <span class="machine-stat-label">平均:</span>
      <span class="machine-stat-value ${avgBalance >= 0 ? 'profit' : 'loss'}">${avgBalance >= 0 ? '+' : ''}${avgBalance.toLocaleString()}枚</span>
    </div>
  `;
  document.getElementById('machine-stats').style.display = 'flex';
}

// ========== ホール統計 ==========
async function getHallStats(year = null, month = null) {
  if (!currentUser || !firestoreDb) {
    return {};
  }

  let entries;
  if (year && month) {
    entries = await getEntriesByMonthFromCloud(year, month);
  } else if (year) {
    entries = await getEntriesByYearFromCloud(year);
  } else {
    // 全データを取得する場合（複数年分）
    const snapshot = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .get();
    entries = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      data.id = doc.id;
      entries.push(data);
    });
  }
  const stats = {};

  entries.forEach(entry => {
    if (!entry.hall) return;
    const hall = entry.hall;

    if (!stats[hall]) {
      stats[hall] = {
        count: 0,
        wins: 0,
        losses: 0,
        totalBalance: 0
      };
    }

    const balance = (entry.out || 0) - (entry.in || 0);
    stats[hall].count++;
    stats[hall].totalBalance += balance;
    if (balance >= 0) {
      stats[hall].wins++;
    } else {
      stats[hall].losses++;
    }
  });

  return stats;
}

// カスタムドロップダウンでホール候補を表示
async function showHallDropdown() {
  const stats = await getHallStats();
  const dropdown = document.getElementById('hall-dropdown');
  const hallInput = document.getElementById('hall-name');
  const hallClearBtn = document.getElementById('btn-clear-hall');

  // 回数順でソート（よく行く店が上）
  const sorted = Object.entries(stats).sort((a, b) => b[1].count - a[1].count);

  if (sorted.length === 0) {
    dropdown.innerHTML = '<div class="dropdown-empty">履歴がありません</div>';
  } else {
    dropdown.innerHTML = sorted.map(([hall, data]) =>
      `<div class="dropdown-item" data-value="${hall}">${hall}</div>`
    ).join('');

    // 各アイテムにクリックイベント
    dropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        hallInput.value = item.dataset.value;
        hallClearBtn.style.display = 'flex';
        dropdown.style.display = 'none';
      });
    });
  }

  dropdown.style.display = 'block';
}

// ========== 彦一分析 ==========
async function generateHikoichiAnalysis() {
  const validImages = getValidImages();
  const btn = document.getElementById('btn-hikoichi');
  const outputDiv = document.getElementById('hikoichi-output');
  const contentDiv = document.getElementById('hikoichi-content');

  // データチェック
  const inAmount = parseInt(document.getElementById('input-in').value) || 0;
  const outAmount = parseInt(document.getElementById('input-out').value) || 0;
  const hasData = validImages.length > 0 || inAmount > 0 || outAmount > 0;

  if (!hasData) {
    alert('実戦データを入力してください\n（スクリーンショット または 投資/回収）');
    return;
  }

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
      statsText = `\n【この機種の過去データ】\n- 実戦回数: ${machineData.count}回\n- 勝率: ${winRate}%\n- 累計差枚: ${machineData.totalBalance.toLocaleString()}枚`;
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
- 投資: ${inAmount.toLocaleString()}枚
- 回収: ${outAmount.toLocaleString()}枚
- 差枚: ${balanceText}枚${statsText}${memoSection}

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

let currentChartType = 'monthly';
let currentChartPeriod = 'year';

async function showChart(chartType = 'monthly', period = null) {
  document.getElementById('chart-modal').style.display = 'flex';
  currentChartType = chartType;

  const ctx = document.getElementById('balance-chart').getContext('2d');
  const periodToggle = document.getElementById('chart-period-toggle');

  if (balanceChart) {
    balanceChart.destroy();
  }

  // 機種別・店舗別の場合は期間切り替えを表示
  if (chartType === 'machine' || chartType === 'hall') {
    periodToggle.style.display = 'flex';
    // 「今月」ボタンのラベルを更新
    periodToggle.querySelector('[data-period="month"]').textContent = `${currentMonth}月`;
    if (period) currentChartPeriod = period;
  } else {
    periodToggle.style.display = 'none';
  }

  // 機種別グラフ
  if (chartType === 'machine') {
    await showMachineChart(ctx, currentChartPeriod);
    return;
  }

  // 店舗別グラフ
  if (chartType === 'hall') {
    await showHallChart(ctx, currentChartPeriod);
    return;
  }

  if (!currentUser || !firestoreDb) {
    return;
  }

  const entries = await getEntriesByYearFromCloud(currentYear);

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

// 機種別グラフ表示
async function showMachineChart(ctx, period = 'year') {
  let stats;
  let periodLabel;
  if (period === 'month') {
    stats = await getMachineStats(currentYear, currentMonth);
    periodLabel = `${currentMonth}月`;
  } else {
    stats = await getMachineStats(currentYear);
    periodLabel = `${currentYear}年`;
  }

  // 累計差枚でソート（上位10機種）
  const sorted = Object.entries(stats)
    .sort((a, b) => Math.abs(b[1].totalBalance) - Math.abs(a[1].totalBalance))
    .slice(0, 10);

  if (sorted.length === 0) {
    balanceChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['データなし'],
        datasets: [{
          label: '機種別収支',
          data: [0],
          backgroundColor: 'rgba(128, 128, 128, 0.6)',
          borderColor: '#808080',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        }
      }
    });
    return;
  }

  const labels = sorted.map(([machine]) => {
    // 長い機種名は省略
    return machine.length > 8 ? machine.substring(0, 7) + '…' : machine;
  });
  const balanceData = sorted.map(([, data]) => data.totalBalance);
  const winRateData = sorted.map(([, data]) =>
    data.count > 0 ? Math.round((data.wins / data.count) * 100) : 0
  );
  const countData = sorted.map(([, data]) => data.count);

  balanceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '累計差枚',
        data: balanceData,
        backgroundColor: balanceData.map(val => val >= 0 ? 'rgba(0, 255, 136, 0.6)' : 'rgba(255, 71, 87, 0.6)'),
        borderColor: balanceData.map(val => val >= 0 ? '#00ff88' : '#ff4757'),
        borderWidth: 2,
        yAxisID: 'y'
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            afterLabel: function(context) {
              const index = context.dataIndex;
              const machine = sorted[index][0];
              const data = sorted[index][1];
              const winRate = data.count > 0 ? Math.round((data.wins / data.count) * 100) : 0;
              return [
                `実戦: ${data.count}回`,
                `勝率: ${winRate}%`,
                `平均: ${Math.round(data.totalBalance / data.count).toLocaleString()}枚`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#a0a0a0',
            callback: (value) => (value / 1000) + 'k'
          }
        },
        y: {
          grid: {
            display: false
          },
          ticks: {
            color: '#a0a0a0',
            font: {
              size: 11
            }
          }
        }
      }
    }
  });
}

// 店舗別グラフ表示
async function showHallChart(ctx, period = 'year') {
  let stats;
  let periodLabel;
  if (period === 'month') {
    stats = await getHallStats(currentYear, currentMonth);
    periodLabel = `${currentMonth}月`;
  } else {
    stats = await getHallStats(currentYear);
    periodLabel = `${currentYear}年`;
  }

  // 来店回数でソート（上位10店舗）
  const sorted = Object.entries(stats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  if (sorted.length === 0) {
    balanceChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['データなし'],
        datasets: [{
          label: '店舗別',
          data: [0],
          backgroundColor: 'rgba(128, 128, 128, 0.6)',
          borderColor: '#808080',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        }
      }
    });
    return;
  }

  const labels = sorted.map(([hall]) => {
    // 長い店名は省略
    return hall.length > 10 ? hall.substring(0, 9) + '…' : hall;
  });
  const winRateData = sorted.map(([, data]) =>
    data.count > 0 ? Math.round((data.wins / data.count) * 100) : 0
  );

  balanceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '勝率',
        data: winRateData,
        backgroundColor: winRateData.map(val => {
          if (val >= 50) return 'rgba(0, 255, 136, 0.6)';
          if (val >= 30) return 'rgba(255, 193, 7, 0.6)';
          return 'rgba(255, 71, 87, 0.6)';
        }),
        borderColor: winRateData.map(val => {
          if (val >= 50) return '#00ff88';
          if (val >= 30) return '#ffc107';
          return '#ff4757';
        }),
        borderWidth: 2
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `勝率: ${context.raw}%`;
            },
            afterLabel: function(context) {
              const index = context.dataIndex;
              const data = sorted[index][1];
              const avgBalance = data.count > 0 ? Math.round(data.totalBalance / data.count) : 0;
              return [
                `来店: ${data.count}回`,
                `勝ち: ${data.wins}回 / 負け: ${data.losses}回`,
                `累計: ${data.totalBalance >= 0 ? '+' : ''}${data.totalBalance.toLocaleString()}枚`,
                `平均: ${avgBalance >= 0 ? '+' : ''}${avgBalance.toLocaleString()}枚`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          min: 0,
          max: 100,
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#a0a0a0',
            callback: (value) => value + '%'
          }
        },
        y: {
          grid: {
            display: false
          },
          ticks: {
            color: '#a0a0a0',
            font: {
              size: 11
            }
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
  // Firebase初期化
  await initFirebase();

  // 起動時に一覧画面を表示
  showMonthlyView();

  // 3秒後にエントリー画面への遷移を許可（初期ロード・同期完了を待つ）
  setTimeout(() => {
    allowEntryView = true;
  }, 3000);

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
  // 期間切り替え（年間/今月）
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentChartPeriod = btn.dataset.period;
      showChart(currentChartType, currentChartPeriod);
    });
  });

  // 選択モード
  document.getElementById('btn-edit').addEventListener('click', () => {
    if (isSelectionMode) {
      exitSelectionMode();
    } else {
      enterSelectionMode();
    }
  });
  document.getElementById('btn-cancel-selection').addEventListener('click', exitSelectionMode);
  document.getElementById('btn-delete-selected').addEventListener('click', deleteSelectedEntries);

  // エントリー操作（ユーザー操作時は即座に許可）
  document.getElementById('btn-add-entry').addEventListener('click', () => {
    allowEntryView = true;
    showEntryView();
  });
  document.getElementById('btn-back-header').addEventListener('click', showMonthlyView);
  document.getElementById('btn-save').addEventListener('click', saveCurrentEntry);
  document.getElementById('btn-delete').addEventListener('click', deleteCurrentEntry);
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('入力内容をすべてリセットしますか？')) {
      clearEntryForm();
      showToast('リセットしました');
    }
  });

  // 日付変更
  const dateInput = document.getElementById('date-input');
  dateInput.addEventListener('change', (e) => {
    const date = new Date(e.target.value);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    document.getElementById('entry-date').textContent = `${year}年${month}月${day}日`;
  });

  // 日付エリアクリックでピッカーを開く（PC対応）
  document.querySelector('.date-picker-wrapper').addEventListener('click', () => {
    dateInput.showPicker ? dateInput.showPicker() : dateInput.focus();
  });

  // ドロップゾーン初期化
  initDropZones();

  // OCRボタン
  document.getElementById('btn-ocr').addEventListener('click', performOcr);

  // IN/OUT入力時の収支計算
  document.getElementById('input-in').addEventListener('input', updateBalance);
  document.getElementById('input-out').addEventListener('input', updateBalance);

  // 稼働時間変更時の時給更新
  document.getElementById('input-hours').addEventListener('change', updateHourlyRate);
  document.getElementById('input-minutes').addEventListener('change', updateHourlyRate);

  // 機種名入力（カスタムドロップダウン）
  const machineInput = document.getElementById('machine-name');
  const machineClearBtn = document.getElementById('btn-clear-machine');
  const machineDropdownBtn = document.getElementById('btn-machine-dropdown');
  const machineDropdown = document.getElementById('machine-dropdown');

  machineInput.addEventListener('input', () => {
    showMachineStats(machineInput.value);
    machineClearBtn.style.display = machineInput.value ? 'flex' : 'none';
  });

  // ドロップダウンボタンクリックで候補表示
  machineDropdownBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (machineDropdown.style.display === 'none') {
      await showMachineDropdown();
    } else {
      machineDropdown.style.display = 'none';
    }
  });

  // クリアボタン（機種名）
  machineClearBtn.addEventListener('click', () => {
    machineInput.value = '';
    machineClearBtn.style.display = 'none';
    machineDropdown.style.display = 'none';
    document.getElementById('machine-stats').style.display = 'none';
  });

  // 機種名入力欄：IME対応（Enterキーでキーボードを閉じる）
  let isComposingMachine = false;
  machineInput.addEventListener('compositionstart', () => {
    isComposingMachine = true;
  });
  machineInput.addEventListener('compositionend', () => {
    isComposingMachine = false;
  });
  machineInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (isComposingMachine) {
        // IME変換の確定なので、アプリ側のEnter処理はしない
        return;
      }
      e.preventDefault();
      e.target.blur();
    }
  });

  // 外部クリックで機種ドロップダウンを閉じる
  document.addEventListener('click', (e) => {
    if (!machineDropdown.contains(e.target) && e.target !== machineDropdownBtn && e.target !== machineInput) {
      machineDropdown.style.display = 'none';
    }
  });

  // ホール名入力（カスタムドロップダウン）
  const hallInput = document.getElementById('hall-name');
  const hallClearBtn = document.getElementById('btn-clear-hall');
  const hallDropdownBtn = document.getElementById('btn-hall-dropdown');
  const hallDropdown = document.getElementById('hall-dropdown');

  hallInput.addEventListener('input', () => {
    hallClearBtn.style.display = hallInput.value ? 'flex' : 'none';
  });

  // ドロップダウンボタンクリックで候補表示
  hallDropdownBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (hallDropdown.style.display === 'none') {
      await showHallDropdown();
    } else {
      hallDropdown.style.display = 'none';
    }
  });

  // クリアボタン（ホール名）
  hallClearBtn.addEventListener('click', () => {
    hallInput.value = '';
    hallClearBtn.style.display = 'none';
    hallDropdown.style.display = 'none';
  });

  // ホール名入力欄：IME対応（Enterキーでキーボードを閉じる）
  let isComposingHall = false;
  hallInput.addEventListener('compositionstart', () => {
    isComposingHall = true;
  });
  hallInput.addEventListener('compositionend', () => {
    isComposingHall = false;
  });
  hallInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (isComposingHall) {
        // IME変換の確定なので、アプリ側のEnter処理はしない
        return;
      }
      e.preventDefault();
      e.target.blur();
    }
  });

  // 外部クリックでドロップダウンを閉じる
  document.addEventListener('click', (e) => {
    if (!hallDropdown.contains(e.target) && e.target !== hallDropdownBtn && e.target !== hallInput) {
      hallDropdown.style.display = 'none';
    }
  });

  // 彦一分析
  document.getElementById('btn-hikoichi').addEventListener('click', generateHikoichiAnalysis);

  // ブログ生成
  document.getElementById('btn-generate-blog').addEventListener('click', generateBlog);
  document.getElementById('btn-copy-blog').addEventListener('click', copyBlog);

  // ロゴクリックで一覧画面へ
  document.getElementById('logo-title').addEventListener('click', showMonthlyView);

  // カレンダーの月移動（矢印ボタン）
  document.getElementById('btn-calendar-prev').addEventListener('click', () => {
    changeCalendarMonth(-1);
  });

  document.getElementById('btn-calendar-next').addEventListener('click', () => {
    changeCalendarMonth(1);
  });

  // カレンダーのスワイプ操作
  initCalendarSwipe();

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
  document.getElementById('btn-manual-sync').addEventListener('click', async () => {
    const btn = document.getElementById('btn-manual-sync');
    btn.disabled = true;
    btn.textContent = '同期中...';
    try {
      await syncFromCloud();
      await syncToCloud();
      showToast('同期完了しました');
    } catch (error) {
      showToast('同期に失敗しました');
    }
    btn.disabled = false;
    btn.textContent = '🔄 今すぐ同期';
  });

  // バックアップ機能（要素が存在する場合のみ）
  const exportBtn = document.getElementById('btn-export');
  const importBtn = document.getElementById('btn-import');
  const importFile = document.getElementById('import-file');

  if (exportBtn) exportBtn.addEventListener('click', exportData);
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
  }
  if (importFile) {
    importFile.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        importData(e.target.files[0]);
        e.target.value = ''; // リセット
      }
    });
  }

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
  // 背景のスクロールを無効化
  document.body.style.overflow = 'hidden';
  // ログイン中は使用量を更新
  if (currentUser) {
    updateFirestoreUsageDisplay();
  }
}

function closeSettings() {
  // APIキー未設定なら閉じられない
  if (!geminiApiKey) {
    alert('APIキーを入力して保存してください');
    return;
  }
  document.getElementById('settings-modal').style.display = 'none';
  // 背景のスクロールを再度有効化
  document.body.style.overflow = '';
}

async function saveSettings() {
  const apiKey = document.getElementById('api-key-input').value.trim();

  if (apiKey) {
    geminiApiKey = apiKey;
    localStorage.setItem('gemini_api_key', apiKey);
    // ログイン中ならFirestoreにも保存
    if (currentUser && firestoreDb) {
      try {
        await firestoreDb.collection('users').doc(currentUser.uid).set({
          apiKey: apiKey
        }, { merge: true });
      } catch (e) {
        console.error('APIキーのクラウド保存エラー:', e);
      }
    }
    showToast('設定を保存しました');
    document.getElementById('settings-modal').style.display = 'none';
    // 背景のスクロールを再度有効化
    document.body.style.overflow = '';
  } else {
    showToast('Gemini APIキーを入力してください', true);
  }
}

// トースト通知（自動で消える）
function showToast(message, isError = false) {
  // 既存のトーストを削除
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = message;
  document.body.appendChild(toast);

  // アニメーション
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
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
  if (!currentUser || !firestoreDb) {
    alert('ログインしてください');
    return;
  }

  // 全データを取得
  const snapshot = await firestoreDb
    .collection('users')
    .doc(currentUser.uid)
    .collection('entries')
    .get();
  const entries = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    data.id = doc.id;
    entries.push(data);
  });
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
    if (!currentUser || !firestoreDb) {
      alert('ログインしてください');
      return;
    }

    for (const entry of data.entries) {
      await saveEntryToCloud(entry);
    }

    alert(`${count}件のデータをインポートしました`);
    showMonthlyView();
  } catch (error) {
    alert('インポートに失敗しました: ' + error.message);
  }
}

// グローバル関数（onclick用）
window.removeImage = removeImage;

// ========== Service Worker ==========
// 【開発中】PWAキャッシュを完全に無効化
// 本番前に再度有効化する場合: 以下のブロック全体をコメントアウトして、
// 代わりに次のコードを使用してください:
//
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js')
//       .then(reg => console.log('✅ Service Worker registered:', reg.scope))
//       .catch(err => console.log('❌ Service Worker registration failed:', err));
//   });
// }
//
console.log('🚫 [開発モード] Service Workerを無効化中...');
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    if (registrations.length > 0) {
      console.log(`🗑️ ${registrations.length}個のService Workerを削除します`);
      for (const registration of registrations) {
        registration.unregister().then(() => {
          console.log('✅ Service Worker削除完了:', registration.scope);
        });
      }
    } else {
      console.log('✅ 削除するService Workerはありません');
    }
  });

  // キャッシュも全削除
  caches.keys().then((cacheNames) => {
    if (cacheNames.length > 0) {
      console.log(`🗑️ ${cacheNames.length}個のキャッシュを削除します`);
      return Promise.all(
        cacheNames.map((cacheName) => {
          return caches.delete(cacheName).then(() => {
            console.log('✅ キャッシュ削除完了:', cacheName);
          });
        })
      );
    } else {
      console.log('✅ 削除するキャッシュはありません');
    }
  });
}
console.log('✅ [開発モード] PWA無効化処理完了 - 毎回最新版が表示されます');
