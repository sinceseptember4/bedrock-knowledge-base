import { createReservation } from "./dynamodb-client";

async function main() {
  const reservation = await createReservation(
    "EXC-001",
    "2026-09-10T09:00:00+09:00",
    "2026-09-12T18:00:00+09:00",
    "山田太郎",
    true
  );

  console.log("予約登録成功:");
  console.log(reservation);
}

main().catch((error) => {
  console.error("エラー:", error);
  process.exit(1);
});