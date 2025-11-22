# バックエンドサーバー起動方法

## 1. 依存パッケージをインストール

```bash
cd backend
pip3 install -r requirements.txt
```

## 2. Gemini APIキーを設定

Google AI Studioでキーを取得: https://aistudio.google.com/app/apikey

```bash
export GEMINI_API_KEY="your-api-key-here"
```

## 3. サーバー起動

```bash
python3 main.py
```

または

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## 4. 動作確認

ブラウザで http://localhost:8000 にアクセス
または http://localhost:8000/health でAPIキー設定状況を確認
