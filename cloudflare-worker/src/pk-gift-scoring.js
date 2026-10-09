// PK points are stored as doubled integers. An odd Coin amount can
// legitimately earn half-point increments on the first gift of a round.
export function pkGiftScoreTwice(paidRecipientCoins, isFirstGift) {
  if (!Number.isSafeInteger(paidRecipientCoins) || paidRecipientCoins <= 0) {
    return null;
  }
  const pointsTwice = paidRecipientCoins * (isFirstGift ? 21 : 20);
  return Number.isSafeInteger(pointsTwice) ? pointsTwice : null;
}

export function pkRoundDecision(scoreA, scoreB, overtimeUsed = false) {
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) ||
      scoreA < 0 || scoreB < 0) return null;
  if (scoreA === scoreB && !overtimeUsed) {
    return { overtime: true, winner: "" };
  }
  return {
    overtime: false,
    winner: scoreA === scoreB ? "draw" : (scoreA > scoreB ? "a" : "b"),
  };
}
