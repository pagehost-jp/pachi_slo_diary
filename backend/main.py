"""
pachi_slo_diary - FastAPI Backend
Gemini API連携でブログ自動生成
"""

import os
import base64
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import google.generativeai as genai

app = FastAPI(title="パチスロ収支ノート API")

# CORS設定（フロントエンドからのアクセス許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 開発用。本番では適切に制限
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gemini API設定
# 環境変数からAPIキーを取得
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


class BlogRequest(BaseModel):
    images: List[str]  # Base64エンコードされた画像
    machine: Optional[str] = ""
    in_amount: Optional[int] = 0
    out_amount: Optional[int] = 0
    memo: Optional[str] = ""
    api_key: Optional[str] = ""
    style: Optional[str] = "polite"  # polite, casual, live


class BlogResponse(BaseModel):
    blog: str


class OcrRequest(BaseModel):
    images: List[str]
    api_key: Optional[str] = ""


class OcrResponse(BaseModel):
    data: dict
    raw_text: str


@app.get("/")
async def root():
    return {"message": "パチスロ収支ノート API", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "ok", "gemini_configured": bool(GEMINI_API_KEY)}


class TestKeyRequest(BaseModel):
    api_key: str


@app.post("/test-api-key")
async def test_api_key(request: TestKeyRequest):
    """APIキーの有効性をテスト"""
    if not request.api_key:
        raise HTTPException(status_code=400, detail="APIキーが指定されていません")

    try:
        genai.configure(api_key=request.api_key)
        model = genai.GenerativeModel('gemini-2.0-flash')
        # 簡単なテストリクエスト
        response = model.generate_content("Say 'OK' in one word.")
        return {"status": "ok", "message": "APIキーは有効です"}
    except Exception as e:
        error_msg = str(e)
        if "API_KEY_INVALID" in error_msg or "API key not valid" in error_msg:
            raise HTTPException(status_code=400, detail="APIキーが無効です。正しいキーを入力してください。")
        raise HTTPException(status_code=500, detail=f"テスト中にエラーが発生しました: {error_msg}")


@app.post("/generate-blog", response_model=BlogResponse)
async def generate_blog(request: BlogRequest):
    api_key = request.api_key or GEMINI_API_KEY
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="APIキーが設定されていません。設定画面から入力してください。"
        )

    try:
        # Geminiモデル初期化（Vision対応）
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.0-flash')

        # 収支計算
        balance = request.out_amount - request.in_amount
        balance_text = f"+{balance:,}" if balance >= 0 else f"{balance:,}"

        # 文体の説明
        style_instructions = {
            "polite": """
【文体指示】
- ですます調で丁寧に書いてください
- 読者に語りかけるような親しみやすい文章で
- 「〜しました」「〜でした」などを使用
- 絵文字は控えめに使ってOK""",
            "casual": """
【文体指示】
- 口語調でラフに書いてください
- 友達に話すようなカジュアルな感じで
- 「〜だったわ」「〜なんだよね」などフランクに
- 堅苦しさゼロで読みやすく""",
            "live": """
【文体指示】
- 実況風・ライブ感のある文体で書いてください
- 「きたああああ！」「うおおお！」など興奮表現OK
- 展開ごとにテンションの波を表現
- スロット専門ブログ風の熱い文章で
- 「ここで神引き！」「設定示唆キター！」などの表現推奨"""
        }

        style_text = style_instructions.get(request.style, style_instructions["polite"])

        # プロンプト作成
        prompt = f"""あなたはパチスロブロガーです。
以下の実戦データのスクリーンショットを分析して、面白くて読みやすいブログ記事を書いてください。

【基本情報】
- 機種名: {request.machine or '（画像から判断してください）'}
- 投資: {request.in_amount:,}円
- 回収: {request.out_amount:,}円
- 収支: {balance_text}円

【メモ】
{request.memo or 'なし'}
{style_text}

【お願い】
1. スクリーンショットのデータ（ゲーム数、BB/RB回数、確率、技術介入成功率、小役カウントなど）を読み取って分析してください
2. 展開や印象的な場面があれば触れてください
3. 技術介入成功率が高ければ褒めてください
4. 300〜500文字程度でまとめてください

ブログ記事:"""

        # 画像データの準備
        contents = [prompt]

        for img_data in request.images:
            # data:image/jpeg;base64,... 形式から base64 部分を抽出
            if ',' in img_data:
                img_base64 = img_data.split(',')[1]
            else:
                img_base64 = img_data

            # MIMEタイプを判定
            if img_data.startswith('data:image/png'):
                mime_type = 'image/png'
            else:
                mime_type = 'image/jpeg'

            contents.append({
                'mime_type': mime_type,
                'data': img_base64
            })

        # Gemini API呼び出し
        response = model.generate_content(contents)

        return BlogResponse(blog=response.text)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"ブログ生成中にエラーが発生しました: {str(e)}"
        )


@app.post("/ocr", response_model=OcrResponse)
async def extract_ocr_data(request: OcrRequest):
    api_key = request.api_key or GEMINI_API_KEY
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="APIキーが設定されていません。設定画面から入力してください。"
        )

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.0-flash')

        prompt = """この画像はパチスロの実戦データ（Qマイスロなど）のスクリーンショットです。
ディスクアップ2またはウルトラリミックスのデータを読み取ってください。

【重要】複数枚の画像がある場合、同じデータが重複している可能性があります。
重複している場合は無視して、ユニークなデータのみを読み取ってください。

読み取るデータ（この6項目のみ）:
- game_count: ゲーム数（数値のみ、例: 2542）
- bb_probability: 総BB確率（例: "1/181.58"）
- rb_probability: RB確率（例: "1/317.75"）
- skill_true_rate: NORMAL-BB中真・技術介入成功率（例: "100.0%"）
- skill_extreme_rate: NORMAL-BB中極・技術介入成功率（例: "33.4%"）
- dance_time_count: DANCE TIME突入回数またはNORMAL-BB後DT突入回数（数値のみ）

JSONのみを返してください。読み取れない項目はnullにしてください。
```json
{
  "game_count": 2542,
  "bb_probability": "1/181.58",
  "rb_probability": "1/317.75",
  "skill_true_rate": "100.0%",
  "skill_extreme_rate": "33.4%",
  "dance_time_count": 3
}
```"""

        contents = [prompt]

        for img_data in request.images:
            if ',' in img_data:
                img_base64 = img_data.split(',')[1]
            else:
                img_base64 = img_data

            if img_data.startswith('data:image/png'):
                mime_type = 'image/png'
            else:
                mime_type = 'image/jpeg'

            contents.append({
                'mime_type': mime_type,
                'data': img_base64
            })

        response = model.generate_content(contents)
        raw_text = response.text

        # JSONを抽出
        import json
        import re
        json_match = re.search(r'```json\s*(.*?)\s*```', raw_text, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(1))
        else:
            # JSONブロックがない場合は直接パース
            data = json.loads(raw_text)

        return OcrResponse(data=data, raw_text=raw_text)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"OCR処理中にエラーが発生しました: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
