import { AudioType, AudioMediaType, TextMediaType } from "./types";

export const DefaultInferenceConfiguration = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0.7,
};

export const DefaultAudioInputConfiguration = {
  audioType: "SPEECH" as AudioType,
  encoding: "base64",
  mediaType: "audio/lpcm" as AudioMediaType,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
};

export const DefaultToolSchema = JSON.stringify({
  "type": "object",
  "properties": {},
  "required": []
});

export const WeatherToolSchema = JSON.stringify({
  "type": "object",
  "properties": {
    "latitude": {
      "type": "string",
      "description": "Geographical WGS84 latitude of the location."
    },
    "longitude": {
      "type": "string",
      "description": "Geographical WGS84 longitude of the location."
    }
  },
  "required": ["latitude", "longitude"]
});

export const AvailabilityToolSchema = JSON.stringify({
  "type": "object",
  "properties": {
    "productId": {
      "type": "string",
      "description": "レンタルする商品のID。例: EXC-001"
    },
    "startAt": {
      "type": "string",
      "description": "レンタル開始日時。ISO 8601形式。例: 2026-09-10T09:00:00+09:00"
    },
    "endAt": {
      "type": "string",
      "description": "レンタル終了日時。ISO 8601形式。例: 2026-09-12T18:00:00+09:00"
    }
  },
  "required": ["productId", "startAt", "endAt"]
});

export const ReservationToolSchema = JSON.stringify({
  "type": "object",
  "properties": {
    "productId": {
      "type": "string",
      "description": "レンタルする商品のID。例: EXC-001"
    },
    "startAt": {
      "type": "string",
      "description": "レンタル開始日時。ISO 8601形式。例: 2026-09-10T09:00:00+09:00"
    },
    "endAt": {
      "type": "string",
      "description": "レンタル終了日時。ISO 8601形式。例: 2026-09-12T18:00:00+09:00"
    },
    "customerName": {
      "type": "string",
      "description": "予約者の氏名"
    },
    "confirmed": {
      "type": "boolean",
      "description": "ユーザーが予約内容を確認し、明確に予約を確定する意思を示した場合のみtrue"
    }
  },
  "required": [
    "productId",
    "startAt",
    "endAt",
    "customerName",
    "confirmed"
  ]
});

export const KnowledgeBaseToolSchema = JSON.stringify({
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "建設機械のレンタルに関するユーザーの質問"
    }
  },
  "required": ["query"]
});

export const DefaultTextConfiguration = { mediaType: "text/plain" as TextMediaType };

export const DefaultSystemPrompt = `
あなたは株式会社オオタ機材レンタルの音声アシスタントです。

建設機械のレンタルに関する質問に回答してください。

以下のルールを必ず守ってください。

1. 建設機械の商品情報、型番、料金、営業時間、レンタル条件、在庫、配送、燃料費、オペレーター料金など、会社固有の情報について質問された場合は、必ず search_construction_rental ツールを使用してください。

2. Knowledge Baseから取得した情報を根拠として回答してください。

3. Knowledge Baseに情報がない場合は、推測で回答せず、「確認できませんでした」と伝えてください。

4. レンタル料金について回答するときは、日額・週額・月額など、Knowledge Baseに記載されている料金を正確に伝えてください。

5. Knowledge Baseに記載されている情報と矛盾する内容を推測で補完しないでください。

6. 音声で会話しているため、回答は簡潔で自然な話し言葉にしてください。

7. ユーザーが建設機械とは関係ない質問をした場合は、対応できる範囲を簡潔に説明してください。

8. ユーザーがレンタルを希望した場合、商品・レンタル開始日時・終了日時・氏名を確認してください。

9. レンタル日時が決まったら、必ず check_equipment_availability ツールを使用して空き状況を確認してください。

10. 予約内容が揃ったら、商品名・レンタル日時・氏名をユーザーに復唱して確認してください。

11. ユーザーが明確に予約を確定する意思を示すまで、create_reservation ツールを使用してはいけません。

12. ユーザーが「はい」「お願いします」など、予約内容を確認した明確な意思表示をした場合のみ、confirmed=trueとしてcreate_reservationを使用してください。

13. 予約日時は推測せず、ユーザーから聞いた日時を使用してください。
`;


export const DefaultAudioOutputConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: 24000,
  voiceId: "tiffany",
};
