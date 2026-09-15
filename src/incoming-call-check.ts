import dbus from "dbus-next";
import { execFileSync } from "child_process";

import {
  startNovaSession,
  stopNovaSession,
} from "./iphone-nova-bridge";

const bus = dbus.systemBus();

const DEVICE_PATH =
  "/hfp/org/bluez/hci0/dev_08_87_C7_41_A7_8B";

const CARD_NAME =
  "bluez_card.08_87_C7_41_A7_8B";

const HFP_PROFILE =
  "headset_audio_gateway";

const A2DP_PROFILE =
  "a2dp_source";

// ========================================
// 状態
// ========================================

let answering = false;
let novaRunning = false;
let checking = false;

// 現在処理中の通話
let currentCallPath: string | null = null;

// ========================================
// HFPへ切り替え
// ========================================

function switchToHfp(): boolean {
  console.log("📡 HFPへ切り替え中...");

  try {
    execFileSync(
      "pactl",
      [
        "set-card-profile",
        CARD_NAME,
        HFP_PROFILE,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    console.log("✅ HFPへ切り替えました");

    return true;
  } catch (error) {
    console.error(
      "❌ HFP切り替え失敗:",
      error
    );

    return false;
  }
}

// ========================================
// A2DPへ戻す
// ========================================

function switchToA2dp(): boolean {
  try {
    execFileSync(
      "pactl",
      [
        "set-card-profile",
        CARD_NAME,
        A2DP_PROFILE,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    console.log("🔊 A2DPへ戻しました");

    return true;
  } catch (error) {
    console.error(
      "⚠️ A2DPへの切り替えに失敗:",
      error
    );

    return false;
  }
}

// ========================================
// Nova停止
// ========================================

async function stopNova(): Promise<void> {
  if (!novaRunning) {
    return;
  }

  console.log("🤖 Nova停止開始...");

  try {
    await stopNovaSession();

    console.log("✅ Nova停止完了");
  } catch (error) {
    console.error(
      "❌ Nova停止失敗:",
      error
    );
  }

  novaRunning = false;
}

// ========================================
// 通話終了処理
// ========================================

async function finishCall(): Promise<void> {
  console.log("");
  console.log("📴 通話終了");

  answering = false;
  currentCallPath = null;

  await stopNova();

  switchToA2dp();
}

// ========================================
// 着信チェック
// ========================================

async function checkIncomingCall(): Promise<void> {
  // 前回のチェックがまだ終わっている場合は
  // 二重実行しない
  if (checking) {
    return;
  }

  checking = true;

  try {
    const obj = await bus.getProxyObject(
      "org.ofono",
      DEVICE_PATH
    );

    // VoiceCallManagerがまだない場合
    if (
      !obj.interfaces[
        "org.ofono.VoiceCallManager"
      ]
    ) {
      console.log(
        "📞 VoiceCallManager待機中..."
      );

      return;
    }

    const manager =
      obj.getInterface(
        "org.ofono.VoiceCallManager"
      ) as any;

    const calls = await manager.GetCalls();

    // ======================================
    // 通話が存在するか
    // ======================================

    const callExists = calls.length > 0;

    // ======================================
    // 通話一覧処理
    // ======================================

    for (const call of calls) {
      const callPath = call[0];
      const properties = call[1];

      let state = "";

      for (const [
        key,
        value,
      ] of Object.entries(properties)) {
        const v = value as any;

        if (key === "State") {
          state = v.value;
        }
      }

      // ====================================
      // デバッグ
      // ====================================

      console.log(
        `📞 Call: ${callPath} / State: ${state}`
      );

      // ====================================
      // 着信
      // ====================================

      if (
        state === "incoming" &&
        !answering
      ) {
        answering = true;
        currentCallPath = callPath;

        console.log("");
        console.log("📞 着信あり！");
        console.log(
          `📞 自動応答: ${callPath}`
        );

        try {
          const callObj =
            await bus.getProxyObject(
              "org.ofono",
              callPath
            );

          const voiceCall =
            callObj.getInterface(
              "org.ofono.VoiceCall"
            ) as any;

          // ------------------------------
          // 自動応答
          // ------------------------------

          await voiceCall.Answer();

          console.log(
            "✅ 自動応答しました"
          );

          // Answer直後でも、
          // このチェックでは通話中として扱う
          currentCallPath = callPath;

          // ------------------------------
          // HFPへ切り替え
          // ------------------------------

          const hfpOK =
            switchToHfp();

          if (!hfpOK) {
            console.error(
              "❌ HFPへ切り替えられないためNovaを起動しません"
            );

            return;
          }

          // ------------------------------
          // Nova起動
          // ------------------------------

          if (!novaRunning) {
            console.log(
              "🤖 Nova起動開始..."
            );

            try {
              await startNovaSession();

              novaRunning = true;

              console.log(
                "✅ Nova起動完了"
              );

              console.log(
                "🎙 iPhone HFP ↔ Nova 接続中"
              );
            } catch (error) {
              console.error(
                "❌ Nova起動失敗:",
                error
              );

              novaRunning = false;
            }
          }
        } catch (error) {
          console.error(
            "❌ 着信処理失敗:",
            error
          );

          answering = false;
          currentCallPath = null;
        }
      }

      // ====================================
      // 既存の通話
      // ====================================

      if (
        state === "active" ||
        state === "dialing" ||
        state === "alerting" ||
        state === "incoming"
      ) {
        // 現在の通話として保持
        if (
          currentCallPath === null
        ) {
          currentCallPath = callPath;
        }
      }
    }

    // ======================================
    // 通話終了判定
    // ======================================
    //
    // activeCallExists のように
    // 「active stateだったか」ではなく、
    // GetCalls() に通話自体が存在するかで判定
    //
    // これにより Answer()直後の
    // 古い "incoming" state で
    // 通話終了と誤判定しない
    // ======================================

    if (
      !callExists &&
      answering
    ) {
      await finishCall();
    }
  } catch (error) {
    console.error(
      "着信チェックエラー:",
      error
    );
  } finally {
    checking = false;
  }
}

// ========================================
// 起動
// ========================================

checkIncomingCall();

setInterval(
  () => {
    void checkIncomingCall();
  },
  3000
);