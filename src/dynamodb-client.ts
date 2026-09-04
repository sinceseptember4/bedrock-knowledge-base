import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

import { fromLoginCredentials } from "@aws-sdk/credential-providers";

const REGION = "ap-northeast-1";

const client = new DynamoDBClient({
  region: REGION,
  credentials: fromLoginCredentials({
    profile: "default"
  })
});

const dynamoDB = DynamoDBDocumentClient.from(client);

/**
 * 商品を取得
 */
export async function getRentalProduct(productId: string) {
  const result = await dynamoDB.send(
    new GetCommand({
      TableName: "RentalProducts",
      Key: {
        productId
      }
    })
  );

  return result.Item ?? null;
}

/**
 * 商品の指定時間帯に予約が入っているか確認
 *
 * 重複条件:
 * 既存予約.startAt < 希望終了時刻
 * AND
 * 既存予約.endAt > 希望開始時刻
 */
export async function checkAvailability(
  productId: string,
  startAt: string,
  endAt: string
): Promise<boolean> {

  const result = await dynamoDB.send(
    new QueryCommand({
      TableName: "RentalReservations",
      IndexName: "ProductDateIndex",

      KeyConditionExpression:
        "productId = :productId AND startAt < :endAt",

      FilterExpression:
        "endAt > :startAt",

      ExpressionAttributeValues: {
        ":productId": productId,
        ":startAt": startAt,
        ":endAt": endAt
      }
    })
  );

  return (result.Items?.length ?? 0) === 0;
}

/**
 * 予約を登録
 *
 * confirmed が true の場合のみ予約を確定する
 */
export async function createReservation(
  productId: string,
  startAt: string,
  endAt: string,
  customerName: string,
  confirmed: boolean
) {
  if (!confirmed) {
    throw new Error("予約確定の確認が完了していません");
  }

  // 念のため登録直前にも空き状況を確認
  const available = await checkAvailability(
    productId,
    startAt,
    endAt
  );

  if (!available) {
    throw new Error("指定された日時は予約できません");
  }

  const reservationId = `RES-${Date.now()}`;

  const reservation = {
    reservationId,
    productId,
    startAt,
    endAt,
    customerName,
    status: "CONFIRMED",
    createdAt: new Date().toISOString()
  };

  await dynamoDB.send(
    new PutCommand({
      TableName: "RentalReservations",
      Item: reservation,
      ConditionExpression: "attribute_not_exists(reservationId)"
    })
  );

  return reservation;
}