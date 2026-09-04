import { checkAvailability } from "./dynamodb-client";

async function main() {
  const productId = "EXC-001";

const startAt = "2026-09-10T09:00:00+09:00";
const endAt = "2026-09-12T18:00:00+09:00";

  const available = await checkAvailability(
    productId,
    startAt,
    endAt
  );

  console.log("予約可能:", available);
}

main().catch((error) => {
  console.error("エラー:", error);
  process.exit(1);
});
