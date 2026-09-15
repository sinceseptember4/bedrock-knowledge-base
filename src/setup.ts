import { runSystemCheck } from "./system-check";

async function main() {
  const ok = runSystemCheck();

  if (!ok) {
    process.exit(1);
  }

  console.log("");
  console.log("🚀 サービス起動開始");

  await import("./incoming-call-check");
  await import("./server");
}

main().catch((error) => {
  console.error("❌ 起動エラー:", error);
  process.exit(1);
});