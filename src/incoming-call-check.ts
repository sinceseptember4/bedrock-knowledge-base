import dbus from "dbus-next";

const bus = dbus.systemBus();

const DEVICE_PATH =
  "/hfp/org/bluez/hci0/dev_08_87_C7_41_A7_8B";

let answering = false;

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

      if (state === "incoming" && !answering) {
        answering = true;

        console.log("📞 着信あり！");
        console.log(`📞 自動応答: ${callPath}`);

        const callObj = await bus.getProxyObject(
          "org.ofono",
          callPath
        );

        const voiceCall = callObj.getInterface(
          "org.ofono.VoiceCall"
        ) as any;

        await voiceCall.Answer();

        console.log("✅ 自動応答しました");
      }

      if (state !== "incoming") {
        answering = false;
      }
    }
  } catch (error) {
    console.error("着信チェックエラー:", error);
  }
}

checkIncomingCall();

setInterval(checkIncomingCall, 3000);