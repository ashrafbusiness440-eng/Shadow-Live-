// PK points are stored as doubled integers. An odd Coin amount can
// legitimately earn half-point increments on the first gift of a round.
export function pkGiftScoreTwice(paidRecipientCoins, isFirstGift) {
  if (!Number.isSafeInteger(paidRecipientCoins) || paidRecipientCoins <= 0) {
    return null;
  }
  const pointsTwice = paidRecipientCoins * (isFirstGift ? 21 : 20);
  return Number.isSafeInteger(pointsTwice) ? pointsTwice : null;
}
