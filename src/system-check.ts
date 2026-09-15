
import { execFileSync } from "child_process";

const PHONE_MAC = "08:87:C7:41:A7:8B";

function checkAWS() {
  console.log("🔐 AWS認証確認...");

  try {
    const result = execFileSync(
      "aws",
      ["sts", "get-caller-identity", "--profile", "default"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    const identity = JSON.parse(result);

    console.log(`✅ AWS OK: ${identity.Arn}`);
    return true;
  } catch {
    console.error("❌ AWS認証NG");
    console.error("   aws login --remote を実行してください");
    return false;
  }
}

function checkBluetooth() {
  console.log("📡 Bluetooth確認...");

  try {
    const result = execFileSync(
      "bluetoothctl",
      ["info", PHONE_MAC],
      { encoding: "utf8" }
    );

    if (/Connected:\s*yes/i.test(result)) {
      console.log(`✅ iPhone Bluetooth接続OK: ${PHONE_MAC}`);
      return true;
    }

    console.error("❌ iPhoneがBluetooth接続されていません");
    return false;
  } catch {
    console.error("❌ Bluetooth確認失敗");
    return false;
  }
}

export function runSystemCheck() {
  console.log("\n================================");
  console.log("🔎 システムチェック開始");
  console.log("================================\n");

  const awsOK = checkAWS();
  const bluetoothOK = checkBluetooth();

  console.log("\n================================");

  if (!awsOK || !bluetoothOK) {
    console.error("❌ システムチェック失敗");
    console.error("   サービスを起動しません");
    console.log("================================\n");

    process.exit(1);
  }

  console.log("✅ システムチェック完了");
  console.log("================================\n");
}