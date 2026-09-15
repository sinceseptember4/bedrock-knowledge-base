import {
  spawn,
  execFileSync,
  ChildProcessWithoutNullStreams,
} from "child_process";

import { appendFileSync, writeFileSync } from "fs";

import { fromLoginCredentials } from "@aws-sdk/credential-providers";

import {
  NovaSonicBidirectionalStreamClient,
  StreamSession,
} from "./client";

import {
  DefaultAudioInputConfiguration,
  DefaultSystemPrompt,
} from "./consts";

// ========================================
// HFPデバイス
// ========================================

const HFP_SOURCE =
  "bluez_source.08_87_C7_41_A7_8B.headset_audio_gateway";

const HFP_SINK =
  "bluez_sink.08_87_C7_41_A7_8B.headset_audio_gateway";

const AWS_REGION =
  process.env.AWS_REGION || "ap-northeast-1";

// ========================================
// 状態
// ========================================

let session: StreamSession | null = null;

let parec: ChildProcessWithoutNullStreams | null = null;

let inputResampler: ChildProcessWithoutNullStreams | null = null;

let outputResampler: ChildProcessWithoutNullStreams | null = null;

let pacat: ChildProcessWithoutNullStreams | null = null;

let isRunning = false;

// ========================================
// HFP音声デバイス待機
// ========================================

async function waitForHfpAudio(
  timeoutMs = 10000
): Promise<boolean> {
  console.log("⏳ HFP音声デバイスを待機中...");

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const sources = execFileSync(
        "pactl",
        ["list", "short", "sources"],
        {
          encoding: "utf8",
        }
      );

      const sinks = execFileSync(
        "pactl",
        ["list", "short", "sinks"],
        {
          encoding: "utf8",
        }
      );

      const sourceReady = sources.includes(HFP_SOURCE);
      const sinkReady = sinks.includes(HFP_SINK);

      if (sourceReady && sinkReady) {
        console.log("✅ HFP音声デバイス確認OK");
        console.log(`   Source: ${HFP_SOURCE}`);
        console.log(`   Sink:   ${HFP_SINK}`);

        return true;
      }

      if (!sourceReady) {
        console.log("   ⏳ HFP Source待機中...");
      }

      if (!sinkReady) {
        console.log("   ⏳ HFP Sink待機中...");
      }
    } catch (error) {
      console.error(
        "⚠️ PulseAudio確認エラー:",
        error
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 500)
    );
  }

  console.error(
    "❌ HFP音声デバイスが10秒以内に現れませんでした"
  );

  return false;
}

// ========================================
// Nova Sonicセッション開始
// ========================================

export async function startNovaSession() {
  if (isRunning) {
    console.log("⚠️ Novaはすでに起動しています");
    return;
  }

  // ======================================
  // HFPが準備できるまで待つ
  // ======================================

  const hfpReady = await waitForHfpAudio();

  if (!hfpReady) {
    throw new Error(
      "HFP音声デバイスが準備されていません"
    );
  }

  isRunning = true;

  try {
    console.log("🤖 Nova 2 Sonic セッション開始");

    const bedrockClient =
      new NovaSonicBidirectionalStreamClient({
        clientConfig: {
          region: AWS_REGION,

          credentials: fromLoginCredentials({
            profile: "default",
          }),
        },
      });

    const sessionId = `iphone-${Date.now()}`;

    session =
      bedrockClient.createStreamSession(sessionId);

    // ======================================
    // Novaテキスト出力
    // ======================================

    session.onEvent("textOutput", (data) => {
      console.log("📝 Nova:", data);
    });

    // ======================================
    // Novaコンテンツ開始
    // ======================================

    session.onEvent("contentStart", (data) => {
      console.log("📡 contentStart:", data);
    });

    // ======================================
    // Nova音声出力
    // 24kHz → 8kHz → iPhone
    // ======================================

    session.onEvent("audioOutput", (data) => {
      try {
        if (!data?.content) {
          return;
        }

        const audio = Buffer.from(
          data.content,
          "base64"
        );

        if (outputResampler?.stdin.writable) {
          outputResampler.stdin.write(audio);
        }
      } catch (error) {
        console.error(
          "❌ Nova音声処理エラー:",
          error
        );
      }
    });

    // ======================================
    // Novaエラー
    // ======================================

    session.onEvent("error", (data) => {
      console.error("❌ Novaエラー:", data);
    });

    // ======================================
    // ストリーム終了
    // ======================================

    session.onEvent("streamComplete", () => {
      console.log("🛑 Novaストリーム終了");
    });

    // ======================================
    // Novaストリーム開始
    // ======================================

    bedrockClient.initiateBidirectionalStreaming(
      sessionId
    );

    // ======================================
    // セッション開始
    // ======================================

    await session.setupSessionAndPromptStart();

    // ======================================
    // システムプロンプト
    // ======================================

    await session.setupSystemPrompt(
      undefined,
      DefaultSystemPrompt
    );

    // ======================================
    // 音声入力設定
    // iPhone HFP: 8kHz
    // Nova: 16kHz
    // ======================================

    await session.setupStartAudio({
      ...DefaultAudioInputConfiguration,

      sampleRateHertz: 16000,

      sampleSizeBits: 16,

      channelCount: 1,

      encoding: "base64",

      mediaType: "audio/lpcm",
    });

    console.log("✅ Novaセッション準備完了");

    // ======================================
    // 音声パイプライン開始
    // ======================================

    startAudioPipeline();

  } catch (error) {
    isRunning = false;
    session = null;

    console.error(
      "❌ Nova起動失敗:",
      error
    );

    throw error;
  }
}

