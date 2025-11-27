// ========== データバックアップ機能 ==========

// エクスポート（JSON形式でダウンロード）
async function exportDataToJSON() {
  if (!currentUser) {
    alert('❌ ログインが必要です');
    return;
  }

  try {
    console.log('📥 データエクスポート開始...');

    // Firestoreから全データを取得
    const snapshot = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .get();

    if (snapshot.empty) {
      alert('⚠️ エクスポートするデータがありません');
      return;
    }

    const entries = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      data.id = doc.id;

      // 🔴 重要：画像はURLのみ保持（base64は完全に除外）
      // imageUrlsがあればそれを使用、なければimagesから抽出
      if (data.imageUrls && data.imageUrls.length > 0) {
        data.images = data.imageUrls;  // Storage URL
      } else if (data.images && data.images.length > 0) {
        // imagesがbase64の場合は除外（URLのみ）
        data.images = data.images.filter(img =>
          typeof img === 'string' && img.startsWith('http')
        );
      } else {
        data.images = [];
      }

      // imageUrlsフィールドも同様に
      if (!data.imageUrls || data.imageUrls.length === 0) {
        data.imageUrls = data.images;
      }

      // updatedAtをISO文字列に変換
      if (data.updatedAt && data.updatedAt.toDate) {
        data.updatedAt = data.updatedAt.toDate().toISOString();
      } else if (!data.updatedAt) {
        data.updatedAt = new Date().toISOString();
      }

      entries.push(data);
    });

    // JSON形式でまとめる
    const exportData = {
      version: '1.0',
      appName: 'pachi-slo-diary',
      exportedAt: new Date().toISOString(),
      user: {
        uid: currentUser.uid,
        displayName: currentUser.displayName || 'Unknown',
        email: currentUser.email || ''
      },
      entries: entries
    };

    // Blobを使ってダウンロード
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const filename = 'pachi-slo-diary-backup-' + new Date().toISOString().split('T')[0] + '.json';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('✅ ' + entries.length + '件のデータをエクスポートしました');
    alert('✅ ' + entries.length + '件のデータをエクスポートしました');

  } catch (error) {
    console.error('❌ エクスポートエラー:', error);
    alert('❌ エクスポートに失敗しました: ' + error.message);
  }
}

// インポート（JSON → Firestoreに復元）
async function importDataFromJSON(file) {
  if (!currentUser) {
    alert('❌ ログインが必要です');
    return;
  }

  try {
    console.log('📤 データインポート開始...');

    // JSONファイルを読み込み
    const text = await file.text();
    const importData = JSON.parse(text);

    // バリデーション
    if (!importData.version) {
      throw new Error('バージョン情報がありません');
    }

    if (!Array.isArray(importData.entries)) {
      throw new Error('entries が配列ではありません');
    }

    // 🔴 UIDチェック（必須）- 違う場合は即座に拒否
    if (importData.user && importData.user.uid !== currentUser.uid) {
      alert('❌ 別ユーザーのバックアップです。インポートできません。\n\nバックアップのユーザー: ' + (importData.user.displayName || 'Unknown') + '\n現在のユーザー: ' + (currentUser.displayName || 'Unknown'));
      return;  // ここで完全停止
    }

    const entries = importData.entries;

    if (entries.length === 0) {
      alert('⚠️ インポートするデータがありません');
      return;
    }

    // ユーザーに確認ダイアログ
    const confirmed = confirm(entries.length + '件のデータをインポートしますか？\n\n※ 既存データとIDが重複する場合、updatedAtが新しい方が優先されます。');
    if (!confirmed) {
      console.log('インポートをキャンセルしました');
      return;
    }

    // 既存データを取得
    const existingSnapshot = await firestoreDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('entries')
      .get();

    const existingEntries = {};
    existingSnapshot.forEach(doc => {
      const data = doc.data();
      existingEntries[doc.id] = {
        ...data,
        updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date(0)
      };
    });

    let importCount = 0;
    let updateCount = 0;
    let skipCount = 0;

    // エントリーをマージ（updatedAt比較）
    for (const entry of entries) {
      const entryId = String(entry.id);
      const importUpdatedAt = entry.updatedAt ? new Date(entry.updatedAt) : new Date();

      const existing = existingEntries[entryId];
      const existingUpdatedAt = existing ? existing.updatedAt : new Date(0);

      // 🔴 重要：新しいデータのみ保存（ID単位でマージ）
      if (importUpdatedAt > existingUpdatedAt) {
        // Firestore用にデータを整形
        const cloudEntry = { ...entry };
        delete cloudEntry.id;
        cloudEntry.updatedAt = firebase.firestore.Timestamp.fromDate(importUpdatedAt);

        // 🔴 Firestoreに保存（マスターデータ）
        await firestoreDb
          .collection('users')
          .doc(currentUser.uid)
          .collection('entries')
          .doc(entryId)
          .set(cloudEntry);

        if (existing) {
          updateCount++;
          console.log('✅ 更新: ' + entryId);
        } else {
          importCount++;
          console.log('✅ 新規追加: ' + entryId);
        }
      } else {
        skipCount++;
        console.log('⏭️ スキップ: ' + entryId + ' (既存データの方が新しい)');
      }
    }

    console.log('✅ インポート完了: 新規' + importCount + '件、更新' + updateCount + '件、スキップ' + skipCount + '件');
    alert('✅ ' + (importCount + updateCount) + '件のデータを復元しました\n\n新規追加: ' + importCount + '件\n更新: ' + updateCount + '件\nスキップ: ' + skipCount + '件');

    // 画面を更新
    loadMonthlyData();

  } catch (error) {
    console.error('❌ インポートエラー:', error);
    alert('❌ インポートに失敗しました: ' + error.message);
  }
}

// イベントリスナーの登録
document.addEventListener('DOMContentLoaded', function() {
  // エクスポートボタン
  const btnExport = document.getElementById('btn-export-data');
  if (btnExport) {
    btnExport.addEventListener('click', exportDataToJSON);
  }

  // インポートボタン
  const btnImport = document.getElementById('btn-import-data');
  const fileInput = document.getElementById('import-file-input');

  if (btnImport && fileInput) {
    btnImport.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        importDataFromJSON(file);
        // ファイル選択をリセット
        fileInput.value = '';
      }
    });
  }
});
