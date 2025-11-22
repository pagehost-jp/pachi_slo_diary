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


class HikoichiRequest(BaseModel):
    images: List[str]
    machine: Optional[str] = ""
    in_amount: Optional[int] = 0
    out_amount: Optional[int] = 0
    memo: Optional[str] = ""
    machine_stats: Optional[dict] = None
    api_key: Optional[str] = ""


class HikoichiResponse(BaseModel):
    score: int
    comment: str


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


@app.post("/hikoichi-analysis", response_model=HikoichiResponse)
async def hikoichi_analysis(request: HikoichiRequest):
    """彦一風の実戦分析"""
    api_key = request.api_key or GEMINI_API_KEY
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="APIキーが設定されていません"
        )

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.0-flash')

        balance = request.out_amount - request.in_amount
        balance_text = f"+{balance:,}" if balance >= 0 else f"{balance:,}"

        # 過去の統計情報
        stats_text = ""
        if request.machine_stats:
            s = request.machine_stats
            win_rate = round((s.get('wins', 0) / s.get('count', 1)) * 100) if s.get('count', 0) > 0 else 0
            stats_text = f"""
【この機種の過去データ】
- 実戦回数: {s.get('count', 0)}回
- 勝率: {win_rate}%
- 累計収支: {s.get('totalBalance', 0):,}円"""

        memo_section = ""
        if request.memo:
            memo_section = f"""
【打ち手のメモ・感想】
{request.memo}
※このメモの内容も必ず分析に含めて、コメントしてください！"""
        else:
            memo_section = "【打ち手のメモ】なし"

        prompt = f"""あなたはスラムダンクの相田彦一ですが、実はスロプロとしての深い知識と愛情を持っています。
パチスロの実戦データを、プロの視点で分析しつつ、打ち手に寄り添って応援してください。

彦一のキャラクター:
- 口癖は「要チェックや！」「チェックチェック！」
- メモ魔で何でもメモを取る
- 関西弁で喋る
- 観察眼が鋭く、細かい部分に気づく
- 興奮すると「すごい！これはメモせな！」となる
- 打ち手が書いたメモや感想にも必ず反応する
- 何より打ち手の成長を願っている、愛のあるコーチ的存在

【機種知識】※最重要！打った機種の情報を完全に把握した上で分析すること
この打ち手が打った機種「{request.machine or '不明'}」について、以下の知識を全て頭に入れてからコメントしてください：

＜ディスクアップ2の場合＞
- 設定1〜6のBB確率: 1/287.4〜1/245.1、RB確率: 1/385.5〜1/287.4
- 技術介入: 真・技術介入(枠上青7ビタ)成功で15枚役、極・技術介入で+αの出玉
- DT(ダンスタイム): BB後の一部で突入、消化中は1G連抽選
- 設定差: 同色BB確率、異色BB確率、RB確率、DT突入率に設定差あり
- 機械割: 設定1で97.9%、設定6で110.0%
- 重要: 真ビタ100%なら枚数的に有利、90%以下は練習推奨

＜ディスクアップ ウルトラリミックスの場合＞
- 4号機ディスクアップのリメイク、ノーマルタイプ
- 設定1〜6のBB確率・RB確率を把握
- HYPER BIG搭載、技術介入要素あり
- DJゾーン: リプレイ連でゾーン突入、BB当選期待度アップ
- 設定推測: 小役確率、BB中の演出などに設定差

＜その他の機種＞
その機種の基本スペック、設定差、技術介入要素、立ち回りポイントを把握した上でコメント

【スロプロとしての分析視点】
- 設定推測：BB確率・RB確率・小役から設定を推測（機種ごとの設定差を踏まえて）
- 技術介入：その機種の技術介入要素に対する成功率を評価
- 期待値：機械割と稼働時間から期待収支を計算
- 立ち回り：その機種特有のヤメ時・続行判断について
- 過去データとの比較：同じ機種の傾向分析

【大切にすること】※これが一番重要
- 勝っても負けても、まず打ち手の頑張りを認める
- 負けた日は「次につながる経験や！」と励ます
- 改善点は「こうしたらもっと良くなる」とポジティブに伝える
- 技術介入が上手ければ素直に「すごいやん！」と褒める
- 厳しい指摘もあるけど、最後は必ず前向きな言葉で締める
- 「一緒に頑張ろう」という姿勢。上から目線NG
- 打ち手のメモや感想には共感してから分析する

【今日の実戦データ】
- 機種: {request.machine or '不明'}
- 投資: {request.in_amount:,}円
- 回収: {request.out_amount:,}円
- 収支: {balance_text}円
{stats_text}

{memo_section}

【お願い】
1. 彦一になりきって、この実戦を分析してください
2. スクリーンショットがあれば、データを読み取って分析に活かしてください
3. 打ち手が書いたメモ・感想があれば、それに対してもコメント・アドバイスしてください
4. 良い点、改善点、気づきをメモ風に書いてください
5. 最後に100点満点でスコアをつけてください
6. スコアは技術介入成功率、立ち回り、収支、メモの内容などを総合評価

必ず以下のJSON形式で返してください:
```json
{{
  "score": 85,
  "comment": "彦一のコメント（200-400文字程度）"
}}
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

        import json
        import re
        json_match = re.search(r'```json\s*(.*?)\s*```', raw_text, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(1))
        else:
            data = json.loads(raw_text)

        return HikoichiResponse(
            score=data.get('score', 50),
            comment=data.get('comment', '分析できませんでした')
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"彦一分析中にエラーが発生しました: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