// ========================================
// 音声パイプライン
//
// iPhone HFP
//    ↓
// PulseAudio
//    ↓
// parec 8kHz
//    ↓
// SoX 16kHz
//    ↓
// Nova
//
// Nova
//    ↓
// 24kHz
//    ↓
// SoX 8kHz
//    ↓
// pacat
//    ↓
// iPhone HFP
// ========================================

function startAudioPipeline() {
  writeFileSync(
    "/tmp/nova-input.raw",
    ""
  );

  console.log(
    "🎙 iPhone HFP → Nova パイプライン開始"
  );

  // ======================================
  // iPhone HFP → Linux
  // 8kHz / 16bit / mono
  // ======================================

  parec = spawn("parec", [
    `--device=${HFP_SOURCE}`,
    "--rate=8000",
    "--channels=1",
    "--format=s16le",
  ]);

  // ======================================
  // 8kHz → 16kHz
  // ======================================

  inputResampler = spawn("sox", [
    "-t",
    "raw",

    "-r",
    "8000",

    "-e",
    "signed-integer",

    "-b",
    "16",

    "-c",
    "1",

    "-",

    "-t",
    "raw",

    "-r",
    "16000",

    "-e",
    "signed-integer",

    "-b",
    "16",

    "-c",
    "1",

    "-",
  ]);

  parec.stdout.pipe(
    inputResampler.stdin
  );

  // ======================================
  // Novaへ音声送信
  // ======================================

  inputResampler.stdout.on(
    "data",
    async (chunk: Buffer) => {
      try {
        // デバッグ用録音
        appendFileSync(
          "/tmp/nova-input.raw",
          chunk
        );

        if (session) {
          await session.streamAudio(
            chunk
          );
        }
      } catch (error) {
        console.error(
          "❌ Nova入力エラー:",
          error
        );
      }
    }
  );

  parec.stderr.on(
    "data",
    (data) => {
      console.error(
        "parec:",
        data.toString()
      );
    }
  );

  inputResampler.stderr.on(
    "data",
    (data) => {
      console.error(
        "sox input:",
        data.toString()
      );
    }
  );

  // ======================================
  // Nova 24kHz → 8kHz
  // ======================================

  outputResampler = spawn("sox", [
    "-t",
    "raw",

    "-r",
    "24000",

    "-e",
    "signed-integer",

    "-b",
    "16",

    "-c",
    "1",

    "-",

    "-t",
    "raw",

    "-r",
    "8000",

    "-e",
    "signed-integer",

    "-b",
    "16",

    "-c",
    "1",

    "-",
  ]);

  // ======================================
  // Linux → iPhone HFP
  // ======================================

  pacat = spawn("pacat", [
    "--playback",

    `--device=${HFP_SINK}`,

    "--raw",

    "--format=s16le",

    "--rate=8000",

    "--channels=1",
  ]);

  outputResampler.stdout.pipe(
    pacat.stdin
  );

  outputResampler.stderr.on(
    "data",
    (data) => {
      console.error(
        "sox output:",
        data.toString()
      );
    }
  );

  pacat.stderr.on(
    "data",
    (data) => {
      console.error(
        "pacat:",
        data.toString()
      );
    }
  );

  // ======================================
  // プロセスエラー監視
  // ======================================

  parec.on("error", (error) => {
    console.error(
      "❌ parec起動エラー:",
      error
    );
  });

  inputResampler.on(
    "error",
    (error) => {
      console.error(
        "❌ input sox起動エラー:",
        error
      );
    }
  );

  outputResampler.on(
    "error",
    (error) => {
      console.error(
        "❌ output sox起動エラー:",
        error
      );
    }
  );

  pacat.on("error", (error) => {
    console.error(
      "❌ pacat起動エラー:",
      error
    );
  });

  console.log("✅ 音声パイプライン開始");

  console.log(
    "   iPhone 8kHz → Nova 16kHz"
  );

  console.log(
    "   Nova 24kHz → iPhone 8kHz"
  );
}

// ========================================
// Nova Sonicセッション停止
// ========================================

export async function stopNovaSession() {
  if (!isRunning && !session) {
    return;
  }

  console.log(
    "🛑 Nova 2 Sonic セッション停止"
  );

  isRunning = false;

  // ======================================
  // 音声プロセス停止
  // ======================================

  parec?.kill("SIGTERM");

  inputResampler?.kill("SIGTERM");

  outputResampler?.kill("SIGTERM");

  pacat?.kill("SIGTERM");

  parec = null;

  inputResampler = null;

  outputResampler = null;

  pacat = null;

  // ======================================
  // Novaセッション停止
  // ======================================

  if (session) {
    try {
      await session.endAudioContent();
    } catch (error) {
      console.error(
        "endAudioContent error:",
        error
      );
    }

    try {
      await session.endPrompt();
    } catch (error) {
      console.error(
        "endPrompt error:",
        error
      );
    }

    try {
      await session.close();
    } catch (error) {
      console.error(
        "session close error:",
        error
      );
    }

    session = null;
  }

  console.log(
    "✅ Novaセッション停止完了"
  );
}

// ========================================
// このファイルを直接実行した場合だけ
// Novaを起動
// ========================================

if (require.main === module) {
  startNovaSession().catch((error) => {
    console.error(
      "❌ 起動失敗:",
      error
    );

    process.exit(1);
  });

  process.on(
    "SIGINT",
    async () => {
      await stopNovaSession();
      process.exit(0);
    }
  );

  process.on(
    "SIGTERM",
    async () => {
      await stopNovaSession();
      process.exit(0);
    }
  );
}