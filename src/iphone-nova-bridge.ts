import { spawn, ChildProcessWithoutNullStreams } from "child_process";
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

const HFP_SOURCE =
  "bluez_source.08_87_C7_41_A7_8B.headset_audio_gateway";

const HFP_SINK =
  "bluez_sink.08_87_C7_41_A7_8B.headset_audio_gateway";

const AWS_REGION = process.env.AWS_REGION || "ap-northeast-1";

let session: StreamSession | null = null;
let parec: ChildProcessWithoutNullStreams | null = null;
let inputResampler: ChildProcessWithoutNullStreams | null = null;
let outputResampler: ChildProcessWithoutNullStreams | null = null;
let pacat: ChildProcessWithoutNullStreams | null = null;

async function startNovaSession() {
  console.log("🤖 Nova 2 Sonic セッション開始");

  const bedrockClient = new NovaSonicBidirectionalStreamClient({
    clientConfig: {
      region: AWS_REGION,
      credentials: fromLoginCredentials({
        profile: "default",
      }),
    },
  });

  const sessionId = `iphone-${Date.now()}`;

  session = bedrockClient.createStreamSession(sessionId);

  session.onEvent("textOutput", (data) => {
    console.log("📝 Nova:", data);
  });

  session.onEvent("contentStart", (data) => {
    console.log("📡 contentStart:", data);
  });

  session.onEvent("audioOutput", (data) => {
    try {
      if (!data?.content) {
        return;
      }

      const audio = Buffer.from(data.content, "base64");

      if (outputResampler?.stdin.writable) {
        outputResampler.stdin.write(audio);
      }
    } catch (error) {
      console.error("❌ Nova音声処理エラー:", error);
    }
  });

  session.onEvent("error", (data) => {
    console.error("❌ Novaエラー:", data);
  });

  session.onEvent("streamComplete", () => {
    console.log("🛑 Novaストリーム終了");
  });

  // Novaとのストリームを先に開始
  bedrockClient.initiateBidirectionalStreaming(sessionId);

  // セッション開始
  await session.setupSessionAndPromptStart();

  // システムプロンプト
  await session.setupSystemPrompt(
    undefined,
    DefaultSystemPrompt
  );

  // iPhone HFP入力は8kHzなのでNova用16kHzへ変換
  await session.setupStartAudio({
    ...DefaultAudioInputConfiguration,
    sampleRateHertz: 16000,
    sampleSizeBits: 16,
    channelCount: 1,
    encoding: "base64",
    mediaType: "audio/lpcm",
  });

  console.log("✅ Novaセッション準備完了");

  startAudioPipeline();
}

function startAudioPipeline() {
  writeFileSync("/tmp/nova-input.raw", "");
  console.log("🎙 iPhone HFP → Nova パイプライン開始");

  // iPhone HFP:
  // 8kHz / 16bit / mono
  parec = spawn("parec", [
    `--device=${HFP_SOURCE}`,
    "--rate=8000",
    "--channels=1",
    "--format=s16le",
  ]);

  // 8kHz → 16kHz
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

  parec.stdout.pipe(inputResampler.stdin);

  inputResampler.stdout.on("data", async (chunk: Buffer) => {
    try {
      // Novaへ送る直前の音声をそのまま録音
      appendFileSync("/tmp/nova-input.raw", chunk);

      if (session) {
        await session.streamAudio(chunk);
      }
    } catch (error) {
      console.error("❌ Nova入力エラー:", error);
    }
  });

  parec.stderr.on("data", (data) => {
    console.error("parec:", data.toString());
  });

  inputResampler.stderr.on("data", (data) => {
    console.error("sox input:", data.toString());
  });

  // Nova 24kHz → iPhone HFP 8kHz
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

  // PulseAudio → Bluetooth HFP
  pacat = spawn("pacat", [
    "--playback",
    `--device=${HFP_SINK}`,
    "--raw",
    "--format=s16le",
    "--rate=8000",
    "--channels=1",
  ]);

  outputResampler.stdout.pipe(pacat.stdin);

  outputResampler.stderr.on("data", (data) => {
    console.error("sox output:", data.toString());
  });

  pacat.stderr.on("data", (data) => {
    console.error("pacat:", data.toString());
  });

  console.log("✅ 音声パイプライン開始");
  console.log("   iPhone 8kHz → Nova 16kHz");
  console.log("   Nova 24kHz → iPhone 8kHz");
}

async function cleanup() {
  console.log("🧹 終了処理");

  try {
    parec?.kill("SIGTERM");
    inputResampler?.kill("SIGTERM");
    outputResampler?.kill("SIGTERM");
    pacat?.kill("SIGTERM");

    if (session) {
      await session.endAudioContent();
      await session.endPrompt();
      await session.close();
    }
  } catch (error) {
    console.error("cleanup error:", error);
  }

  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

startNovaSession().catch((error) => {
  console.error("❌ 起動失敗:", error);
  process.exit(1);
});
