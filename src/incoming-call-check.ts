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

let answering = false;
let novaRunning = false;

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
    console.error("❌ HFP切り替え失敗:", error);

    return false;
  }
}

// ========================================
// 着信チェック
// ========================================

async function checkIncomingCall() {
  try {
    const obj = await bus.getProxyObject(
      "org.ofono",
      DEVICE_PATH
    );

    // VoiceCallManagerがまだない場合
    if (!obj.interfaces["org.ofono.VoiceCallManager"]) {
      console.log("📞 VoiceCallManager待機中...");
      return;
    }

    const manager = obj.getInterface(
      "org.ofono.VoiceCallManager"
    ) as any;

    const calls = await manager.GetCalls();

    let activeCallExists = false;

    for (const call of calls) {
      const callPath = call[0];
      const properties = call[1];

      let state = "";

      for (const [key, value] of Object.entries(
        properties
      )) {
        const v = value as any;

        if (key === "State") {
          state = v.value;
        }
      }

      // ======================================
      // 着信
      // ======================================

      if (
        state === "incoming" &&
        !answering
      ) {
        answering = true;

        console.log("");
        console.log("📞 着信あり！");
        console.log(
          `📞 自動応答: ${callPath}`
        );

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

        // ------------------------------
        // HFPへ切り替え
        // ------------------------------

        const hfpOK = switchToHfp();

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
      }

      // ======================================
      // 通話中
      // ======================================

      if (
        state === "active" ||
        state === "dialing" ||
        state === "alerting"
      ) {
        activeCallExists = true;
      }
    }

    // ========================================
    // 通話終了
    // ========================================

    if (
      !activeCallExists &&
      answering
    ) {
      console.log("");
      console.log("📴 通話終了");

      answering = false;

      // ------------------------------
      // Nova停止
      // ------------------------------

      if (novaRunning) {
        console.log(
          "🤖 Nova停止開始..."
        );

        try {
          await stopNovaSession();

          console.log(
            "✅ Nova停止完了"
          );
        } catch (error) {
          console.error(
            "❌ Nova停止失敗:",
            error
          );
        }

        novaRunning = false;
      }

      // ------------------------------
      // HFP → A2DPへ戻す
      // ------------------------------

      try {
        execFileSync(
          "pactl",
          [
            "set-card-profile",
            CARD_NAME,
            "a2dp_source",
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }
        );

        console.log(
          "🔊 A2DPへ戻しました"
        );
      } catch (error) {
        console.error(
          "⚠️ A2DPへの切り替えに失敗:",
          error
        );
      }
    }
  } catch (error) {
    console.error(
      "着信チェックエラー:",
      error
    );
  }
}

// ========================================
// 起動
// ========================================

checkIncomingCall();

setInterval(
  checkIncomingCall,
  3000
);