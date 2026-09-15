import dbus from "dbus-next";
import {
  startNovaSession,
  stopNovaSession,
} from "./iphone-nova-bridge";

const bus = dbus.systemBus();

const DEVICE_PATH =
  "/hfp/org/bluez/hci0/dev_08_87_C7_41_A7_8B";

let answering = false;
let novaRunning = false;

async function checkIncomingCall() {
  try {
    const obj = await bus.getProxyObject(
      "org.ofono",
      DEVICE_PATH
    );

    // VoiceCallManager がまだ取得できない場合は次回チェック
    if (!obj.interfaces["org.ofono.VoiceCallManager"]) {
      console.log("📞 VoiceCallManager待機中...");
      return;
    }

    const manager = obj.getInterface(
      "org.ofono.VoiceCallManager"
    ) as any;

    const calls = await manager.GetCalls();

    // 現在の通話状態を確認
    let activeCallExists = false;

    for (const call of calls) {
      const callPath = call[0];
      const properties = call[1];

      let state = "";

      for (const [key, value] of Object.entries(properties)) {
        const v = value as any;

        if (key === "State") {
          state = v.value;
        }
      }

      // ========================================
      // 着信
      // ========================================
      if (state === "incoming" && !answering) {
        answering = true;

        console.log("");
        console.log("📞 着信あり！");
        console.log(`📞 自動応答: ${callPath}`);

        const callObj = await bus.getProxyObject(
          "org.ofono",
          callPath
        );

        const voiceCall = callObj.getInterface(
          "org.ofono.VoiceCall"
        ) as any;

        // 自動応答
        await voiceCall.Answer();

        console.log("✅ 自動応答しました");

        // HFP音声デバイスが確立するまで待つ
        console.log("⏳ HFP音声接続を待機中...");
        await new Promise((resolve) =>
          setTimeout(resolve, 2000)
        );

        // Nova起動
        if (!novaRunning) {
          console.log("🤖 Nova起動開始...");

          try {
            await startNovaSession();

            novaRunning = true;

            console.log("✅ Nova起動完了");
            console.log("🎙 iPhone HFP ↔ Nova 接続中");
          } catch (error) {
            console.error("❌ Nova起動失敗:", error);
            novaRunning = false;
          }
        }
      }

      // ========================================
      // 通話中
      // ========================================
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
    if (!activeCallExists && answering) {
      console.log("📴 通話終了");

      answering = false;

      if (novaRunning) {
        console.log("🤖 Nova停止開始...");

        try {
          await stopNovaSession();
          console.log("✅ Nova停止完了");
        } catch (error) {
          console.error("❌ Nova停止失敗:", error);
        }

        novaRunning = false;
      }
    }
  } catch (error) {
    console.error("着信チェックエラー:", error);
  }
}

// 起動直後に1回チェック
checkIncomingCall();

// 3秒ごとに着信・通話状態を確認
setInterval(checkIncomingCall, 3000);